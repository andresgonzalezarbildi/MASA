(() => {
  "use strict";

  const SCHEMA_VERSION = 19;
  const CACHE_PREFIX = "masa-user-cache-v1:";
  const PENDING_PREFIX = "masa-user-pending-v1:";
  const LAST_USER_KEY = "masa-last-user-v1";
  const PAGE_SIZE = 1000;
  const BATCH_SIZE = 250;
  const SYNC_DELAY_MS = 700;
  const OPERATION_TIMEOUT_MS = 12_000;

  let client = null;
  let session = null;
  let authBound = false;
  let authStarted = false;
  let appBooted = false;
  let recoveryMode = /(?:^|[?#&])type=recovery(?:&|$)/.test(`${location.search}${location.hash}`);
  let pendingState = null;
  let syncTimer = null;
  let syncInFlight = null;
  let lastSyncError = null;
  let syncedSignatures = null;
  let syncedFoodMap = new Map();
  let syncedRecipeMap = new Map();
  let authStorage = null;
  let storageFailure = null;
  let loadingWatchdog = null;
  let authEventRevision = 0;
  let explicitSignOut = false;
  const memoryStorage = new Map();
  const sessionWaiters = [];

  const $ = selector => document.querySelector(selector);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function configIsValid(config) {
    return Boolean(
      config?.supabaseUrl &&
      config?.supabaseKey &&
      !config.supabaseUrl.includes("TU-PROYECTO") &&
      !config.supabaseKey.includes("TU_PUBLISHABLE")
    );
  }

  function isNativeRuntime() {
    try {
      return Boolean(window.MASA_NATIVE?.isNative?.() || window.Capacitor?.isNativePlatform?.());
    } catch (_) {
      return false;
    }
  }

  function errorWithContext(source, kind, context, code = "") {
    const message = source?.message || String(source || context);
    const error = new Error(message, source instanceof Error ? { cause: source } : undefined);
    error.name = source?.name || "Error";
    error.code = source?.code || code || "";
    error.status = source?.status;
    error.masaKind = kind;
    error.masaContext = context;
    return error;
  }

  function logRealError(scope, context, error) {
    console.error(`[MASA][${scope}] ${context}`, error);
  }

  function withTimeout(operation, context, timeoutMs = OPERATION_TIMEOUT_MS) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(errorWithContext(
          new Error(`${context} superó el tiempo máximo de ${Math.round(timeoutMs / 1000)} segundos.`),
          "timeout",
          context,
          "MASA_TIMEOUT"
        ));
      }, timeoutMs);
    });
    return Promise.race([Promise.resolve(operation), timeout]).finally(() => clearTimeout(timer));
  }

  function noteStorageFailure(action, source) {
    storageFailure = errorWithContext(source, "storage", `No se pudo ${action} el almacenamiento local`, "MASA_STORAGE");
    logRealError("storage", storageFailure.masaContext, storageFailure);
    if (appBooted) setSyncStatus("error", "Sesión no persistente");
  }

  function getAuthStorage() {
    if (authStorage) return authStorage;
    authStorage = {
      getItem(key) {
        try {
          const value = window.localStorage.getItem(key);
          if (value !== null) memoryStorage.set(key, value);
          return value ?? memoryStorage.get(key) ?? null;
        } catch (error) {
          noteStorageFailure("leer", error);
          return memoryStorage.get(key) ?? null;
        }
      },
      setItem(key, value) {
        memoryStorage.set(key, value);
        try {
          window.localStorage.setItem(key, value);
        } catch (error) {
          noteStorageFailure("guardar", error);
        }
      },
      removeItem(key) {
        memoryStorage.delete(key);
        try {
          window.localStorage.removeItem(key);
        } catch (error) {
          noteStorageFailure("borrar", error);
        }
      }
    };
    return authStorage;
  }

  function getClient() {
    if (client) return client;
    if (!configIsValid(window.MASA_CONFIG)) {
      throw errorWithContext(
        new Error("Completá js/config.js con la URL y la Publishable key de Supabase."),
        "configuration",
        "Configuración de Supabase",
        "MASA_CONFIG"
      );
    }
    if (!window.supabase?.createClient) {
      throw errorWithContext(
        new Error("El paquete de Supabase no está disponible en esta compilación."),
        "configuration",
        "Carga del cliente de Supabase",
        "MASA_SUPABASE_MISSING"
      );
    }

    client = window.supabase.createClient(
      window.MASA_CONFIG.supabaseUrl,
      window.MASA_CONFIG.supabaseKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: !isNativeRuntime(),
          storage: getAuthStorage()
        }
      }
    );
    return client;
  }

  function throwIfError(result, context, kind = "sync") {
    if (result?.error) throw errorWithContext(result.error, kind, context);
    return result?.data;
  }

  function currentUser() {
    const user = session?.user;
    if (!user) throw new Error("No hay un usuario autenticado.");
    return user;
  }

  function isOfflineSession() {
    return Boolean(session?.masaOffline);
  }

  function readLocalJson(key, action) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      noteStorageFailure(action, error);
      return null;
    }
  }

  function writeLocalJson(key, value, action) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      noteStorageFailure(action, error);
      return false;
    }
  }

  function removeLocalItem(key, action) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      noteStorageFailure(action, error);
    }
  }

  function rememberUser(user) {
    if (!user?.id) return;
    writeLocalJson(LAST_USER_KEY, {
      id: String(user.id),
      email: String(user.email || "")
    }, "guardar la identidad para el modo offline");
  }

  function forgetRememberedUser() {
    removeLocalItem(LAST_USER_KEY, "borrar la identidad offline");
  }

  function readRememberedUser() {
    const user = readLocalJson(LAST_USER_KEY, "leer la identidad offline");
    return user?.id ? { id: String(user.id), email: String(user.email || "") } : null;
  }

  function activateOfflineSession() {
    const user = readRememberedUser();
    if (!user) return null;

    const queued = readLocalJson(`${PENDING_PREFIX}${user.id}`, "leer los cambios offline");
    const cached = readLocalJson(`${CACHE_PREFIX}${user.id}`, "leer los datos offline");
    if (!queued && !cached) return null;

    session = {
      user: { ...user, offline: true },
      masaOffline: true
    };
    updateAccountUI();
    resolveSessionWaiters();
    setSyncStatus("offline", queued ? "Sin conexión · cambios pendientes" : "Sin conexión · modo local");
    return session;
  }

  function setAuthMessage(text, isError = false) {
    const element = $("#auth-message");
    if (!element) return;
    element.textContent = text || "";
    element.classList.toggle("error", Boolean(isError));
  }

  function setAuthBusy(busy) {
    document.querySelectorAll("#auth-gate button, #auth-gate input").forEach(element => {
      element.disabled = Boolean(busy);
    });
    $("#auth-gate")?.classList.toggle("busy", Boolean(busy));
  }

  function showAuthMode(mode = "login") {
    clearLoadingWatchdog();
    const login = mode === "login";
    $("#auth-login-form")?.toggleAttribute("hidden", !login);
    $("#auth-signup-form")?.toggleAttribute("hidden", login);
    $("#auth-recovery-form")?.setAttribute("hidden", "");
    $("#auth-mode-login")?.classList.toggle("active", login);
    $("#auth-mode-signup")?.classList.toggle("active", !login);
    $("#auth-loading")?.setAttribute("hidden", "");
    $("#auth-forms")?.removeAttribute("hidden");
    setAuthMessage("");
  }

  function showRecoveryMode() {
    clearLoadingWatchdog();
    $("#auth-login-form")?.setAttribute("hidden", "");
    $("#auth-signup-form")?.setAttribute("hidden", "");
    $("#auth-recovery-form")?.removeAttribute("hidden");
    $("#auth-loading")?.setAttribute("hidden", "");
    $("#auth-forms")?.removeAttribute("hidden");
    setAuthMessage("Elegí una contraseña nueva para tu cuenta.");
  }

  function clearLoadingWatchdog() {
    clearTimeout(loadingWatchdog);
    loadingWatchdog = null;
  }

  function hideLoadingGate({ showForms = !session || recoveryMode, hideGate = Boolean(session && !recoveryMode) } = {}) {
    clearLoadingWatchdog();
    $("#auth-loading")?.setAttribute("hidden", "");
    if (showForms) $("#auth-forms")?.removeAttribute("hidden");
    if (hideGate) {
      const gate = $("#auth-gate");
      if (gate) gate.hidden = true;
    }
  }

  function showLoadingGate(text = "Cargando tus datos…") {
    const gate = $("#auth-gate");
    if (!gate) return;
    clearLoadingWatchdog();
    gate.hidden = false;
    $("#auth-forms")?.setAttribute("hidden", "");
    $("#auth-loading")?.removeAttribute("hidden");
    const label = $("#auth-loading-text");
    if (label) label.textContent = text;
    loadingWatchdog = setTimeout(() => {
      const error = errorWithContext(
        new Error("El cargador de autenticación alcanzó el tiempo máximo."),
        "timeout",
        "Pantalla de carga",
        "MASA_LOADING_TIMEOUT"
      );
      logRealError("auth", "Se cerró un cargador bloqueado", error);
      if (session && !recoveryMode) {
        hideLoadingGate({ showForms: false, hideGate: true });
      } else {
        showAuthMode("login");
        setAuthMessage("La operación demoró demasiado. Volvé a intentarlo.", true);
      }
    }, OPERATION_TIMEOUT_MS + 500);
  }

  function showFatalError(error) {
    logRealError("startup", "No se pudo completar la inicialización", error);
    const gate = $("#auth-gate");
    if (gate) gate.hidden = false;
    showAuthMode("login");
    setAuthMessage(humanizeAuthError(error), true);
  }

  function finishBoot() {
    appBooted = true;
    hideLoadingGate({ showForms: false, hideGate: true });
    document.body.classList.add("cloud-ready");
    updateAccountUI();
    if (storageFailure) setSyncStatus("error", "Sesión no persistente");
  }

  function updateAccountUI() {
    const email = session?.user?.email || "";
    const accountEmail = $("#account-email");
    if (accountEmail) accountEmail.textContent = email;
    const accountArea = $("#account-area");
    if (accountArea) accountArea.hidden = !email;
    const logoutButton = $("#logout-button");
    if (logoutButton) logoutButton.hidden = !email;
  }

  function setSyncStatus(kind, text) {
    const element = $("#sync-status");
    if (!element) return;
    element.dataset.status = kind;
    element.textContent = text;
  }

  function resolveSessionWaiters() {
    if (!session) return;
    while (sessionWaiters.length) sessionWaiters.shift()(session);
  }

  function handleSignedOut({ forgetIdentity = explicitSignOut } = {}) {
    if (forgetIdentity) forgetRememberedUser();
    explicitSignOut = false;
    session = null;
    pendingState = null;
    clearTimeout(syncTimer);
    syncTimer = null;
    updateAccountUI();
    if (appBooted) location.reload();
    else {
      const gate = $("#auth-gate");
      if (gate) gate.hidden = false;
      showAuthMode("login");
    }
  }

  function togglePasswordVisibility(button) {
    const field = button.closest(".password-field");
    const input = field?.querySelector("input");
    if (!input) return;

    const selectionStart = input.selectionStart;
    const selectionEnd = input.selectionEnd;
    const selectionDirection = input.selectionDirection;
    const nextVisible = input.type !== "text";

    input.type = nextVisible ? "text" : "password";
    button.setAttribute("aria-pressed", String(nextVisible));
    button.setAttribute("aria-label", nextVisible ? "Ocultar contraseña" : "Mostrar contraseña");
    input.focus({ preventScroll: true });
    if (selectionStart !== null && selectionEnd !== null) {
      const restoreSelection = () => {
        try { input.setSelectionRange(selectionStart, selectionEnd, selectionDirection || "none"); } catch (_) {}
      };
      restoreSelection();
      requestAnimationFrame(restoreSelection);
    }
  }

  function acceptSession(nextSession) {
    if (!nextSession?.user) {
      throw errorWithContext(
        new Error("Supabase no devolvió una sesión válida."),
        "auth",
        "Inicio de sesión",
        "MASA_NO_SESSION"
      );
    }
    session = nextSession;
    rememberUser(nextSession.user);
    updateAccountUI();
    resolveSessionWaiters();
    if (!recoveryMode) hideLoadingGate({ showForms: false, hideGate: true });
    if (appBooted && navigator.onLine) {
      setTimeout(() => {
        resumeOnlineSync().catch(error => {
          logRealError("sync", "No se pudo reanudar la sincronización después de iniciar sesión", error);
        });
      }, 0);
    }
  }

  function bindAuthUI() {
    if (authBound) return;
    authBound = true;

    $("#auth-mode-login")?.addEventListener("click", () => showAuthMode("login"));
    $("#auth-mode-signup")?.addEventListener("click", () => showAuthMode("signup"));
    document.querySelectorAll("[data-password-toggle]").forEach(button => {
      button.type = "button";
      button.addEventListener("click", () => togglePasswordVisibility(button));
    });

    $("#auth-login-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const emailInput = form.querySelector('input[name="email"]');
      const passwordInput = form.querySelector('input[name="password"]');
      const email = emailInput.value.trim();
      const password = passwordInput.value;

      setAuthBusy(true);
      setAuthMessage("");
      showLoadingGate("Iniciando sesión…");
      try {
        const result = await withTimeout(
          getClient().auth.signInWithPassword({ email, password }),
          "El inicio de sesión"
        );
        if (result.error) throw errorWithContext(result.error, "auth", "Inicio de sesión");
        acceptSession(result.data?.session);
      } catch (error) {
        logRealError("auth", "Falló el inicio de sesión", error);
        if (session) return;
        updateAccountUI();
        showAuthMode("login");
        setAuthMessage(humanizeAuthError(error), true);
      } finally {
        setAuthBusy(false);
        hideLoadingGate({ showForms: !session || recoveryMode, hideGate: Boolean(session && !recoveryMode) });
      }
    });

    $("#auth-signup-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const emailInput = form.querySelector('input[name="email"]');
      const passwordInput = form.querySelector('input[name="password"]');
      const nameInput = form.querySelector('input[name="name"]');
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      const name = nameInput.value.trim();

      setAuthBusy(true);
      setAuthMessage("");
      showLoadingGate("Creando la cuenta…");
      try {
        if (password.length < 8) {
          throw errorWithContext(
            new Error("La contraseña debe tener al menos 8 caracteres."),
            "validation",
            "Registro",
            "MASA_PASSWORD_LENGTH"
          );
        }
        const result = await withTimeout(
          getClient().auth.signUp({ email, password, options: { data: { name } } }),
          "El registro de la cuenta"
        );
        if (result.error) throw errorWithContext(result.error, "auth", "Registro");

        if (result.data?.session) {
          acceptSession(result.data.session);
        } else {
          showAuthMode("login");
          $("#auth-login-form").elements.email.value = email;
          setAuthMessage("Cuenta creada. Revisá tu correo para confirmarla y después iniciá sesión.");
        }
      } catch (error) {
        logRealError("auth", "Falló el registro", error);
        if (session) return;
        showAuthMode("signup");
        setAuthMessage(humanizeAuthError(error), true);
      } finally {
        setAuthBusy(false);
        hideLoadingGate({ showForms: !session || recoveryMode, hideGate: Boolean(session && !recoveryMode) });
      }
    });

    $("#forgot-password")?.addEventListener("click", async () => {
      const emailInput = $("#auth-login-form")?.querySelector('input[name="email"]');
      const email = emailInput?.value.trim() || "";
      if (!email) {
        setAuthMessage("Escribí tu correo antes de solicitar el enlace.", true);
        emailInput?.focus();
        return;
      }
      setAuthBusy(true);
      setAuthMessage("");
      try {
        const redirectTo = window.MASA_CONFIG?.passwordResetUrl || `${location.origin}${location.pathname}`;
        const result = await withTimeout(
          getClient().auth.resetPasswordForEmail(email, { redirectTo }),
          "El envío del enlace de recuperación"
        );
        if (result.error) throw errorWithContext(result.error, "auth", "Recuperación de contraseña");
        setAuthMessage("Te enviamos un enlace para cambiar la contraseña.");
      } catch (error) {
        logRealError("auth", "Falló la recuperación de contraseña", error);
        setAuthMessage(humanizeAuthError(error), true);
      } finally {
        setAuthBusy(false);
      }
    });

    $("#auth-recovery-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const passwordInput = form.querySelector('input[name="password"]');
      const password = passwordInput.value;

      setAuthBusy(true);
      setAuthMessage("");
      showLoadingGate("Actualizando la contraseña…");
      try {
        if (password.length < 8) {
          throw errorWithContext(
            new Error("La contraseña debe tener al menos 8 caracteres."),
            "validation",
            "Cambio de contraseña",
            "MASA_PASSWORD_LENGTH"
          );
        }
        const result = await withTimeout(
          getClient().auth.updateUser({ password }),
          "La actualización de contraseña"
        );
        if (result.error) throw errorWithContext(result.error, "auth", "Cambio de contraseña");
        recoveryMode = false;
        setAuthMessage("Contraseña actualizada.");
        if (session) acceptSession(session);
      } catch (error) {
        logRealError("auth", "Falló el cambio de contraseña", error);
        showRecoveryMode();
        setAuthMessage(humanizeAuthError(error), true);
      } finally {
        setAuthBusy(false);
        hideLoadingGate({ showForms: !session || recoveryMode, hideGate: Boolean(session && !recoveryMode) });
      }
    });

    $("#logout-button")?.addEventListener("click", async () => {
      explicitSignOut = true;
      forgetRememberedUser();
      try {
        setSyncStatus("saving", "Guardando…");
        await withTimeout(flush(), "El guardado antes de cerrar sesión");
      } catch (error) {
        logRealError("sync", "No se completó el guardado antes de salir", error);
      }
      try {
        await withTimeout(getClient().auth.signOut({ scope: "local" }), "El cierre de sesión");
      } catch (error) {
        logRealError("auth", "Falló el cierre de sesión", error);
      }
      location.reload();
    });
  }

  function isInvalidSessionError(error) {
    const message = error?.message || String(error || "");
    return /jwt|token.*(?:expired|invalid)|issued at future|session.*invalid|bad_jwt/i.test(message);
  }

  function isNetworkError(error) {
    const message = error?.message || error?.cause?.message || String(error || "");
    return /network|fetch|offline|failed to fetch|load failed|internet disconnected/i.test(message);
  }

  function humanizeAuthError(error) {
    const message = error?.message || error?.cause?.message || String(error || "");
    const code = String(error?.code || error?.cause?.code || "").toLowerCase();
    const kind = error?.masaKind || "";

    if (kind === "storage" || code === "masa_storage") {
      return "No se pudo guardar la sesión en este dispositivo. El acceso puede funcionar, pero tendrás que iniciar sesión nuevamente al cerrar la aplicación.";
    }
    if (kind === "configuration" || code === "masa_supabase_missing") {
      return message;
    }
    if (code === "invalid_credentials" || (kind === "auth" && /invalid login credentials/i.test(message))) {
      return "Credenciales incorrectas";
    }
    if (code === "email_not_confirmed" || /email not confirmed/i.test(message)) {
      return "Primero confirmá la cuenta desde el correo que recibiste.";
    }
    if (code === "user_already_exists" || /user already registered|already been registered/i.test(message)) {
      return "Ya existe una cuenta con ese correo.";
    }
    if (code === "masa_password_length" || kind === "validation") return message;
    if (isInvalidSessionError(error)) return "La sesión guardada dejó de ser válida. Iniciá sesión de nuevo.";
    if (code === "masa_timeout" || code === "masa_loading_timeout" || kind === "timeout") {
      return isNativeRuntime()
        ? "Supabase no respondió dentro de 12 segundos en Android. Revisá la conexión del dispositivo y volvé a intentar."
        : "Supabase no respondió dentro de 12 segundos. Volvé a intentarlo.";
    }
    if (isNetworkError(error)) {
      return isNativeRuntime()
        ? "Android no pudo comunicarse con Supabase. Revisá la conexión del dispositivo; el detalle real quedó registrado en la consola de la aplicación."
        : "No se pudo comunicar con Supabase. Revisá tu conexión y volvé a intentar.";
    }
    if (kind === "auth") return `Supabase rechazó la operación: ${message}`;
    return message || "No se pudo completar el acceso.";
  }

  function handleAuthStateChange(event, nextSession) {
    if (nextSession?.user) {
      session = nextSession;
      rememberUser(nextSession.user);
      updateAccountUI();
    }

    if (event === "PASSWORD_RECOVERY") {
      recoveryMode = true;
      const gate = $("#auth-gate");
      if (gate) gate.hidden = false;
      showRecoveryMode();
      return;
    }

    if (nextSession) {
      resolveSessionWaiters();
      if (!recoveryMode && appBooted) hideLoadingGate({ showForms: false, hideGate: true });
      return;
    }

    if (event === "SIGNED_OUT") {
      if (!explicitSignOut && !navigator.onLine && activateOfflineSession()) return;
      handleSignedOut({ forgetIdentity: explicitSignOut || navigator.onLine });
    }
  }

  async function startAuth() {
    if (authStarted) return session;
    authStarted = true;
    bindAuthUI();
    showLoadingGate("Comprobando la sesión…");

    try {
      const supabaseClient = getClient();
      supabaseClient.auth.onAuthStateChange((event, nextSession) => {
        authEventRevision += 1;
        handleAuthStateChange(event, nextSession);
      });

      const revisionBeforeGetSession = authEventRevision;
      const result = await withTimeout(supabaseClient.auth.getSession(), "La recuperación de la sesión");
      if (result.error) throw errorWithContext(result.error, "auth", "Recuperación de sesión");
      if (authEventRevision === revisionBeforeGetSession) {
        session = result.data?.session || null;
      }
      if (session?.user) rememberUser(session.user);
      if (!session && !navigator.onLine) activateOfflineSession();
      updateAccountUI();

      if (session && recoveryMode && !isOfflineSession()) {
        const gate = $("#auth-gate");
        if (gate) gate.hidden = false;
        showRecoveryMode();
      } else if (session) {
        resolveSessionWaiters();
      } else {
        showAuthMode("login");
        if (!navigator.onLine) {
          setAuthMessage("Necesitás conexión para iniciar sesión por primera vez.", true);
        }
      }
      return session;
    } catch (error) {
      logRealError("startup", "Falló la recuperación inicial de la sesión", error);

      const offlineSession = (!navigator.onLine || isNetworkError(error) || error?.masaKind === "timeout")
        ? activateOfflineSession()
        : null;
      if (offlineSession) return offlineSession;

      if (isInvalidSessionError(error)) {
        forgetRememberedUser();
        try {
          await withTimeout(getClient().auth.signOut({ scope: "local" }), "La limpieza de la sesión inválida");
        } catch (signOutError) {
          logRealError("storage", "No se pudo limpiar la sesión inválida", signOutError);
        }
      }
      session = null;
      updateAccountUI();
      showAuthMode("login");
      setAuthMessage(
        !navigator.onLine ? "Necesitás conexión para iniciar sesión por primera vez." : humanizeAuthError(error),
        true
      );
      return null;
    } finally {
      hideLoadingGate({ showForms: !session || recoveryMode, hideGate: Boolean(session && !recoveryMode) });
    }
  }

  async function requireSession() {
    const current = await startAuth();
    if (current && (!recoveryMode || isOfflineSession())) return current;
    if (current && recoveryMode) {
      const gate = $("#auth-gate");
      if (gate) gate.hidden = false;
      showRecoveryMode();
      return new Promise(resolve => sessionWaiters.push(resolve));
    }

    const gate = $("#auth-gate");
    if (gate) gate.hidden = false;
    showAuthMode("login");
    return new Promise(resolve => sessionWaiters.push(resolve));
  }

  function cacheKey() {
    return `${CACHE_PREFIX}${currentUser().id}`;
  }

  function pendingKey() {
    return `${PENDING_PREFIX}${currentUser().id}`;
  }

  function cacheState(state) {
    writeLocalJson(cacheKey(), state, "guardar los datos locales");
  }

  function readCachedState() {
    return readLocalJson(cacheKey(), "leer los datos locales");
  }

  function persistPendingState(state) {
    cacheState(state);
    writeLocalJson(pendingKey(), state, "guardar los cambios pendientes");
  }

  function readPersistedPendingState() {
    return readLocalJson(pendingKey(), "leer los cambios pendientes");
  }

  function clearPersistedPendingState() {
    removeLocalItem(pendingKey(), "borrar los cambios ya sincronizados");
  }

  async function fetchPaged(table, columns, apply = query => query) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      let query = getClient().from(table).select(columns).range(from, from + PAGE_SIZE - 1);
      query = apply(query);
      const data = throwIfError(await query, `No se pudo leer ${table}`) || [];
      rows.push(...data);
      if (data.length < PAGE_SIZE) break;
    }
    return rows;
  }

  async function loadUserStateFromRemote() {
    const user = currentUser();
    const [profileResult, weighRows, foodRows, recipeRows, ingredientRows, diaryRows] = await Promise.all([
      getClient().from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
      fetchPaged("weigh_ins", "*", query => query.eq("user_id", user.id).order("logged_on")),
      fetchPaged("foods", "*", query => query.eq("owner_id", user.id).order("name")),
      fetchPaged("recipes", "*", query => query.eq("user_id", user.id).order("name")),
      fetchPaged("recipe_ingredients", "*", query => query.eq("user_id", user.id).order("position")),
      fetchPaged("diary_entries", "*", query => query.eq("user_id", user.id).order("entry_date").order("created_at"))
    ]);

    const profileRow = throwIfError(profileResult, "No se pudo cargar el perfil");
    const profileData = decodeProfileData(profileRow?.profile_data);
    const ingredientsByRecipe = new Map();
    ingredientRows.forEach(row => {
      if (!ingredientsByRecipe.has(row.recipe_id)) ingredientsByRecipe.set(row.recipe_id, []);
      ingredientsByRecipe.get(row.recipe_id).push(ingredientFromRow(row));
    });

    const state = {
      version: profileRow?.schema_version || SCHEMA_VERSION,
      configured: Boolean(profileRow?.configured),
      profile: profileData.profile,
      weighIns: weighRows.map(row => ({
        ...(plainObject(row.metadata) ? row.metadata : {}),
        id: row.legacy_id || row.id,
        date: row.logged_on,
        weight: Number(row.weight_kg)
      })),
      foods: foodRows.map(foodFromRow),
      recipes: recipeRows.map(row => recipeFromRow(row, ingredientsByRecipe.get(row.id) || [])),
      diary: diaryFromRows(diaryRows),
      completedDays: profileData.completedDays,
      foodUsage: profileData.foodUsage,
      catalogOverrides: profileData.catalogOverrides,
      calibrationHistory: profileData.calibrationHistory,
      lastCheckinDate: profileData.lastCheckinDate
    };

    const hasData = Boolean(
      state.configured ||
      weighRows.length || foodRows.length || recipeRows.length || diaryRows.length ||
      Object.keys(state.profile || {}).length
    );
    return {
      state,
      hasData,
      fromCache: false,
      signatures: stateSignatures(state),
      foodMap: new Map(foodRows.map(row => [String(row.legacy_id || row.id), row.id])),
      recipeMap: new Map(recipeRows.map(row => [String(row.legacy_id || row.id), row.id]))
    };
  }

  async function loadUserState() {
    setSyncStatus("loading", "Cargando datos…");

    const persistedPending = readPersistedPendingState();
    if (persistedPending) pendingState = clone(persistedPending);
    const localState = pendingState || readCachedState();

    if ((!navigator.onLine || isOfflineSession()) && localState) {
      setSyncStatus("offline", pendingState ? "Sin conexión · cambios pendientes" : "Sin conexión · datos locales");
      return {
        state: localState,
        hasData: true,
        fromCache: true,
        pendingSync: Boolean(pendingState)
      };
    }

    if (pendingState && navigator.onLine && !isOfflineSession()) {
      try {
        await runPendingSync();
      } catch (error) {
        logRealError("sync", "No se pudieron enviar los cambios offline antes de cargar", error);
        const safeLocalState = pendingState || readPersistedPendingState() || localState;
        if (safeLocalState) {
          setSyncStatus("error", "Datos locales · sincronización pendiente");
          return { state: safeLocalState, hasData: true, fromCache: true, error, pendingSync: true };
        }
      }
    }

    try {
      const result = await withTimeout(loadUserStateFromRemote(), "La carga de datos del usuario");
      syncedSignatures = result.signatures;
      syncedFoodMap = result.foodMap;
      syncedRecipeMap = result.recipeMap;
      cacheState(result.state);
      setSyncStatus("saved", "Guardado");
      return result;
    } catch (error) {
      logRealError("sync", "Falló la carga de datos del usuario", error);
      if (isInvalidSessionError(error) && navigator.onLine && !isOfflineSession()) {
        forgetRememberedUser();
        try {
          await withTimeout(getClient().auth.signOut({ scope: "local" }), "La limpieza de la sesión inválida");
        } catch (signOutError) {
          logRealError("auth", "No se pudo limpiar la sesión inválida", signOutError);
        }
        session = null;
        const safeError = errorWithContext(
          error,
          "auth",
          "Sesión inválida",
          "INVALID_SESSION"
        );
        throw safeError;
      }

      const cached = readPersistedPendingState() || readCachedState();
      if (cached) {
        const offline = !navigator.onLine || isOfflineSession() || isNetworkError(error);
        setSyncStatus(
          offline ? "offline" : "error",
          offline ? "Sin conexión · datos locales" : "Datos locales · error de sincronización"
        );
        return {
          state: cached,
          hasData: true,
          fromCache: true,
          error,
          pendingSync: Boolean(readPersistedPendingState())
        };
      }

      setSyncStatus("error", "No se pudieron cargar los datos");
      throw errorWithContext(
        error,
        "sync",
        "Carga de datos del usuario",
        error?.code || "MASA_SYNC_LOAD"
      );
    }
  }

  function decodeProfileData(raw) {
    const data = plainObject(raw) ? raw : {};
    const wrapped = plainObject(data.profile);
    return {
      profile: wrapped ? data.profile : data,
      completedDays: wrapped && plainObject(data.completedDays) ? data.completedDays : {},
      foodUsage: wrapped && plainObject(data.foodUsage) ? data.foodUsage : {},
      catalogOverrides: wrapped && plainObject(data.catalogOverrides) ? data.catalogOverrides : {},
      calibrationHistory: wrapped && Array.isArray(data.calibrationHistory) ? data.calibrationHistory : [],
      lastCheckinDate: wrapped ? String(data.lastCheckinDate || "") : ""
    };
  }

  function foodFromRow(row) {
    const metadata = plainObject(row.metadata) ? clone(row.metadata) : {};
    return {
      ...metadata,
      id: row.legacy_id || metadata.id || row.id,
      cloudId: row.id,
      kind: "food",
      name: row.name,
      brand: row.brand || metadata.brand || "",
      serving: row.serving_text || metadata.serving || "1 porción",
      servingAmount: nullableNumber(row.serving_amount, metadata.servingAmount),
      servingUnit: row.serving_unit || metadata.servingUnit || "serving",
      servingUnitCustom: row.serving_unit_custom || metadata.servingUnitCustom || "",
      calories: Number(row.calories),
      protein: Number(row.protein),
      fat: Number(row.fat),
      carbs: Number(row.carbs)
    };
  }

  function ingredientFromRow(row) {
    const metadata = plainObject(row.metadata) ? clone(row.metadata) : {};
    return {
      ...metadata,
      id: metadata.id || row.id,
      cloudId: row.id,
      sourceId: metadata.sourceId || metadata.foodId || "",
      foodId: metadata.foodId || "",
      kind: metadata.kind || "food",
      name: row.ingredient_name,
      amount: Number(row.quantity),
      unit: row.quantity_unit || metadata.unit || "serving",
      serving: metadata.serving || "",
      calories: Number(row.calories),
      protein: Number(row.protein),
      fat: Number(row.fat),
      carbs: Number(row.carbs)
    };
  }

  function recipeFromRow(row, ingredients) {
    const metadata = plainObject(row.metadata) ? clone(row.metadata) : {};
    return {
      ...metadata,
      id: row.legacy_id || metadata.id || row.id,
      cloudId: row.id,
      kind: "recipe",
      name: row.name,
      recipeYield: Number(row.yield_amount),
      recipeYieldUnit: row.yield_unit || metadata.recipeYieldUnit || "serving",
      recipeYieldUnitCustom: row.yield_unit_custom || metadata.recipeYieldUnitCustom || "",
      recipeServingAmount: nullableNumber(row.serving_amount, metadata.recipeServingAmount || 1),
      serving: metadata.serving || "1 porción",
      servingAmount: nullableNumber(row.serving_amount, metadata.servingAmount || 1),
      servingUnit: row.yield_unit || metadata.servingUnit || "serving",
      servingUnitCustom: row.yield_unit_custom || metadata.servingUnitCustom || "",
      calories: Number(row.calories),
      protein: Number(row.protein),
      fat: Number(row.fat),
      carbs: Number(row.carbs),
      ingredients
    };
  }

  function diaryFromRows(rows) {
    return rows.reduce((result, row) => {
      if (!result[row.entry_date]) result[row.entry_date] = [];
      const metadata = plainObject(row.metadata) ? clone(row.metadata) : {};
      result[row.entry_date].push({
        ...metadata,
        id: row.legacy_id || metadata.id || row.id,
        cloudId: row.id,
        meal: row.meal,
        name: row.name,
        kind: row.kind,
        serving: row.serving_text || metadata.serving || "1 porción",
        servingAmount: nullableNumber(row.serving_amount, metadata.servingAmount || 1),
        servingUnit: row.serving_unit || metadata.servingUnit || "serving",
        servingUnitCustom: row.serving_unit_custom || metadata.servingUnitCustom || "",
        quantity: Number(row.quantity),
        quantityUnit: row.quantity_unit || metadata.quantityUnit || "",
        calories: Number(row.calories),
        protein: Number(row.protein),
        fat: Number(row.fat),
        carbs: Number(row.carbs)
      });
      return result;
    }, {});
  }

  async function loadGlobalFoodsFromRemote() {
    const rows = await fetchPaged(
      "foods",
      "id,external_id,source,name,brand,serving_text,serving_amount,serving_unit,serving_unit_custom,calories,protein,fat,carbs,metadata",
      query => query.is("owner_id", null).eq("is_active", true).order("name")
    );

    return rows.map(globalFoodFromRow).filter(Boolean);
  }

  async function loadGlobalFoods() {
    return withTimeout(loadGlobalFoodsFromRemote(), "La carga del catálogo general");
  }

  function globalFoodFromRow(row) {
    const metadata = plainObject(row.metadata) ? clone(row.metadata) : {};
    if (plainObject(metadata.per100g)) return metadata;

    const metricQuantity = positiveNumber(row.serving_amount, 100);
    const factor = 100 / metricQuantity;
    return {
      ...metadata,
      id: row.external_id || metadata.id || row.id,
      name: row.name,
      aliases: Array.isArray(metadata.aliases) ? metadata.aliases : [],
      sourceName: metadata.sourceName || row.brand || "",
      per100g: {
        calories: Number(row.calories) * factor,
        protein: Number(row.protein) * factor,
        fat: Number(row.fat) * factor,
        carbs: Number(row.carbs) * factor
      },
      serving: {
        ...(plainObject(metadata.serving) ? metadata.serving : {}),
        metric: { unit: "g", quantity: metricQuantity }
      }
    };
  }

  function scheduleStateSync(state) {
    pendingState = clone(state);
    persistPendingState(pendingState);
    lastSyncError = null;
    const online = navigator.onLine && !isOfflineSession();
    setSyncStatus(online ? "pending" : "offline", online ? "Cambios pendientes" : "Sin conexión · pendiente");
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      runPendingSync().catch(() => {});
    }, SYNC_DELAY_MS);
  }

  async function replaceState(state) {
    pendingState = clone(state);
    persistPendingState(pendingState);
    clearTimeout(syncTimer);
    syncTimer = null;
    await runPendingSync();
  }

  async function runPendingSync() {
    if (syncInFlight) return syncInFlight;
    if (!pendingState) pendingState = readPersistedPendingState();
    if (!pendingState) return;

    if (!navigator.onLine || isOfflineSession()) {
      persistPendingState(pendingState);
      setSyncStatus("offline", "Sin conexión · pendiente");
      return;
    }

    const snapshot = pendingState;
    pendingState = null;
    setSyncStatus("saving", "Guardando…");

    syncInFlight = withTimeout(syncState(snapshot), "La sincronización con Supabase")
      .then(() => {
        lastSyncError = null;
        cacheState(snapshot);
        if (pendingState) persistPendingState(pendingState);
        else clearPersistedPendingState();
        setSyncStatus(pendingState ? "pending" : "saved", pendingState ? "Cambios pendientes" : "Guardado");
      })
      .catch(error => {
        lastSyncError = error;
        if (!pendingState) pendingState = snapshot;
        persistPendingState(pendingState);
        setSyncStatus(
          navigator.onLine ? "error" : "offline",
          navigator.onLine ? "No se pudo guardar · queda pendiente" : "Sin conexión · pendiente"
        );
        throw error;
      })
      .finally(() => {
        syncInFlight = null;
        if (pendingState && !lastSyncError && navigator.onLine && !isOfflineSession()) {
          scheduleStateSync(pendingState);
        }
      });

    return syncInFlight;
  }

  async function flush() {
    clearTimeout(syncTimer);
    syncTimer = null;
    if (syncInFlight) await syncInFlight;
    if (pendingState) await runPendingSync();
  }

  async function syncState(state) {
    const user = currentUser();
    const nextSignatures = stateSignatures(state);
    const previous = syncedSignatures || {};
    let foodMap = syncedFoodMap;
    let recipeMap = syncedRecipeMap;

    if (nextSignatures.profile !== previous.profile) {
      await syncProfile(user.id, state);
    }
    if (nextSignatures.weighIns !== previous.weighIns) {
      await syncWeighIns(user.id, state.weighIns || []);
    }
    if (nextSignatures.foods !== previous.foods) {
      foodMap = await syncFoods(user.id, state.foods || []);
    }
    if (nextSignatures.recipes !== previous.recipes) {
      recipeMap = await syncRecipes(user.id, state.recipes || [], foodMap);
    }
    if (nextSignatures.diary !== previous.diary) {
      await syncDiary(user.id, state.diary || {}, foodMap, recipeMap);
    }

    syncedFoodMap = foodMap;
    syncedRecipeMap = recipeMap;
    syncedSignatures = nextSignatures;
  }

  function stateSignatures(state) {
    return {
      profile: JSON.stringify({
        version: state.version,
        configured: state.configured,
        profile: state.profile || {},
        completedDays: state.completedDays || {},
        foodUsage: state.foodUsage || {},
        catalogOverrides: state.catalogOverrides || {},
        calibrationHistory: state.calibrationHistory || [],
        lastCheckinDate: state.lastCheckinDate || ""
      }),
      weighIns: JSON.stringify(state.weighIns || []),
      foods: JSON.stringify(state.foods || []),
      recipes: JSON.stringify(state.recipes || []),
      diary: JSON.stringify(state.diary || {})
    };
  }

  async function syncProfile(userId, state) {
    const profile = plainObject(state.profile) ? state.profile : {};
    const row = {
      user_id: userId,
      display_name: profile.name || session?.user?.user_metadata?.name || null,
      configured: Boolean(state.configured),
      schema_version: Number(state.version) || SCHEMA_VERSION,
      profile_data: {
        profile,
        completedDays: plainObject(state.completedDays) ? state.completedDays : {},
        foodUsage: plainObject(state.foodUsage) ? state.foodUsage : {},
        catalogOverrides: plainObject(state.catalogOverrides) ? state.catalogOverrides : {},
        calibrationHistory: Array.isArray(state.calibrationHistory) ? state.calibrationHistory : [],
        lastCheckinDate: state.lastCheckinDate || ""
      },
      migration_completed_at: new Date().toISOString()
    };
    throwIfError(
      await getClient().from("profiles").upsert(row, { onConflict: "user_id" }),
      "No se pudo guardar el perfil"
    );
  }

  async function syncWeighIns(userId, weighIns) {
    const rows = weighIns.map(item => ({
      user_id: userId,
      legacy_id: String(item.id || crypto.randomUUID()),
      logged_on: item.date,
      weight_kg: Number(item.weight),
      metadata: item
    }));
    throwIfError(
      await getClient().from("weigh_ins").delete().eq("user_id", userId),
      "No se pudieron actualizar los pesajes"
    );
    await insertChunks("weigh_ins", rows, "No se pudieron guardar los pesajes");
  }

  async function syncFoods(userId, foods) {
    const rows = foods.map(food => ({
      owner_id: userId,
      legacy_id: String(food.id || crypto.randomUUID()),
      source: "user",
      name: food.name,
      brand: food.brand || null,
      serving_text: food.serving || null,
      serving_amount: numberOrNull(food.servingAmount),
      serving_unit: food.servingUnit || null,
      serving_unit_custom: food.servingUnitCustom || null,
      calories: nonNegative(food.calories),
      protein: nonNegative(food.protein),
      fat: nonNegative(food.fat),
      carbs: nonNegative(food.carbs),
      is_active: true,
      metadata: food
    }));
    return syncByLegacyId("foods", "owner_id", userId, rows, "owner_id,legacy_id");
  }

  async function syncRecipes(userId, recipes, foodMap) {
    const rows = recipes.map(recipe => ({
      user_id: userId,
      legacy_id: String(recipe.id || crypto.randomUUID()),
      name: recipe.name,
      yield_amount: positiveNumber(recipe.recipeYield, 1),
      yield_unit: recipe.recipeYieldUnit || recipe.servingUnit || null,
      yield_unit_custom: recipe.recipeYieldUnitCustom || recipe.servingUnitCustom || null,
      serving_amount: numberOrNull(recipe.recipeServingAmount ?? recipe.servingAmount),
      calories: nonNegative(recipe.calories),
      protein: nonNegative(recipe.protein),
      fat: nonNegative(recipe.fat),
      carbs: nonNegative(recipe.carbs),
      metadata: recipe
    }));

    const recipeMap = await syncByLegacyId("recipes", "user_id", userId, rows, "user_id,legacy_id");
    throwIfError(
      await getClient().from("recipe_ingredients").delete().eq("user_id", userId),
      "No se pudieron actualizar los ingredientes"
    );

    const ingredientRows = [];
    recipes.forEach(recipe => {
      const recipeId = recipeMap.get(String(recipe.id));
      if (!recipeId) return;
      (recipe.ingredients || []).forEach((ingredient, position) => {
        const localFoodId = String(ingredient.foodId || ingredient.sourceId || "");
        ingredientRows.push({
          user_id: userId,
          recipe_id: recipeId,
          food_id: foodMap.get(localFoodId) || null,
          position,
          ingredient_name: ingredient.name || "Ingrediente",
          quantity: positiveNumber(ingredient.amount, 1),
          quantity_unit: ingredient.unit || null,
          calories: nonNegative(ingredient.calories),
          protein: nonNegative(ingredient.protein),
          fat: nonNegative(ingredient.fat),
          carbs: nonNegative(ingredient.carbs),
          metadata: ingredient
        });
      });
    });

    await insertChunks("recipe_ingredients", ingredientRows, "No se pudieron guardar los ingredientes");
    return recipeMap;
  }

  async function syncDiary(userId, diary, foodMap, recipeMap) {
    const rows = [];
    Object.entries(diary).forEach(([date, entries]) => {
      (entries || []).forEach(entry => {
        const sourceId = String(entry.sourceId || "");
        rows.push({
          user_id: userId,
          legacy_id: String(entry.id || crypto.randomUUID()),
          entry_date: date,
          meal: entry.meal || "extras",
          name: entry.name || "Registro",
          kind: entry.kind || "food",
          serving_text: entry.serving || null,
          serving_amount: numberOrNull(entry.servingAmount),
          serving_unit: entry.servingUnit || null,
          serving_unit_custom: entry.servingUnitCustom || null,
          quantity: positiveNumber(entry.quantity, 1),
          quantity_unit: entry.quantityUnit || null,
          calories: nonNegative(entry.calories),
          protein: nonNegative(entry.protein),
          fat: nonNegative(entry.fat),
          carbs: nonNegative(entry.carbs),
          source_food_id: foodMap.get(sourceId) || null,
          source_recipe_id: recipeMap.get(sourceId) || null,
          metadata: entry
        });
      });
    });
    await syncByLegacyId("diary_entries", "user_id", userId, rows, "user_id,legacy_id");
  }

  async function syncByLegacyId(table, ownerColumn, ownerId, rows, conflict) {
    const existing = await fetchPaged(
      table,
      "id,legacy_id",
      query => query.eq(ownerColumn, ownerId)
    );
    const wanted = new Set(rows.map(row => String(row.legacy_id)));
    const staleIds = existing
      .filter(row => !row.legacy_id || !wanted.has(String(row.legacy_id)))
      .map(row => row.id);

    for (const batch of chunks(staleIds, BATCH_SIZE)) {
      throwIfError(
        await getClient().from(table).delete().in("id", batch),
        `No se pudieron borrar registros anteriores de ${table}`
      );
    }

    const resultMap = new Map();
    for (const batch of chunks(rows, BATCH_SIZE)) {
      const saved = throwIfError(
        await getClient().from(table).upsert(batch, { onConflict: conflict }).select("id,legacy_id"),
        `No se pudo guardar ${table}`
      ) || [];
      saved.forEach(row => resultMap.set(String(row.legacy_id), row.id));
    }
    return resultMap;
  }

  async function insertChunks(table, rows, context) {
    for (const batch of chunks(rows, BATCH_SIZE)) {
      throwIfError(await getClient().from(table).insert(batch), context);
    }
  }

  function chunks(values, size) {
    const result = [];
    for (let index = 0; index < values.length; index += size) {
      result.push(values.slice(index, index + size));
    }
    return result;
  }

  function plainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function numberOrNull(value) {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function nullableNumber(value, fallback = "") {
    if (value === null || value === undefined || value === "") return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function nonNegative(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function isAuthenticated() {
    return Boolean(session?.user);
  }

  async function recoverOnlineSession() {
    if (!isOfflineSession()) return true;
    try {
      const result = await withTimeout(getClient().auth.getSession(), "La recuperación de la sesión online");
      if (result.error) throw errorWithContext(result.error, "auth", "Recuperación de sesión online");
      const nextSession = result.data?.session;
      if (!nextSession?.user) {
        const gate = $("#auth-gate");
        if (gate) gate.hidden = false;
        showAuthMode("login");
        setAuthMessage("La sesión venció. Iniciá sesión para sincronizar los cambios guardados en este dispositivo.", true);
        setSyncStatus("error", "Iniciá sesión para sincronizar");
        return false;
      }
      acceptSession(nextSession);
      return true;
    } catch (error) {
      logRealError("auth", "No se pudo recuperar la sesión online", error);
      const gate = $("#auth-gate");
      if (gate) gate.hidden = false;
      showAuthMode("login");
      setAuthMessage("Iniciá sesión para sincronizar los cambios guardados en este dispositivo.", true);
      setSyncStatus("error", "Conexión recuperada · falta iniciar sesión");
      return false;
    }
  }

  async function resumeOnlineSync() {
    const sessionReady = await recoverOnlineSession();
    if (!sessionReady) return;
    if (!pendingState) pendingState = readPersistedPendingState();
    if (!pendingState) {
      setSyncStatus("saved", "Conectado");
      return;
    }

    lastSyncError = null;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      runPendingSync().catch(() => {});
    }, 100);
  }

  window.addEventListener("online", () => {
    resumeOnlineSync().catch(error => {
      logRealError("sync", "Falló la reanudación de la sincronización", error);
    });
  });

  window.addEventListener("offline", () => {
    if (!isAuthenticated()) return;
    const queued = pendingState || readPersistedPendingState();
    setSyncStatus("offline", queued ? "Sin conexión · cambios pendientes" : "Sin conexión · modo local");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && pendingState && navigator.onLine && !isOfflineSession()) {
      clearTimeout(syncTimer);
      syncTimer = null;
      runPendingSync().catch(() => {});
    }
  });

  window.MASA_CLOUD = Object.freeze({
    requireSession,
    loadUserState,
    loadGlobalFoods,
    scheduleStateSync,
    replaceState,
    flush,
    cacheState,
    readCachedState,
    isAuthenticated,
    hasPendingChanges: () => Boolean(pendingState || syncInFlight || readPersistedPendingState()),
    finishBoot,
    showFatalError,
    setSyncStatus,
    get user() { return session?.user || null; }
  });
})();
