/**
 * Service worker приложения GRAFF.
 *
 * Задача — чтобы установленное приложение открывалось без сети (меню, цены, свои заказы лежат на устройстве).
 * Стратегия: сеть в приоритете, кэш как запасной вариант; всё успешно загруженное складываем в кэш во время работы,
 * поэтому список файлов сборки (с хэшами в именах) заранее знать не нужно.
 */
const CACHE = 'graff-v1';
const OFFLINE_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(OFFLINE_URLS).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return; // чужие запросы не трогаем

  // Переходы по адресам: отдаём index.html (одностраничное приложение), офлайн — из кэша
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => { cachePut(req, res.clone()); return res; })
        .catch(() => caches.match('/index.html').then(r => r || caches.match('/'))
          .then(r => r || new Response('<h1>GRAFF</h1><p>Нет сети. Откройте приложение, когда появится интернет, или позвоните: +7 938 900-90-67.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))),
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then(res => { if (res && res.ok) cachePut(req, res.clone()); return res; })
      .catch(() => caches.match(req).then(r => r || Response.error())),
  );
});

function cachePut(req, res) {
  caches.open(CACHE).then(c => c.put(req, res)).catch(() => undefined);
}
