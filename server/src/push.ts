/**
 * Push-уведомления (Web Push).
 *
 * Живой поток (SSE) работает, только пока приложение открыто. Push нужен для обратного случая:
 * человек оформил заказ, свернул телефон и ждёт — сообщение «Заказ готов!» должно дойти
 * и при закрытом приложении. Отправка идёт через сервис push-браузера (Google, Mozilla, Apple)
 * по стандарту Web Push с подписью VAPID: своего адреса устройства мы не знаем, знаем только
 * выданный браузером endpoint.
 *
 * Кому это доступно. Только клиентам, вошедшим по SMS: подписаться можно лишь с
 * подтверждённым профилем (см. routes/push.ts), и уведомление о заказе уходит на профиль
 * владельца. Гость без входа push не получает вообще — ни подписаться, ни встать в живой
 * поток он не может; ему остаётся экран статуса в открытом приложении. Так и задумано:
 * номер, введённый в форме заказа, никем не подтверждён, и уведомления по нему ушли бы
 * постороннему человеку — тому, кто этот номер действительно зарегистрировал.
 *
 * Ключи VAPID берутся из переменных окружения (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT).
 * Их нет — сервер работает как раньше, просто без уведомлений: ни один маршрут из-за этого не падает.
 *
 * Своя таблица подписок заводится прямо здесь, чтобы не трогать db.ts: подписка — это не
 * персональные данные о человеке, а адрес его браузера, и живёт она по своим правилам
 * (сама удаляется, как только push-сервис отвечает «такой подписки больше нет», а также
 * вместе с удалённым профилем — см. removeSubscriptionsFor и dropOrphans).
 *
 * Зависимостей от маршрутов и от events.ts здесь нет: наоборот, events.ts вызывает notifyOrder.
 * Так не возникает кольцевого импорта.
 */
import { randomUUID } from 'node:crypto';
import webpush from 'web-push';
import type { RequestOptions } from 'web-push';
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
  failed     INTEGER DEFAULT 0,
  failed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id);
CREATE INDEX IF NOT EXISTS push_subs_phone ON push_subs(phone);
`);

// База могла быть создана прежней версией, где столбца failed_at ещё не было:
// CREATE TABLE IF NOT EXISTS такую таблицу не трогает, поэтому добавляем столбец вручную.
{
  const columns = db.prepare('PRAGMA table_info(push_subs)').all() as { name: string }[];
  if (!columns.some(c => c.name === 'failed_at')) {
    db.exec('ALTER TABLE push_subs ADD COLUMN failed_at INTEGER');
  }
}

interface SubRow {
  id: string;
  user_id: string | null;
  phone: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: number;
  failed: number;
  failed_at: number | null;
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
/** После скольких подряд отказов push-сервиса подписка считается мёртвой. */
const MAX_FAILS = 5;
/** Через какое время неудачи забываются: старее — счётчик начинается заново. */
const FAIL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Настройки отправки. TTL — сколько push-сервис хранит сообщение, если телефон выключен:
 * час, потому что «заказ готов» через сутки никому не нужен. urgency high — сообщение
 * важное, будить устройство можно. timeout обязателен: без него зависший запрос
 * к push-сервису висит в памяти процесса без ограничения по времени.
 */
const SEND_OPTIONS: RequestOptions = { TTL: 3600, urgency: 'high', timeout: 10_000 };

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

/* ---------- разрешённые push-сервисы ---------- */

/**
 * Адреса, по которым сервер соглашается стучаться. Endpoint приходит от клиента, а POST
 * по нему делает сервер — значит, без списка это готовый способ заставить наш сервер
 * (он стоит внутри частной сети рядом с nginx и базой) обращаться на внутренние адреса
 * вида https://127.0.0.1:8443/... Поэтому пропускаем только настоящие push-сервисы браузеров.
 * Запись со звёздочкой — поддомены: «*.push.apple.com» разрешает web.push.apple.com.
 */
const DEFAULT_PUSH_HOSTS = [
  'fcm.googleapis.com', // Chrome, Edge, Android
  'android.googleapis.com', // старые сборки Chrome
  'updates.push.services.mozilla.com', // Firefox
  '*.push.services.mozilla.com',
  '*.push.apple.com', // Safari, iOS
  '*.notify.windows.com', // Windows
];

/**
 * Свои push-сервисы (например, UnifiedPush на своём сервере) добавляются переменной
 * окружения PUSH_ALLOWED_HOSTS через запятую; звёздочка в начале работает так же.
 */
const allowedHosts = [
  ...DEFAULT_PUSH_HOSTS,
  ...(env.PUSH_ALLOWED_HOSTS || '')
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean),
];

/** Разрешён ли хост из адреса подписки. */
function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return allowedHosts.some(pattern => {
    if (!pattern.startsWith('*.')) return host === pattern;
    const suffix = pattern.slice(1); // «*.push.apple.com» → «.push.apple.com»
    return host.endsWith(suffix) && host.length > suffix.length;
  });
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
  if (!p256dh || p256dh.length > MAX_KEY || !auth || auth.length > MAX_KEY) return null;

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  // Только https: по http push-сервисов не бывает.
  if (url.protocol !== 'https:') return null;
  // У push-сервисов адрес всегда простой: без порта и без логина с паролем.
  // А вот у внутренней службы порт как раз есть — такой адрес сюда не пройдёт.
  if (url.port || url.username || url.password) return null;
  if (!hostAllowed(url.hostname)) return null;

  return { endpoint, keys: { p256dh, auth } };
}

/**
 * Сохраняет подписку гостя. Один и тот же браузер присылает один и тот же endpoint,
 * поэтому повторная подписка обновляет строку, а не плодит копии.
 * Возвращает endpoint или null, если браузер прислал что-то невнятное
 * либо адрес не принадлежит известному push-сервису.
 */
export function saveSubscription(input: {
  userId: string | null;
  phone: string | null;
  subscription: unknown;
}): string | null {
  const sub = parseSubscription(input.subscription);
  if (!sub) return null;

  db.prepare(
    `INSERT INTO push_subs (id, user_id, phone, endpoint, p256dh, auth, created_at, failed, failed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id, phone = excluded.phone,
       p256dh = excluded.p256dh, auth = excluded.auth,
       created_at = excluded.created_at, failed = 0, failed_at = NULL`,
  ).run(randomUUID(), input.userId, input.phone, sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now());

  trim(input.userId, input.phone);
  // Заодно убираем подписки удалённых аккаунтов: подписка — тоже повод заглянуть в таблицу.
  dropOrphans();
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
 * Удаляет все подписки человека — и по профилю, и по номеру. Возвращает число удалённых строк.
 *
 * Нужна при удалении аккаунта (DELETE /me): человек отозвал согласие, а адрес его устройства
 * остался бы в базе навсегда; к тому же номер со временем может отойти другому человеку,
 * и на старое устройство приходили бы уведомления о чужих заказах. Сам клиент отписаться
 * не может: POST /push/unsubscribe шлётся только с того устройства, где выключают переключатель.
 *
 * В routes/auth.ts это одна строка рядом с users.remove(user.id):
 *   removeSubscriptionsFor({ userId: user.id, phone: user.phone });
 * Пока её нет, подписки мёртвых профилей отсекает dropOrphans, но лучше удалять сразу.
 */
export function removeSubscriptionsFor(owner: PushOwner): number {
  if (!owner.userId && !owner.phone) return 0;
  return db
    .prepare(
      `DELETE FROM push_subs
        WHERE (@userId IS NOT NULL AND user_id = @userId)
           OR (@phone  IS NOT NULL AND phone  = @phone)`,
    )
    .run({ userId: owner.userId ?? null, phone: owner.phone ?? null }).changes;
}

/**
 * Подписки без живого профиля: аккаунт удалили, а строка осталась (db.ts про нашу таблицу
 * не знает). Хранить адрес устройства человека, отозвавшего согласие, нельзя, да и слать
 * на него нечего. Вызывается при подписке и перед отправкой — таблица маленькая,
 * отдельного расписания ради неё не заводим. Возвращает число удалённых строк.
 */
function dropOrphans(): number {
  return db
    .prepare(
      `DELETE FROM push_subs
        WHERE user_id IS NULL
           OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = push_subs.user_id)`,
    )
    .run().changes;
}

/**
 * Подписки одного человека.
 *
 * По профилю (user_id) — всегда. По телефону — только если вызывающий разрешил это явно
 * (allowPhone), потому что телефон в PushOwner приходит из заказа, а в гостевом заказе
 * это НЕПОДТВЕРЖДЁННЫЙ номер, введённый в форме: иначе, оформив гостевой заказ на чужой
 * номер, можно было бы слать уведомления о нём владельцу этого номера. Ровно так же
 * бережётся GET /orders в routes/orders.ts.
 *
 * Подписки удалённых профилей не отдаём (EXISTS по users): токен живёт до 90 дней,
 * а номер потом может достаться другому человеку.
 */
export function subscriptionsFor(owner: PushOwner, opts: { allowPhone?: boolean } = {}): PushSubscriptionJson[] {
  const phone = opts.allowPhone ? (owner.phone ?? null) : null;
  const rows = db
    .prepare(
      `SELECT * FROM push_subs
        WHERE ((@userId IS NOT NULL AND user_id = @userId)
            OR (@phone  IS NOT NULL AND phone  = @phone))
          AND EXISTS (SELECT 1 FROM users u WHERE u.id = push_subs.user_id)
        ORDER BY created_at`,
    )
    .all({ userId: owner.userId ?? null, phone }) as SubRow[];

  return rows.map(r => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
}

/* ---------- отправка ---------- */

/**
 * Отмечает отказ push-сервиса; после MAX_FAILS подряд подписка выбрасывается.
 * Неудачи стареют: если прошлая была больше суток назад, счёт начинается заново —
 * иначе редкие сбои за месяц складывались бы и убивали исправную подписку.
 */
function markFailed(endpoint: string) {
  const t = Date.now();
  db.prepare(
    `UPDATE push_subs
        SET failed = CASE WHEN failed_at IS NULL OR failed_at < @since THEN 1 ELSE failed + 1 END,
            failed_at = @now
      WHERE endpoint = @endpoint`,
  ).run({ endpoint, now: t, since: t - FAIL_WINDOW_MS });
  db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND failed >= ?').run(endpoint, MAX_FAILS);
}

/**
 * Отправляет уведомление на все устройства человека.
 *
 * Ошибки наружу не выбрасываются: уведомление — вещь вспомогательная, из-за него
 * не должен падать ни один маршрут. Ответы 404 и 410 значат «подписки больше нет»
 * (приложение удалили, разрешение отозвали) — такую строку сразу убираем из базы.
 * Прочие отказы push-сервиса (4xx) идут в счётчик, а обрывы связи и 5xx не считаем вовсе:
 * это про сеть и про чужой сервис, а не про подписку, и живую подписку из-за них не теряем.
 *
 * По телефону подписки ищутся только с opts.allowPhone — см. subscriptionsFor.
 * Возвращает число доставленных сообщений.
 */
export async function sendToUser(
  owner: PushOwner,
  payload: PushPayload,
  opts: { allowPhone?: boolean } = {},
): Promise<number> {
  if (!enabled) {
    warnOnce();
    return 0;
  }
  if (!owner.userId && !(opts.allowPhone && owner.phone)) return 0;

  dropOrphans();
  const subs = subscriptionsFor(owner, opts);
  if (subs.length === 0) return 0;

  const body = JSON.stringify(payload);
  let sent = 0;

  await Promise.all(
    subs.map(async sub => {
      try {
        await webpush.sendNotification(sub, body, SEND_OPTIONS);
        // Подписка жива — сбрасываем счётчик прошлых неудач.
        db.prepare('UPDATE push_subs SET failed = 0, failed_at = NULL WHERE endpoint = ? AND failed > 0').run(
          sub.endpoint,
        );
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          removeSubscription(sub.endpoint);
          return;
        }
        // Постоянные отказы (400 «плохая подписка», 403 «ключ не подошёл») — в счётчик.
        // Тайм-аут, обрыв, 500 и 502 от прокси кафе подписку не портят.
        if (typeof status === 'number' && status >= 400 && status < 500) markFailed(sub.endpoint);
        console.warn('[push] не удалось отправить уведомление:', status ?? (err as Error)?.message ?? err);
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

/**
 * Текст уведомления по статусу. Остальные статусы гостя не беспокоят.
 *
 * Про отмену пишем нейтрально: отменить заказ мог и сам клиент прямо в приложении,
 * и звать его звонить по поводу собственного действия незачем — подробности он увидит
 * на экране заказа, а причину отмены кухней ему сообщат по телефону сами.
 */
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
    return { title: `Заказ №${order.no} отменён`, body: 'Подробности — на экране заказа' };
  }
  return null;
}

/**
 * Последний отправленный статус по номеру заказа. Нужен потому, что hub.publishOrder
 * зовут и без смены статуса — например, кухня жмёт «+5 мин» (POST /staff/orders/:no/eta),
 * статус остаётся accepted, и телефон гостя будило бы одно и то же «Заказ принят!».
 * Память живёт в процессе: после перезапуска сервера в худшем случае повторится
 * одно уведомление, ради этого хранить состояние в базе не стоит.
 */
const lastSent = new Map<number, { status: OrderStatus; at: number }>();
/** Через сколько забываем заказ: он либо выдан, либо давно не наше дело. */
const MEMORY_TTL = 12 * 60 * 60 * 1000;
/** Начиная с какого размера карту имеет смысл подчищать. */
const MEMORY_MAX = 500;

/** Действительно ли статус сменился с прошлого уведомления. Заодно запоминает новый. */
function statusChanged(order: ApiOrder): boolean {
  const now = Date.now();
  if (lastSent.size > MEMORY_MAX) {
    for (const [no, seen] of lastSent) if (now - seen.at > MEMORY_TTL) lastSent.delete(no);
  }
  if (lastSent.get(order.no)?.status === order.status) return false;
  lastSent.set(order.no, { status: order.status, at: now });
  return true;
}

/**
 * Уведомление о смене статуса заказа. Вызывается из events.ts сразу после рассылки
 * по живым соединениям, поэтому клиент получит сообщение и с закрытым приложением.
 * Ничего не ждём: отправка идёт в фоне, ответ кухне из-за неё не задерживается.
 */
export function notifyOrder(order: ApiOrder, owner: PushOwner): void {
  if (!enabled) {
    warnOnce();
    return;
  }
  const text = textFor(order);
  if (!text) return;
  // Публикация без смены статуса (правка времени готовности) телефон не будит.
  if (!statusChanged(order)) return;

  /**
   * Слать по совпадению номера можно, только когда номер подтверждён: у заказа из
   * приложения есть профиль (userId), а заказ, внесённый персоналом по звонку (byPhone),
   * подтверждён самим разговором. Гостевой заказ с наугад введённым номером уведомит
   * лишь того, кто его оформил, — то есть никого, если он не входил по SMS.
   */
  const allowPhone = order.byPhone === true || !!owner.userId;

  const payload: PushPayload = {
    title: text.title,
    body: text.body,
    // Одна метка на заказ: «принят» сменится на «готов», а не ляжет вторым уведомлением.
    tag: `order-${order.no}`,
    url: '#/status',
    no: order.no,
    status: order.status,
  };

  void sendToUser(owner, payload, { allowPhone }).catch(err => {
    console.warn('[push] уведомление о заказе не отправлено:', (err as Error).message);
  });
}
