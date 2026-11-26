// Простой service worker: держит «оболочку» приложения в кэше,
// чтобы оно ставилось на телефон как приложение и быстро открывалось.
// Данные (объекты) всегда берутся с сервера — их он не кэширует.
const CACHE = "obekty-v1";
const SHELL = ["./", "index.html", "styles.css", "app.js", "config.js", "manifest.webmanifest", "icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // сначала сеть (чтобы обновления доходили сразу), при отсутствии сети — кэш
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
  );
});
