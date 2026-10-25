/* Service Worker：外壳离线缓存 + 网络优先（保证改版后立刻生效） */
const CACHE = 'coursetable-v1.2.0';
const ASSETS = [
  './',
  './index.html',
  './version.json',
  './assets/app.css',
  './assets/app.js',
  './assets/parser.js',
  './assets/pdf-import.js',
  './assets/validate.js',
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png'
];
const NET_TIMEOUT = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ASSETS.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    // 网络优先：改版后立刻拿到新文件；断网时回退缓存
    try {
      const res = await fetchWithTimeout(req, NET_TIMEOUT);
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      // ignoreSearch：兼容 assets/app.js?v=1.2.0 与预缓存的 assets/app.js
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html', { ignoreSearch: true });
        if (shell) return shell;
      }
      return new Response('离线，且这份内容没有缓存', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});
