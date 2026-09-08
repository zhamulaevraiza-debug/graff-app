/**
 * Service worker приложения GRAFF.
 *
 * Задача — чтобы установленное приложение открывалось без сети (меню, цены, свои заказы лежат на устройстве).
 * Стратегия: сеть в приоритете, кэш как запасной вариант; всё успешно загруженное складываем в кэш во время работы,
 * поэтому список файлов сборки (с хэшами в именах) заранее знать не нужно.
 *
 * Пути считаются от области действия воркера, поэтому приложение работает и в корне домена,
 * и в подпапке (например, на GitHub Pages по адресу /graff-app/).
 */
const CACHE = 'graff-v2';
const BASE = new URL(self.registration.scope).pathname;
const INDEX = BASE + 'index.html';
const OFFLINE_URLS = [BASE, INDEX, BASE + 'manifest.webmanifest', BASE + 'icon.svg', BASE + 'icon-192.png', BASE + 'apple-touch-icon.png'];

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
        .catch(() => caches.match(INDEX).then(r => r || caches.match(BASE))
          .then(r => r || new Response(
            '<h1>GRAFF</h1><p>Нет сети. Откройте приложение, когда появится интернет, или позвоните: +7 938 900-90-67.</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          ))),
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

/* ======================= push-уведомления ======================= */

/**
 * Сообщение от сервера кафе (web-push, VAPID). Тело — JSON {title, body, tag, url}:
 * title и body показываем, tag склеивает повторные сообщения об одном заказе,
 * url — куда открыть приложение по нажатию.
 *
 * Показать уведомление обязательно: браузеры разрешают «тихий» push лишь несколько раз подряд,
 * дальше отзывают подписку. Поэтому даже на пустое или испорченное тело выводим общий текст.
 */
self.addEventListener('push', event => {
  const data = readPush(event.data);
  const title = typeof data.title === 'string' && data.title ? data.title : 'GRAFF';
  const tag = typeof data.tag === 'string' && data.tag ? data.tag : 'graff';
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === 'string' ? data.body : '',
    icon: BASE + 'icon-192.png',
    badge: BASE + 'icon-192.png',
    tag,
    // сообщение о том же заказе заменяет предыдущее, но телефон снова подаёт сигнал
    renotify: true,
    vibrate: [80, 40, 80],
    lang: 'ru',
    data: { url: safeUrl(data.url) },
  }));
});

/** Разбор тела push: JSON, иначе простой текст, иначе пусто. */
function readPush(payload) {
  if (!payload) return {};
  try {
    const data = payload.json();
    if (data && typeof data === 'object') return data;
  } catch {
    /* не JSON — пробуем как текст */
  }
  try {
    const text = payload.text();
    return text ? { body: text } : {};
  } catch {
    return {};
  }
}

/**
 * Адрес из push приводим к своему сайту: чужой домен в уведомлении кафе означает
 * либо ошибку сервера, либо подмену — в обоих случаях открываем главный экран.
 */
function safeUrl(url) {
  const home = new URL(BASE, self.location.origin).href;
  if (typeof url !== 'string' || !url) return home;
  try {
    const full = new URL(url, self.registration.scope);
    return full.origin === self.location.origin && full.pathname.startsWith(BASE) ? full.href : home;
  } catch {
    return home;
  }
}

/**
 * Нажатие на уведомление: если приложение уже открыто в какой-то вкладке — переводим фокус
 * туда и сообщаем адрес сообщением (перезагружать вкладку не нужно, приложение одностраничное),
 * иначе открываем новую вкладку.
 */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        let mine = false;
        try {
          mine = new URL(client.url).pathname.startsWith(BASE);
        } catch {
          mine = false;
        }
        if (!mine) continue;
        client.postMessage({ type: 'push-click', url });
        return 'focus' in client ? client.focus() : undefined;
      }
      return self.clients.openWindow(url);
    }).catch(() => undefined),
  );
});
