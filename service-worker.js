const CACHE = "masa-v18";
const APP_SHELL = [
  "/masa/",
  "/masa/index.html",
  "/masa/css/styles.css?v=18",
  "/masa/css/auth.css?v=18",
  "/masa/js/config.js?v=18",
  "/masa/js/cloud.js?v=18",
  "/masa/js/app.js?v=18",
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
