/**
 * Подписка браузера на push-уведомления кафе (Web Push, VAPID).
 *
 * Как это устроено. Уведомление о готовности заказа приходит с сервера кафе через
 * push-службу браузера, а показывает его service worker (public/sw.js, обработчик 'push').
 * Чтобы служба знала, кому доставлять, браузер создаёт подписку (endpoint + два ключа)
 * и её нужно отдать серверу: POST /push/subscribe. При выключении — POST /push/unsubscribe.
 * Публичный ключ VAPID лежит на сервере: GET /push/key.
 *
 * Почему свой fetch, а не request() из api.ts. Здесь нужны молчаливые запросы: ни один
 * сбой (нет сети, сервер без web-push, 404 маршрута) не должен превращаться в ошибку на
 * экране профиля — переключатель просто останется без подписки. Поэтому все функции этого
 * файла никогда не выбрасывают исключений и возвращают результат словом.
 *
 * Демо-режим (сборка без VITE_API_URL) не трогаем: там нет сервера, который мог бы прислать
 * push, поэтому все функции сразу отвечают 'unsupported' и ничего в браузере не меняют.
 *
 * Отношение к переключателю notifOn в сторе: notifOn отвечает за баннеры внутри приложения,
 * push — дополнение к нему для свёрнутого приложения. Экран профиля включает и то и другое.
 */
import { API_URL, isLive, getToken } from './api';

/** Чем закончилась попытка включить push. */
export type PushResult = 'ok' | 'denied' | 'unsupported' | 'error';

/** Адреса маршрутов web-push на сервере кафе. */
const PUSH_ROUTES = {
  key: '/push/key',
  subscribe: '/push/subscribe',
  unsubscribe: '/push/unsubscribe',
} as const;

/** Сколько ждём ответ сервера, миллисекунд. Меньше, чем у обычных запросов: экран не ждёт. */
const TIMEOUT = 10_000;

/** Сколько ждём, пока service worker станет активным, миллисекунд. */
const SW_WAIT = 5_000;

/**
 * Умеет ли браузер web-push.
 *
 * На iPhone PushManager появляется только после добавления приложения на главный экран —
 * в Safari на сайте его нет, и это единственный честный способ отличить такой случай.
 */
export function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/** Push имеет смысл: браузер умеет и адрес сервера задан при сборке. */
const usable = () => pushSupported() && isLive();

/**
 * Что браузер решил насчёт уведомлений: 'granted' — разрешил, 'denied' — запретил,
 * 'default' — ещё не спрашивали или окно запроса закрыли без ответа.
 *
 * Экраны берут разрешение отсюда, а не из результата enablePush: подсказку «запрещено
 * в настройках браузера» можно показывать только при настоящем запрете.
 */
export function pushPermission(): NotificationPermission {
  return pushSupported() ? Notification.permission : 'default';
}

/**
 * Следит за ответом на вопрос браузера об уведомлениях и зовёт onChange при каждой смене.
 *
 * Зачем: вопрос показывает переключатель уведомлений в сторе (toggleNotif), а подписаться
 * нужно уже после ответа — второй такой же вопрос браузеры не показывают и отвечают на него
 * пустым 'default'. О смене решения сообщает Permissions API; где его нет — сверяемся,
 * когда человек возвращается к вкладке (окно запроса и настройки браузера уводят фокус).
 *
 * Возвращает функцию отписки.
 */
export function watchPushPermission(onChange: (permission: NotificationPermission) => void): () => void {
  if (!pushSupported()) return () => undefined;
  let alive = true;
  let status: PermissionStatus | null = null;
  const read = () => { if (alive) onChange(Notification.permission); };
  try {
    navigator.permissions?.query({ name: 'notifications' }).then(s => {
      if (!alive) return;
      status = s;
      s.addEventListener('change', read);
      read();
    }).catch(() => undefined);
  } catch {
    /* браузер не знает такого разрешения — обойдёмся возвратом к вкладке */
  }
  document.addEventListener('visibilitychange', read);
  window.addEventListener('focus', read);
  return () => {
    alive = false;
    if (status) status.removeEventListener('change', read);
    document.removeEventListener('visibilitychange', read);
    window.removeEventListener('focus', read);
  };
}

/* ======================= запросы к серверу ======================= */

/** Ответ сервера: ok — дошло и принято, data — разобранное тело (может быть пустым). */
interface Reply<T> {
  ok: boolean;
  data: T | null;
}

/** Один молчаливый запрос: без тела — GET, с телом — POST. Любая беда даёт ok: false. */
async function call<T>(path: string, body?: unknown): Promise<Reply<T>> {
  if (!isLive()) return { ok: false, data: null };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // Подписка привязывается к гостю, поэтому шлём токен, если вход есть.
    // Гость без входа тоже может подписаться — сервер решает сам.
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(API_URL + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
      credentials: 'omit',
      cache: 'no-store',
      mode: 'cors',
    });
    if (!res.ok) return { ok: false, data: null };
    const text = await res.text();
    if (!text) return { ok: true, data: null };
    try {
      return { ok: true, data: JSON.parse(text) as T };
    } catch {
      return { ok: true, data: null };
    }
  } catch {
    return { ok: false, data: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Публичный ключ VAPID с сервера (GET /push/key, ответ {publicKey}).
 * ok: false — до сервера не достучались, повторить есть смысл.
 * ok: true с пустым ключом — уведомления на сервере не настроены (publicKey: null).
 */
async function serverKey(): Promise<{ ok: boolean; key: string }> {
  const { ok, data } = await call<string | { key?: string | null; publicKey?: string | null }>(PUSH_ROUTES.key);
  if (!ok) return { ok: false, key: '' };
  if (typeof data === 'string') return { ok: true, key: data.trim() };
  if (data && typeof data === 'object') return { ok: true, key: (data.publicKey || data.key || '').trim() };
  return { ok: true, key: '' };
}

/**
 * Отправка подписки на сервер (POST /push/subscribe, тело {subscription}).
 * Сервер требует вход: подписка привязывается к профилю гостя, чтобы знать,
 * о чьих заказах слать уведомления. Без токена ответ будет 401 — тогда просто
 * ничего не подписано, экран профиля из-за этого ошибку не показывает.
 */
async function sendSubscription(sub: PushSubscription): Promise<boolean> {
  const json = sub.toJSON();
  const keys = json.keys || {};
  // Без ключей шифрования подписка бесполезна: сервер не сможет собрать сообщение.
  if (!keys.p256dh || !keys.auth) return false;
  const { ok } = await call(PUSH_ROUTES.subscribe, {
    subscription: {
      endpoint: sub.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      expirationTime: typeof json.expirationTime === 'number' ? json.expirationTime : null,
    },
  });
  return ok;
}

/* ======================= ключ и service worker ======================= */

/**
 * Ключ VAPID из base64url в байты: pushManager принимает только их.
 * Публичный ключ — несжатая точка кривой P-256: ровно 65 байт, первый 0x04.
 * Всё, что не похоже, отвергаем сразу, иначе subscribe упадёт невнятной ошибкой.
 */
function decodeKey(base64url: string): ArrayBuffer | null {
  try {
    const padded = base64url + '='.repeat((4 - (base64url.length % 4)) % 4);
    const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes.length === 65 && bytes[0] === 0x04 ? bytes.buffer : null;
  } catch {
    return null;
  }
}

/**
 * Каким ключом сделана существующая подписка:
 * 'same'    — тем же, что у сервера: подписка годится;
 * 'other'   — другим: сервер сменил пару VAPID, подписку придётся пересоздать;
 * 'unknown' — браузер не отдаёт applicationServerKey (так делают некоторые версии Safari).
 *
 * «Не отдаёт» и «не совпал» нарочно разведены: если считать пустой ключ несовпадением,
 * каждое включение уведомлений пересоздаёт подписку и оставляет на сервере мёртвые записи.
 * При 'unknown' подписку не трогаем — просто переотправляем серверу.
 */
function keyState(sub: PushSubscription, key: ArrayBuffer): 'same' | 'other' | 'unknown' {
  const raw = sub.options?.applicationServerKey;
  if (!raw || raw.byteLength === 0) return 'unknown';
  const has = new Uint8Array(raw);
  const want = new Uint8Array(key);
  if (has.length !== want.length) return 'other';
  for (let i = 0; i < has.length; i++) if (has[i] !== want[i]) return 'other';
  return 'same';
}

/**
 * Регистрация service worker. Ждём именно активного воркера, но не бесконечно:
 * navigator.serviceWorker.ready никогда не разрешится, если воркера нет вовсе
 * (режим разработки — его там не регистрируют).
 */
async function swReady(): Promise<ServiceWorkerRegistration | null> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    if (reg.active) return reg;
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>(resolve => { setTimeout(() => resolve(null), SW_WAIT); }),
    ]);
    return ready || reg;
  } catch {
    return null;
  }
}

/* ======================= включение и выключение ======================= */

/**
 * Включение push: спрашиваем разрешение, подписываемся и отдаём подписку серверу.
 *
 * 'denied'      — человек (или настройки браузера) запретил уведомления: только он может
 *                 это отменить, поэтому здесь уместна подсказка про настройки браузера;
 * 'unsupported' — браузер не умеет web-push, это демо-сборка без сервера либо на сервере
 *                 не заданы ключи VAPID: повторять нечего;
 * 'error'       — сервер не ответил, прислал негодный ключ, не принял подписку (например,
 *                 вход не выполнен) либо окно запроса закрыли, ничего не выбрав;
 *                 попытку можно повторить.
 *
 * Вызывать безопасно повторно: существующая подписка переиспользуется, лишней она не станет,
 * а серверу она уходит каждый раз — так связка «адрес браузера → гость» остаётся верной
 * после смены человека на общем устройстве.
 * Разрешение браузер спрашивает только в ответ на действие человека, поэтому вызов должен
 * идти из обработчика нажатия.
 */
export async function enablePush(): Promise<PushResult> {
  if (!usable()) return 'unsupported';
  try {
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission === 'denied') return 'denied';
    // Остался 'default' — окно запроса просто закрыли, ничего не выбрав (или его в этот
    // момент показывал кто-то ещё). Это не запрет: достаточно нажать переключатель снова.
    if (permission !== 'granted') return 'error';

    const reg = await swReady();
    if (!reg) return 'unsupported';

    const vapid = await serverKey();
    // Сервер ответил, но ключа нет — web-push у кафе не включён, повторять нечего.
    if (vapid.ok && !vapid.key) return 'unsupported';
    const key = decodeKey(vapid.key);
    if (!key) return 'error';

    let sub = await reg.pushManager.getSubscription();
    if (sub && keyState(sub, key) === 'other') {
      // Ключ сервера сменился — старая подписка уже не расшифруется. Её адрес запоминаем
      // до отписки и просим сервер убрать запись: сам он узнал бы о ней, только получив
      // от push-службы отказ, а до тех пор копил бы мёртвые подписки.
      const stale = sub.endpoint;
      await sub.unsubscribe().catch(() => false);
      sub = null;
      await call(PUSH_ROUTES.unsubscribe, { endpoint: stale });
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    return await sendSubscription(sub) ? 'ok' : 'error';
  } catch (e) {
    // Отказ в разрешении приходит и исключением: Safari бросает NotAllowedError.
    if (e instanceof DOMException && e.name === 'NotAllowedError') return 'denied';
    return 'error';
  }
}

/**
 * Выключение push. Сначала отписываемся в браузере — тогда уведомления перестанут приходить
 * даже при недоступном сервере; потом сообщаем серверу, чтобы он убрал запись из базы.
 * Разрешение на уведомления при этом остаётся: его снимает только сам человек в настройках.
 */
export async function disablePush(): Promise<void> {
  if (!usable()) return;
  try {
    const reg = await swReady();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return;
    const { endpoint } = sub;
    await sub.unsubscribe().catch(() => false);
    await call(PUSH_ROUTES.unsubscribe, { endpoint });
  } catch {
    /* выключение — дело необязательное: молча выходим */
  }
}

/** Есть ли уже подписка в этом браузере. */
export async function pushSubscribed(): Promise<boolean> {
  if (!usable()) return false;
  try {
    const reg = await swReady();
    if (!reg) return false;
    return (await reg.pushManager.getSubscription()) !== null;
  } catch {
    return false;
  }
}
