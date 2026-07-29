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
  make("#account-email");
  make("#account-area");
  make("#logout-button");
  make("#sync-status");
  make("#forgot-password");

  const loginForm = make("#auth-login-form");
  const signupForm = make("#auth-signup-form");
  const recoveryForm = make("#auth-recovery-form");
  const loginEmail = new FakeElement({ type: "email" });
  const loginPassword = new FakeElement({ type: "password" });
  const signupEmail = new FakeElement({ type: "email" });
  const signupPassword = new FakeElement({ type: "password" });
  const signupName = new FakeElement({ type: "text" });
  const recoveryPassword = new FakeElement({ type: "password" });

  loginForm.childrenBySelector.set('input[name="email"]', loginEmail);
  loginForm.childrenBySelector.set('input[name="password"]', loginPassword);
  loginForm.elements = { email: loginEmail, password: loginPassword };
  signupForm.childrenBySelector.set('input[name="email"]', signupEmail);
  signupForm.childrenBySelector.set('input[name="password"]', signupPassword);
  signupForm.childrenBySelector.set('input[name="name"]', signupName);
  signupForm.elements = { email: signupEmail, password: signupPassword, name: signupName };
  recoveryForm.childrenBySelector.set('input[name="password"]', recoveryPassword);
  recoveryForm.elements = { password: recoveryPassword };

  const passwordField = new FakeElement();
  passwordField.childrenBySelector.set("input", loginPassword);
  const eye = new FakeElement({ type: "button" });
  eye.closestElement = passwordField;

  const allBusy = [loginEmail, loginPassword, signupEmail, signupPassword, signupName, recoveryPassword, eye];
  const document = {
    body: { classList: new FakeClassList() },
    activeElement: null,
    querySelector(selector) { return selectors.get(selector) || null; },
    querySelectorAll(selector) {
      if (selector === "[data-password-toggle]") return [eye];
      if (selector === "#auth-gate button, #auth-gate input") return allBusy;
      return [];
    },
    addEventListener() {}
  };
  const originalFocus = loginPassword.focus.bind(loginPassword);
  loginPassword.focus = () => { originalFocus(); document.activeElement = loginPassword; };

  return { document, gate, loading, forms, loginForm, loginEmail, loginPassword, eye, authMessage: selectors.get("#auth-message") };
}

async function createRuntime({ initialSession = null, signInResult }) {
  const dom = buildDom();
  const storage = new Map();
  let createClientCalls = 0;
  let clientOptions = null;
  let signInCredentials = null;
  let signUpCredentials = null;
  let authCallback = null;

  const session = initialSession || { user: { id: "user-1", email: "user@example.com" } };
  const auth = {
    onAuthStateChange(callback) { authCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { return { data: { session: initialSession }, error: null }; },
    async signInWithPassword(credentials) {
      signInCredentials = credentials;
      return signInResult || { data: { session }, error: null };
    },
    async signUp(credentials) {
      signUpCredentials = credentials;
      return { data: { session }, error: null };
    },
    async updateUser() { return { data: {}, error: null }; },
    async resetPasswordForEmail() { return { data: {}, error: null }; },
    async signOut() { return { error: null }; }
  };
  const client = { auth, from() { throw new Error("Database access is not expected in this auth test."); } };

  const window = {
    MASA_CONFIG: { supabaseUrl: "https://example.supabase.co", supabaseKey: "sb_publishable_test" },
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
    navigator: { onLine: true },
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
    get authCallback() { return authCallback; }
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
  assert.equal(runtime.dom.loading.hidden, true);
  assert.equal(runtime.dom.gate.hidden, true);
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

await testExistingSession();
await testLoginReadsLiveInput();
await testSignupReadsLiveInput();
await testCredentialErrorMessage();
console.log("Auth flow tests: OK");
