(() => {
  "use strict";

  const SCHEMA_VERSION = 19;
  const CACHE_PREFIX = "masa-user-cache-v1:";
  const PAGE_SIZE = 1000;
  const BATCH_SIZE = 250;
  const SYNC_DELAY_MS = 700;

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

  function getClient() {
    if (client) return client;
    if (!configIsValid(window.MASA_CONFIG)) {
      throw new Error("Completá js/config.js con la URL y la Publishable key de Supabase.");
    }
    if (!window.supabase?.createClient) {
      throw new Error("No se pudo cargar el cliente de Supabase. Revisá la conexión a internet.");
    }

    client = window.supabase.createClient(
      window.MASA_CONFIG.supabaseUrl,
      window.MASA_CONFIG.supabaseKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );
    return client;
  }

  function throwIfError(result, context) {
    if (result?.error) throw new Error(`${context}: ${result.error.message}`);
    return result?.data;
  }

  function currentUser() {
    const user = session?.user;
    if (!user) throw new Error("No hay un usuario autenticado.");
    return user;
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
    $("#auth-login-form")?.setAttribute("hidden", "");
    $("#auth-signup-form")?.setAttribute("hidden", "");
    $("#auth-recovery-form")?.removeAttribute("hidden");
    $("#auth-loading")?.setAttribute("hidden", "");
    $("#auth-forms")?.removeAttribute("hidden");
    setAuthMessage("Elegí una contraseña nueva para tu cuenta.");
  }

  function showLoadingGate(text = "Cargando tus datos…") {
    const gate = $("#auth-gate");
    if (!gate) return;
    gate.hidden = false;
    $("#auth-forms")?.setAttribute("hidden", "");
    $("#auth-loading")?.removeAttribute("hidden");
    const label = $("#auth-loading-text");
    if (label) label.textContent = text;
  }

  function showFatalError(error) {
    const gate = $("#auth-gate");
    if (gate) gate.hidden = false;
    $("#auth-loading")?.setAttribute("hidden", "");
    $("#auth-forms")?.removeAttribute("hidden");
    showAuthMode("login");
    setAuthMessage(error?.message || String(error), true);
  }

  function finishBoot() {
    appBooted = true;
    const gate = $("#auth-gate");
    if (gate) gate.hidden = true;
    document.body.classList.add("cloud-ready");
    updateAccountUI();
  }

  function updateAccountUI() {
    const email = session?.user?.email || "";
    const accountEmail = $("#account-email");
    if (accountEmail) accountEmail.textContent = email;
    const accountArea = $("#account-area");
    if (accountArea) accountArea.hidden = !email;
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

  function handleSignedOut() {
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

  function bindAuthUI() {
    if (authBound) return;
    authBound = true;

    $("#auth-mode-login")?.addEventListener("click", () => showAuthMode("login"));
    $("#auth-mode-signup")?.addEventListener("click", () => showAuthMode("signup"));

    $("#auth-login-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      setAuthBusy(true);
      setAuthMessage("");
      try {
        const form = event.currentTarget;
        const result = await getClient().auth.signInWithPassword({
          email: form.elements.email.value.trim(),
          password: form.elements.password.value
        });
        throwIfError(result, "No se pudo iniciar sesión");
        session = result.data.session;
        showLoadingGate();
        updateAccountUI();
        resolveSessionWaiters();
      } catch (error) {
        setAuthMessage(humanizeAuthError(error), true);
      } finally {
        setAuthBusy(false);
      }
    });

    $("#auth-signup-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      setAuthBusy(true);
      setAuthMessage("");
      try {
        const form = event.currentTarget;
        const password = form.elements.password.value;
        if (password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres.");
        const result = await getClient().auth.signUp({
          email: form.elements.email.value.trim(),
          password,
          options: {
            data: { name: form.elements.name.value.trim() }
          }
        });
        throwIfError(result, "No se pudo crear la cuenta");
        if (result.data.session) {
          session = result.data.session;
          showLoadingGate();
          resolveSessionWaiters();
        } else {
          showAuthMode("login");
          $("#auth-login-form").elements.email.value = form.elements.email.value.trim();
          setAuthMessage("Cuenta creada. Revisá tu correo para confirmarla y después iniciá sesión.");
        }
      } catch (error) {
        setAuthMessage(humanizeAuthError(error), true);
      } finally {
        setAuthBusy(false);
      }
    });

    $("#forgot-password")?.addEventListener("click", async () => {
      const email = $("#auth-login-form")?.elements.email.value.trim();
      if (!email) {
        setAuthMessage("Escribí tu correo antes de solicitar el enlace.", true);
        $("#auth-login-form")?.elements.email.focus();
        return;
      }
      setAuthBusy(true);
      try {
        const redirectTo = `${location.origin}${location.pathname}`;
        const result = await getClient().auth.resetPasswordForEmail(email, { redirectTo });
        throwIfError(result, "No se pudo enviar el enlace");
        setAuthMessage("Te enviamos un enlace para cambiar la contraseña.");
      } catch (error) {
        setAuthMessage(humanizeAuthError(error), true);
      } finally {
        setAuthBusy(false);
      }
    });

    $("#auth-recovery-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      setAuthBusy(true);
      try {
        const password = event.currentTarget.elements.password.value;
        if (password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres.");
        const result = await getClient().auth.updateUser({ password });
        throwIfError(result, "No se pudo actualizar la contraseña");
        recoveryMode = false;
        setAuthMessage("Contraseña actualizada.");
        showLoadingGate();
        resolveSessionWaiters();
      } catch (error) {
        setAuthMessage(humanizeAuthError(error), true);
      } finally {
        setAuthBusy(false);
      }
    });

    $("#logout-button")?.addEventListener("click", async () => {
      try {
        setSyncStatus("saving", "Guardando…");
        await flush();
      } catch (_) {}
      await getClient().auth.signOut();
      location.reload();
    });
  }

  function humanizeAuthError(error) {
    const message = error?.message || String(error);
    if (/invalid login credentials/i.test(message)) return "Correo o contraseña incorrectos.";
    if (/email not confirmed/i.test(message)) return "Primero confirmá la cuenta desde el correo que recibiste.";
    if (/user already registered/i.test(message)) return "Ya existe una cuenta con ese correo.";
    return message;
  }

  async function startAuth() {
    if (authStarted) return session;
    authStarted = true;
    bindAuthUI();

    try {
      const supabaseClient = getClient();
      supabaseClient.auth.onAuthStateChange((event, nextSession) => {
        session = nextSession;
        updateAccountUI();
        if (event === "PASSWORD_RECOVERY") {
          recoveryMode = true;
          const gate = $("#auth-gate");
          if (gate) gate.hidden = false;
          showRecoveryMode();
          return;
        }
        if (nextSession) resolveSessionWaiters();
        else if (event === "SIGNED_OUT") handleSignedOut();
      });

      const result = await supabaseClient.auth.getSession();
      throwIfError(result, "No se pudo recuperar la sesión");
      session = result.data.session;
      updateAccountUI();
      return session;
    } catch (error) {
      showFatalError(error);
      throw error;
    }
  }

  async function requireSession() {
    const current = await startAuth();
    if (current && !recoveryMode) {
      showLoadingGate();
      return current;
    }
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

  function cacheState(state) {
    try {
      localStorage.setItem(cacheKey(), JSON.stringify(state));
    } catch (_) {}
  }

  function readCachedState() {
    try {
      const raw = localStorage.getItem(cacheKey());
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
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

  async function loadUserState() {
    const user = currentUser();
    setSyncStatus("loading", "Cargando…");

    try {
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
      syncedSignatures = stateSignatures(state);
      syncedFoodMap = new Map(foodRows.map(row => [String(row.legacy_id || row.id), row.id]));
      syncedRecipeMap = new Map(recipeRows.map(row => [String(row.legacy_id || row.id), row.id]));
      cacheState(state);
      setSyncStatus("saved", "Guardado");
      return { state, hasData, fromCache: false };
    } catch (error) {
      const cached = readCachedState();
      if (cached) {
        setSyncStatus("offline", "Sin conexión · caché local");
        return { state: cached, hasData: true, fromCache: true, error };
      }
      setSyncStatus("error", "Error de carga");
      throw error;
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

  async function loadGlobalFoods() {
    const rows = await fetchPaged(
      "foods",
      "id,external_id,source,name,brand,serving_text,serving_amount,serving_unit,serving_unit_custom,calories,protein,fat,carbs,metadata",
      query => query.is("owner_id", null).eq("is_active", true).order("name")
    );

    return rows.map(globalFoodFromRow).filter(Boolean);
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
    cacheState(pendingState);
    lastSyncError = null;
    setSyncStatus(navigator.onLine ? "pending" : "offline", navigator.onLine ? "Cambios pendientes" : "Sin conexión · pendiente");
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      runPendingSync().catch(() => {});
    }, SYNC_DELAY_MS);
  }

  async function replaceState(state) {
    pendingState = clone(state);
    cacheState(pendingState);
    clearTimeout(syncTimer);
    syncTimer = null;
    await runPendingSync();
  }

  async function runPendingSync() {
    if (syncInFlight) return syncInFlight;
    if (!pendingState) return;

    const snapshot = pendingState;
    pendingState = null;
    setSyncStatus("saving", "Guardando…");

    syncInFlight = syncState(snapshot)
      .then(() => {
        lastSyncError = null;
        cacheState(snapshot);
        setSyncStatus("saved", "Guardado");
      })
      .catch(error => {
        lastSyncError = error;
        if (!pendingState) pendingState = snapshot;
        setSyncStatus(navigator.onLine ? "error" : "offline", navigator.onLine ? "No se pudo guardar" : "Sin conexión · pendiente");
        throw error;
      })
      .finally(() => {
        syncInFlight = null;
        if (pendingState && !lastSyncError && navigator.onLine) scheduleStateSync(pendingState);
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

  window.addEventListener("online", () => {
    if (pendingState) {
      lastSyncError = null;
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        syncTimer = null;
        runPendingSync().catch(() => {});
      }, 100);
    }
  });

  window.addEventListener("offline", () => {
    if (isAuthenticated()) setSyncStatus("offline", "Sin conexión");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && pendingState && navigator.onLine) {
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
    finishBoot,
    showFatalError,
    setSyncStatus,
    get user() { return session?.user || null; }
  });
})();
