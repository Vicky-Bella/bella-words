/* Service Worker：预缓存全部文件，让 iPad 加到主屏后离线秒开。
   更新 App 后请把下面的版本号 +1，用户下次打开即自动更新。 */
const CACHE = 'eb-v2';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './data.js',
  './manifest.webmanifest',
  './js/store.js',
  './js/scheduler.js',
  './js/parser.js',
  './js/app.js',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 缓存优先 + 后台更新：本地命中立即返回（快），同时静默拉取新版（保持最新）。 */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => hit || caches.match('./index.html'));
      return hit || net;
    })
  );
});
