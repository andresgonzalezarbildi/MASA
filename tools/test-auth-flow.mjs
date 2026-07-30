import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(name) { this.values.add(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name); else this.values.delete(name);
    return enabled;
  }
}

class FakeElement {
  constructor({ value = "", type = "div" } = {}) {
    this.value = value;
    this.type = type;
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.dataset = {};
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.attributes = new Map();
    this.childrenBySelector = new Map();
    this.elements = {};
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.selectionDirection = "none";
    this.focused = false;
    this.closestElement = null;
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  async emit(type, extra = {}) {
    const event = { preventDefault() {}, currentTarget: this, ...extra };
    for (const listener of this.listeners.get(type) || []) await listener(event);
  }
  querySelector(selector) { return this.childrenBySelector.get(selector) || null; }
  querySelectorAll() { return []; }
  closest() { return this.closestElement; }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "hidden") this.hidden = true;
  }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "hidden") this.hidden = false;
  }
  toggleAttribute(name, force) {
    if (force) this.setAttribute(name, ""); else this.removeAttribute(name);
  }
  focus() { this.focused = true; }
  reset() {
    Object.values(this.elements || {}).forEach(element => { element.value = ""; });
  }
  setSelectionRange(start, end, direction) {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  }
}

function buildDom() {
  const selectors = new Map();
  const make = (selector, options) => {
    const element = new FakeElement(options);
    selectors.set(selector, element);
    return element;
  };

  const gate = make("#auth-gate");
  const loading = make("#auth-loading");
  loading.hidden = true;
  const forms = make("#auth-forms");
  make("#auth-loading-text");
  make("#auth-message");
  make("#auth-mode-login");
  make("#auth-mode-signup");
  const googleLoginButton = new FakeElement({ type: "button" });
  const googleSignupButton = new FakeElement({ type: "button" });
  make("#account-email");
  make("#account-area");
  make("#logout-button");
  make("#sync-status");
  make("#forgot-password");
  make("#security-account-email");
  make("#account-security-feedback");
  make("#account-provider-note");
  make("#account-security-description");

  const loginForm = make("#auth-login-form");
  const signupForm = make("#auth-signup-form");
  const recoveryForm = make("#auth-recovery-form");
  const accountPasswordForm = make("#account-password-form");
  const loginEmail = new FakeElement({ type: "email" });
  const loginPassword = new FakeElement({ type: "password" });
  const signupEmail = new FakeElement({ type: "email" });
  const signupPassword = new FakeElement({ type: "password" });
  const signupName = new FakeElement({ type: "text" });
  const recoveryPassword = new FakeElement({ type: "password" });
  const currentPassword = new FakeElement({ type: "password" });
  const newPassword = new FakeElement({ type: "password" });
  const confirmPassword = new FakeElement({ type: "password" });

  loginForm.childrenBySelector.set('input[name="email"]', loginEmail);
  loginForm.childrenBySelector.set('input[name="password"]', loginPassword);
  loginForm.elements = { email: loginEmail, password: loginPassword };
  signupForm.childrenBySelector.set('input[name="email"]', signupEmail);
  signupForm.childrenBySelector.set('input[name="password"]', signupPassword);
  signupForm.childrenBySelector.set('input[name="name"]', signupName);
  signupForm.elements = { email: signupEmail, password: signupPassword, name: signupName };
  recoveryForm.childrenBySelector.set('input[name="password"]', recoveryPassword);
  recoveryForm.elements = { password: recoveryPassword };
  accountPasswordForm.elements = { currentPassword, newPassword, confirmPassword };

  const passwordField = new FakeElement();
  passwordField.childrenBySelector.set("input", loginPassword);
  const eye = new FakeElement({ type: "button" });
  eye.closestElement = passwordField;

  const allBusy = [googleLoginButton, googleSignupButton, loginEmail, loginPassword, signupEmail, signupPassword, signupName, recoveryPassword, eye];
  const accountBusy = [currentPassword, newPassword, confirmPassword];
  const document = {
    body: { classList: new FakeClassList() },
    activeElement: null,
    querySelector(selector) { return selectors.get(selector) || null; },
    querySelectorAll(selector) {
      if (selector === "[data-password-toggle]") return [eye];
      if (selector === "[data-auth-google]") return [googleLoginButton, googleSignupButton];
      if (selector === "#auth-gate button, #auth-gate input") return allBusy;
      if (selector === "#account-password-form input, #account-password-form button") return accountBusy;
      return [];
    },
    addEventListener() {}
  };
  const originalFocus = loginPassword.focus.bind(loginPassword);
  loginPassword.focus = () => { originalFocus(); document.activeElement = loginPassword; };

  return {
    document,
    gate,
    loading,
    forms,
    loginForm,
    googleButton: googleLoginButton,
    googleSignupButton,
    loginEmail,
    loginPassword,
    eye,
    accountPasswordForm,
    currentPassword,
    newPassword,
    confirmPassword,
    accountFeedback: selectors.get("#account-security-feedback"),
    authMessage: selectors.get("#auth-message")
  };
}

async function createRuntime({ initialSession = null, signInResult, online = true, getSessionError = null, initialStorage = {}, native = false }) {
  const dom = buildDom();
  const storage = new Map(Object.entries(initialStorage));
  let createClientCalls = 0;
  let clientOptions = null;
  let signInCredentials = null;
  let signUpCredentials = null;
  let updateCredentials = null;
  let resetPasswordArgs = null;
  let oauthArgs = null;
  let openedAuthUrl = null;
  let authCallback = null;

  const session = initialSession || { user: { id: "user-1", email: "user@example.com" } };
  const auth = {
    onAuthStateChange(callback) { authCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { return { data: { session: initialSession }, error: getSessionError }; },
    async signInWithPassword(credentials) {
      signInCredentials = credentials;
      return signInResult || { data: { session }, error: null };
    },
    async signUp(credentials) {
      signUpCredentials = credentials;
      return { data: { session }, error: null };
    },
    async updateUser(credentials) {
      updateCredentials = credentials;
      return { data: {}, error: null };
    },
    async resetPasswordForEmail(email, options) {
      resetPasswordArgs = { email, options };
      return { data: {}, error: null };
    },
    async signInWithOAuth(args) {
      oauthArgs = args;
      return { data: { url: "https://accounts.google.test/" }, error: null };
    },
    async setSession() { return { data: { session }, error: null }; },
    async signOut() { return { error: null }; }
  };
  const client = { auth, from() { throw new Error("Database access is not expected in this auth test."); } };

  const window = {
    MASA_CONFIG: {
      supabaseUrl: "https://example.supabase.co",
      authRedirectUrl: "https://example.com/masa/",
      nativeAuthRedirectUrl: "masa://auth/callback",
      supabaseKey: "sb_publishable_test"
    },
    MASA_NATIVE: {
      isNative() { return native; },
      async openAuthUrl(url) { openedAuthUrl = url; },
      async getInitialAuthUrl() { return ""; }
    },
    supabase: {
      createClient(_url, _key, options) {
        createClientCalls += 1;
        clientOptions = options;
        return client;
      }
    },
    addEventListener() {},
    location: null
  };
  const location = { search: "", hash: "", origin: "https://localhost", pathname: "/" };
  window.location = location;
  window.window = window;

  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); }
  };

  const context = vm.createContext({
    window,
    document: dom.document,
    location,
    navigator: { onLine: online },
    localStorage,
    console,
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    requestAnimationFrame(callback) { callback(); },
    URL,
    Promise,
    Map,
    Object,
    Boolean,
    String,
    Number,
    Math,
    JSON,
    RegExp,
    Error
  });
  const source = await readFile(new URL("../js/cloud.js", import.meta.url), "utf8");
  vm.runInContext(source, context, { filename: "cloud.js" });

  return {
    cloud: window.MASA_CLOUD,
    dom,
    session,
    get createClientCalls() { return createClientCalls; },
    get clientOptions() { return clientOptions; },
    get signInCredentials() { return signInCredentials; },
    get signUpCredentials() { return signUpCredentials; },
    get updateCredentials() { return updateCredentials; },
    get resetPasswordArgs() { return resetPasswordArgs; },
    get oauthArgs() { return oauthArgs; },
    get openedAuthUrl() { return openedAuthUrl; },
    get authCallback() { return authCallback; },
    storage
  };
}

async function testExistingSession() {
  const session = { user: { id: "existing", email: "existing@example.com" } };
  const runtime = await createRuntime({ initialSession: session });
  const returned = await runtime.cloud.requireSession();
  assert.equal(returned, session);
  assert.equal(runtime.createClientCalls, 1);
  assert.equal(runtime.clientOptions.auth.persistSession, true);
  assert.equal(runtime.clientOptions.auth.autoRefreshToken, true);
  assert.equal(typeof runtime.clientOptions.auth.storage.getItem, "function");
  assert.equal(runtime.dom.loading.hidden, true);
  assert.equal(runtime.dom.gate.hidden, true);
}

async function testLoginReadsLiveInput() {
  const runtime = await createRuntime({ initialSession: null });
  const waitingForSession = runtime.cloud.requireSession();
  await new Promise(resolve => setTimeout(resolve, 0));

  runtime.dom.loginEmail.value = "  user@example.com  ";
  runtime.dom.loginPassword.value = "  exact password  ";
  runtime.dom.loginPassword.selectionStart = 4;
  runtime.dom.loginPassword.selectionEnd = 9;
  await runtime.dom.eye.emit("click");
  assert.equal(runtime.dom.loginPassword.value, "  exact password  ");
  assert.equal(runtime.dom.loginPassword.type, "text");
  assert.equal(runtime.dom.loginPassword.selectionStart, 4);
  assert.equal(runtime.dom.loginPassword.selectionEnd, 9);
  assert.equal(runtime.dom.loginPassword.focused, true);

  await runtime.dom.loginForm.emit("submit");
  const session = await waitingForSession;
  assert.equal(session, runtime.session);
  assert.equal(runtime.signInCredentials.email, "user@example.com");
  assert.equal(runtime.signInCredentials.password, "  exact password  ");
  assert.equal(runtime.dom.loading.hidden, true);
  assert.equal(runtime.dom.gate.hidden, true);
  assert.equal(runtime.createClientCalls, 1);
}


async function testSignupReadsLiveInput() {
  const runtime = await createRuntime({ initialSession: null });
  const waitingForSession = runtime.cloud.requireSession();
  await new Promise(resolve => setTimeout(resolve, 0));

  const signupForm = runtime.dom.document.querySelector("#auth-signup-form");
  signupForm.elements.email.value = "  new@example.com  ";
  signupForm.elements.password.value = "  signup password  ";
  signupForm.elements.name.value = "  Andrés  ";
  await signupForm.emit("submit");

  assert.equal(await waitingForSession, runtime.session);
  assert.equal(runtime.signUpCredentials.email, "new@example.com");
  assert.equal(runtime.signUpCredentials.password, "  signup password  ");
  assert.equal(runtime.signUpCredentials.options.data.name, "Andrés");
  assert.equal(runtime.signUpCredentials.options.emailRedirectTo, "https://example.com/masa/");
  assert.equal(runtime.dom.loading.hidden, true);
  assert.equal(runtime.dom.gate.hidden, true);
}

async function testAccountPasswordChangeWithoutResetLink() {
  const runtime = await createRuntime({ initialSession: { user: { id: "user-1", email: "account@example.com" } } });
  await runtime.cloud.requireSession();
  runtime.cloud.refreshAccountSecurity();

  runtime.dom.currentPassword.value = "old password";
  runtime.dom.newPassword.value = "new password";
  runtime.dom.confirmPassword.value = "new password";
  await runtime.dom.accountPasswordForm.emit("submit");

  assert.equal(runtime.updateCredentials.current_password, "old password");
  assert.equal(runtime.updateCredentials.password, "new password");
  assert.equal(runtime.dom.accountFeedback.textContent, "Contraseña actualizada correctamente.");
}


async function testNativePasswordResetUsesWebReturn() {
  const runtime = await createRuntime({ initialSession: null, native: true });
  runtime.cloud.requireSession();
  await new Promise(resolve => setTimeout(resolve, 0));
  runtime.dom.loginEmail.value = "user@example.com";
  await runtime.dom.document.querySelector("#forgot-password").emit("click");
  assert.equal(runtime.resetPasswordArgs.email, "user@example.com");
  assert.equal(runtime.resetPasswordArgs.options.redirectTo, "https://example.com/masa/");
}


async function testGoogleAccountHidesPasswordForm() {
  const googleSession = {
    user: {
      id: "google-user",
      email: "google@example.com",
      app_metadata: { provider: "google", providers: ["google"] },
      identities: [{ provider: "google" }]
    }
  };
  const runtime = await createRuntime({ initialSession: googleSession });
  await runtime.cloud.requireSession();
  runtime.cloud.refreshAccountSecurity();
  assert.equal(runtime.dom.accountPasswordForm.hidden, true);
  assert.equal(runtime.dom.document.querySelector("#account-provider-note").hidden, false);
}

async function testGoogleLoginUsesConfiguredReturn() {
  const runtime = await createRuntime({ initialSession: null });
  runtime.cloud.requireSession();
  await new Promise(resolve => setTimeout(resolve, 0));
  await runtime.dom.googleButton.emit("click");
  assert.equal(runtime.oauthArgs.provider, "google");
  assert.equal(runtime.oauthArgs.options.redirectTo, "https://example.com/masa/");
  assert.equal(runtime.oauthArgs.options.skipBrowserRedirect, false);
}

async function testGoogleSignupButtonUsesSameFlow() {
  const runtime = await createRuntime({ initialSession: null });
  runtime.cloud.requireSession();
  await new Promise(resolve => setTimeout(resolve, 0));
  await runtime.dom.googleSignupButton.emit("click");
  assert.equal(runtime.oauthArgs.provider, "google");
  assert.equal(runtime.oauthArgs.options.redirectTo, "https://example.com/masa/");
}

async function testNativeGoogleLoginUsesDeepLink() {
  const runtime = await createRuntime({ initialSession: null, native: true });
  runtime.cloud.requireSession();
  await new Promise(resolve => setTimeout(resolve, 0));
  await runtime.dom.googleButton.emit("click");
  assert.equal(runtime.oauthArgs.provider, "google");
  assert.equal(runtime.oauthArgs.options.redirectTo, "masa://auth/callback");
  assert.equal(runtime.oauthArgs.options.skipBrowserRedirect, true);
  assert.equal(runtime.openedAuthUrl, "https://accounts.google.test/");
  assert.equal(runtime.clientOptions.auth.detectSessionInUrl, false);
}

async function testCredentialErrorMessage() {
  const authError = Object.assign(new Error("Invalid login credentials"), { code: "invalid_credentials", status: 400 });
  const runtime = await createRuntime({
    initialSession: null,
    signInResult: { data: { session: null }, error: authError }
  });
  runtime.cloud.requireSession();
  await new Promise(resolve => setTimeout(resolve, 0));
  runtime.dom.loginEmail.value = "user@example.com";
  runtime.dom.loginPassword.value = "wrong password";
  await runtime.dom.loginForm.emit("submit");
  assert.equal(runtime.dom.authMessage.textContent, "Credenciales incorrectas");
  assert.equal(runtime.dom.loading.hidden, true);
  assert.equal(runtime.dom.gate.hidden, false);
}

async function testOfflineSessionAndDurableQueue() {
  const cachedState = { configured: true, weighIns: [{ id: "w1", date: "2026-07-30", weight: 73.5 }], diary: {} };
  const initialStorage = {
    "masa-last-user-v1": JSON.stringify({ id: "offline-user", email: "offline@example.com" }),
    "masa-user-cache-v1:offline-user": JSON.stringify(cachedState)
  };
  const networkError = Object.assign(new Error("Failed to fetch"), { code: "NETWORK" });
  const runtime = await createRuntime({
    initialSession: null,
    online: false,
    getSessionError: networkError,
    initialStorage
  });

  const offlineSession = await runtime.cloud.requireSession();
  assert.equal(offlineSession.user.id, "offline-user");
  assert.equal(offlineSession.masaOffline, true);
  assert.deepEqual(runtime.cloud.readCachedState(), cachedState);

  const changedState = { ...cachedState, diary: { "2026-07-30": [{ id: "d1", calories: 500 }] } };
  runtime.cloud.scheduleStateSync(changedState);
  const queued = JSON.parse(runtime.storage.get("masa-user-pending-v1:offline-user"));
  assert.deepEqual(queued, changedState);
  assert.equal(runtime.cloud.hasPendingChanges(), true);
}

await testExistingSession();
await testLoginReadsLiveInput();
await testSignupReadsLiveInput();
await testAccountPasswordChangeWithoutResetLink();
await testNativePasswordResetUsesWebReturn();
await testGoogleAccountHidesPasswordForm();
await testGoogleLoginUsesConfiguredReturn();
await testGoogleSignupButtonUsesSameFlow();
await testNativeGoogleLoginUsesDeepLink();
await testCredentialErrorMessage();
await testOfflineSessionAndDurableQueue();
console.log("Auth flow tests: OK");
