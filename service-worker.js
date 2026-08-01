const CACHE = "masa-v31.0.4";
const APP_SHELL = [
  "/masa/",
  "/masa/index.html",
  "/masa/privacy.html",
  "/masa/terms.html",
  "/masa/css/styles.css?v=31.0.4",
  "/masa/css/auth.css?v=30.6",
  "/masa/js/config.js?v=30.6",
  "/masa/js/cloud.js?v=30.6",
  "/masa/js/app.js?v=31.0.4",
  "/masa/assets/favicon.svg",
  "/masa/manifest.webmanifest",
  "/masa/DATA-LICENSE.md",
  "/masa/plantilla-pesajes.xlsx",
  "/masa/plantilla-ingestas.xlsx"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith("masa-v") && key !== CACHE).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Las respuestas del proxy alimentario siempre deben ser actuales y nunca
  // confundirse con la página principal cuando no hay conexión.
  if (url.pathname.startsWith("/api/open-food-facts/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        return caches.match(new URL("/masa/index.html", self.location.origin).href);
      })
  );
});
