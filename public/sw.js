/* Service worker: keeps the app shell available with no network and shows
 * Web Push "your drink is ready" notifications. API calls are never cached. */
const VERSION = 'bb-v3';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/shared/core.js', '/vendor/qrcode.js', '/vendor/jsqr.js',
  '/guest.html', '/guest.js', '/menu.html', '/manifest.webmanifest', '/guest.webmanifest', '/icons/icon.svg',
  '/vendor/fonts/archivo.woff2', '/vendor/ph/bold/style.css', '/vendor/ph/bold/Phosphor-Bold.woff2',
  '/stage.js', '/demo.html', '/brand/AlteHaasGroteskRegular.woff2', '/brand/AlteHaasGroteskBold.woff2', '/brand/mark-ink.png', '/brand/mark-white.png', '/brand/logo-white.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (e.request.mode === 'navigate') {
    const fallback = url.pathname.startsWith('/o/') ? '/guest.html' : url.pathname === '/m' ? '/menu.html' : '/index.html';
    e.respondWith(fetch(e.request).then((res) => {
      const copy = res.clone(); caches.open(VERSION).then((c) => c.put(fallback, copy)); return res;
    }).catch(() => caches.match(fallback)));
    return;
  }
  // Network-first with a short timeout, so a fresh deploy is picked up on the
  // next load, but a flaky hall connection falls back to the cache quickly.
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); } return res; });
    if (!hit) return net;
    const timeout = new Promise((r) => setTimeout(() => r(hit), 2500));
    return Promise.race([net.catch(() => hit), timeout]);
  })());
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch (err) { d = { title: 'Your drink is ready', body: 'Pick it up at the Beans&Beats counter.' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Your drink is ready', {
    body: d.body, tag: d.tag, renotify: true, requireInteraction: true, vibrate: [400, 150, 400, 150, 800],
    icon: '/icons/icon.svg', badge: '/icons/icon.svg', data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (new URL(c.url).pathname === target && 'focus' in c) return c.focus();
    return self.clients.openWindow(target);
  }));
});
