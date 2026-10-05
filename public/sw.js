// オフラインでも開けるように、ページを手元に置いておく（Service Worker）。
// いつもはネットの新しい版を先に取りに行き（取れたら手元も新しくする）、つながらないときだけ手元の版を出す
const CACHE = 'bent-toy-v1';
const CORE = ['./', 'index.html', 'studio.html', 'sampler.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit ?? (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))),
  );
});
