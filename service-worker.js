const CACHE = "masa-v7";
const APP_SHELL = [
  "/masa/",
  "/masa/index.html",
  "/masa/css/styles.css",
  "/masa/js/app.js",
  "/masa/assets/favicon.svg",
  "/masa/manifest.webmanifest",
  "/masa/plantilla-pesajes.csv"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match(event.request).then(hit => hit || caches.match("/masa/index.html"))));
});
