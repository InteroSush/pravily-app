// Пры змене любога файла рэдактара павялічце нумар кэшу.
const CACHE = "pdd-shell-v2";
const SHELL = ["./", "index.html", "style.css", "stem.js", "core.js", "app.js", "manifest.webmanifest",
               "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== "fonts").map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => {
      const net = fetch(req).then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return r;
      }).catch(() => hit || caches.match("index.html"));
      return hit || net;
    }));
  } else if (/(^|\.)(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.open("fonts").then(c => c.match(req).then(hit =>
      hit || fetch(req).then(r => { c.put(req, r.clone()); return r; }))));
  }
});
