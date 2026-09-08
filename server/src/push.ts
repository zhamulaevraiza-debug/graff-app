/**
 * Push-уведомления (Web Push).
 *
 * Живой поток (SSE) работает, только пока приложение открыто. Push нужен для обратного случая:
 * гость оформил заказ, свернул телефон и ждёт — сообщение «Заказ готов!» должно дойти
 * и при закрытом приложении. Отправка идёт через сервис push-браузера (Google, Mozilla, Apple)
 * по стандарту Web Push с подписью VAPID: своего адреса устройства мы не знаем, знаем только
 * выданный браузером endpoint.
 *
 * Ключи VAPID берутся из переменных окружения (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT).
 * Их нет — сервер работает как раньше, просто без уведомлений: ни один маршрут из-за этого не падает.
 *
 * Своя таблица подписок заводится прямо здесь, чтобы не трогать db.ts: подписка — это не
 * персональные данные о человеке, а адрес его браузера, и живёт она по своим правилам
 * (сама удаляется, как только push-сервис отвечает «такой подписки больше нет»).
 *
 * Зависимостей от маршрутов и от events.ts здесь нет: наоборот, events.ts вызывает notifyOrder.
 * Так не возникает кольцевого импорта.
 */
import { randomUUID } from 'node:crypto';
import webpush from 'web-push';
import { db } from './db.ts';
import type { ApiOrder, OrderStatus } from './types.ts';

/* ---------- таблица подписок ---------- */

db.exec(`
CREATE TABLE IF NOT EXISTS push_subs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  phone      TEXT,
  endpoint   TEXT UNIQUE,
  p256dh     TEXT,
  auth       TEXT,
  created_at INTEGER,
  failed     INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id);
CREATE INDEX IF NOT EXISTS push_subs_phone ON push_subs(phone);
`);

interface SubRow {
  id: string;
  user_id: string | null;
  phone: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: number;
  failed: number;
}

/** Кому адресовано уведомление: владелец заказа так же, как в hub.publishOrder. */
export interface PushOwner {
  userId: string | null;
  phone: string | null;
}

/** Подписка в том виде, в каком её отдаёт браузер (JSON от PushSubscription). */
export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Содержимое уведомления. Уходит в service worker как JSON. */
export interface PushPayload {
  title: string;
  body: string;
  /** метка, чтобы новое уведомление о заказе заменяло предыдущее, а не копилось стопкой */
  tag?: string;
  /** куда открыть приложение по нажатию; путь считается от области действия воркера */
  url?: string;
  no?: number;
  status?: OrderStatus;
}

/* ---------- пределы ---------- */

/** Endpoint — обычный https-адрес push-сервиса; длиннее двух килобайт он не бывает. */
const MAX_ENDPOINT = 2048;
/** Ключи шифрования из браузера: p256dh около 88 символов, auth около 24. */
const MAX_KEY = 256;
/** Сколько устройств помним на одного гостя; самые давние вытесняются. */
const MAX_SUBS_PER_OWNER = 10;
/** После скольких подряд неудачных отправок подписка считается мёртвой. */
const MAX_FAILS = 5;

/* ---------- настройка VAPID ---------- */

const env = process.env;
const vapidPublic = (env.VAPID_PUBLIC_KEY || '').trim();
const vapidPrivate = (env.VAPID_PRIVATE_KEY || '').trim();
/**
 * Контакт для push-сервиса: по нему с нами свяжутся, если сервер начнёт слать мусор.
 * Годится «mailto:…» или адрес сайта; значение по умолчанию заведомо рабочее,
 * но лучше указать настоящую почту кафе.
 */
const vapidSubject = (env.VAPID_SUBJECT || '').trim() || 'mailto:info@graff.local';

let enabled = false;
if (vapidPublic && vapidPrivate) {
  try {
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    enabled = true;
  } catch (err) {
    // Ключи заданы, но негодные: сообщаем один раз при старте и работаем без уведомлений.
    console.warn('[push] ключи VAPID не приняты, уведомления отключены:', (err as Error).message);
  }
}

/** Настроены ли ключи: без них отправка тихо ничего не делает. */
export const isPushEnabled = (): boolean => enabled;

/** Открытый ключ для браузера (pushManager.subscribe). null — уведомления не настроены. */
export const publicKey = (): string | null => (enabled ? vapidPublic : null);

/** Предупреждение об отсутствии ключей пишем один раз, а не на каждый заказ. */
let warned = false;
function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn(
    '[push] VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY не заданы — push-уведомления не отправляются. ' +
      'Сгенерировать ключи: npm run vapid (в каталоге server)',
  );
}

/* ---------- хранение подписок ---------- */

/** Проверяет и приводит к нашему виду то, что прислал браузер. */
function parseSubscription(raw: unknown): PushSubscriptionJson | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const keys = (src.keys ?? {}) as Record<string, unknown>;

  const endpoint = typeof src.endpoint === 'string' ? src.endpoint.trim() : '';
  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh.trim() : '';
  const auth = typeof keys.auth === 'string' ? keys.auth.trim() : '';

  if (!endpoint || endpoint.length > MAX_ENDPOINT) return null;
  // Только https: по http push-сервисов не бывает, а произвольный адрес отправил бы
  // сервер стучаться куда попало от нашего имени.
  if (!endpoint.startsWith('https://')) return null;
  if (!p256dh || p256dh.length > MAX_KEY || !auth || auth.length > MAX_KEY) return null;

  return { endpoint, keys: { p256dh, auth } };
}

/**
 * Сохраняет подписку гостя. Один и тот же браузер присылает один и тот же endpoint,
 * поэтому повторная подписка обновляет строку, а не плодит копии.
 * Возвращает endpoint или null, если браузер прислал что-то невнятное.
 */
export function saveSubscription(input: {
  userId: string | null;
  phone: string | null;
  subscription: unknown;
}): string | null {
  const sub = parseSubscription(input.subscription);
  if (!sub) return null;

  db.prepare(
    `INSERT INTO push_subs (id, user_id, phone, endpoint, p256dh, auth, created_at, failed)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id, phone = excluded.phone,
       p256dh = excluded.p256dh, auth = excluded.auth,
       created_at = excluded.created_at, failed = 0`,
  ).run(randomUUID(), input.userId, input.phone, sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now());

  trim(input.userId, input.phone);
  return sub.endpoint;
}

/** Не даём одному гостю копить подписки: телефон, планшет, рабочий компьютер — этого хватит. */
function trim(userId: string | null, phone: string | null) {
  const column = userId ? 'user_id' : phone ? 'phone' : null;
  const value = userId ?? phone;
  if (!column || !value) return;
  db.prepare(
    `DELETE FROM push_subs WHERE ${column} = ? AND endpoint NOT IN (
       SELECT endpoint FROM push_subs WHERE ${column} = ? ORDER BY created_at DESC LIMIT ?
     )`,
  ).run(value, value, MAX_SUBS_PER_OWNER);
}

/** Удаляет подписку по адресу браузера. Возвращает, была ли она в базе. */
export function removeSubscription(endpoint: string): boolean {
  if (!endpoint) return false;
  return db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint).changes > 0;
}

/**
 * Подписки одного гостя: свои (по профилю) и оформленные на его номер.
 * Телефон в подписку попадает только из подтверждённого профиля, поэтому совпадение
 * номера здесь безопасно — см. routes/push.ts.
 */
export function subscriptionsFor(owner: PushOwner): PushSubscriptionJson[] {
  const rows = db
    .prepare(
      `SELECT * FROM push_subs
        WHERE (@userId IS NOT NULL AND user_id = @userId)
           OR (@phone  IS NOT NULL AND phone  = @phone)
        ORDER BY created_at`,
    )
    .all({ userId: owner.userId ?? null, phone: owner.phone ?? null }) as SubRow[];

  return rows.map(r => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
}

/* ---------- отправка ---------- */

/** Отмечает неудачу; после MAX_FAILS подряд подписку выбрасываем. */
function markFailed(endpoint: string) {
  db.prepare('UPDATE push_subs SET failed = failed + 1 WHERE endpoint = ?').run(endpoint);
  db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND failed >= ?').run(endpoint, MAX_FAILS);
}

/**
 * Отправляет уведомление на все устройства гостя.
 *
 * Ошибки наружу не выбрасываются: уведомление — вещь вспомогательная, из-за него
 * не должен падать ни один маршрут. Ответы 404 и 410 значат «подписки больше нет»
 * (приложение удалили, разрешение отозвали) — такую строку сразу убираем из базы.
 * Возвращает число доставленных сообщений.
 */
export async function sendToUser(owner: PushOwner, payload: PushPayload): Promise<number> {
  if (!enabled) {
    warnOnce();
    return 0;
  }
  if (!owner.userId && !owner.phone) return 0;

  const subs = subscriptionsFor(owner);
  if (subs.length === 0) return 0;

  const body = JSON.stringify(payload);
  let sent = 0;

  await Promise.all(
    subs.map(async sub => {
      try {
        await webpush.sendNotification(sub, body);
        // Подписка жива — сбрасываем счётчик прошлых неудач.
        db.prepare('UPDATE push_subs SET failed = 0 WHERE endpoint = ? AND failed > 0').run(sub.endpoint);
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          removeSubscription(sub.endpoint);
          return;
        }
        markFailed(sub.endpoint);
        console.warn('[push] не удалось отправить уведомление:', status ?? (err as Error).message);
      }
    }),
  );

  return sent;
}

/* ---------- уведомления о заказе ---------- */

/** Где забирать заказ — теми же словами, что и в приложении (src/lib/orders.ts). */
function where(order: ApiOrder): string {
  if (order.format === 'togo') return 'Подойдите к стойке';
  return order.table ? `Столик ${order.table}` : 'Столик назначит персонал';
}

/** Текст уведомления по статусу. Остальные статусы гостя не беспокоят. */
function textFor(order: ApiOrder): { title: string; body: string } | null {
  if (order.status === 'accepted') {
    const eta = order.eta ? ` · готовим ~${order.eta} мин` : '';
    const place = order.format === 'togo' ? ' · заберёте у стойки' : order.table ? ` · столик ${order.table}` : '';
    return { title: 'Заказ принят!', body: `№${order.no}${eta}${place}` };
  }
  if (order.status === 'ready') {
    return { title: `Ваш заказ №${order.no} готов!`, body: where(order) };
  }
  if (order.status === 'cancelled') {
    return { title: `Заказ №${order.no} отменён`, body: 'Если это ошибка, позвоните нам — всё поправим' };
  }
  return null;
}

/**
 * Уведомление о смене статуса заказа. Вызывается из events.ts сразу после рассылки
 * по живым соединениям, поэтому гость получит сообщение и с закрытым приложением.
 * Ничего не ждём: отправка идёт в фоне, ответ кухне из-за неё не задерживается.
 */
export function notifyOrder(order: ApiOrder, owner: PushOwner): void {
  if (!enabled) {
    warnOnce();
    return;
  }
  const text = textFor(order);
  if (!text) return;

  const payload: PushPayload = {
    title: text.title,
    body: text.body,
    // Одна метка на заказ: «принят» сменится на «готов», а не ляжет вторым уведомлением.
    tag: `order-${order.no}`,
    url: '#/status',
    no: order.no,
    status: order.status,
  };

  void sendToUser(owner, payload).catch(err => {
    console.warn('[push] уведомление о заказе не отправлено:', (err as Error).message);
  });
}
