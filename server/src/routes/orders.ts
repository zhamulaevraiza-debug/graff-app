/**
 * Заказы со стороны клиента.
 *
 * Здесь живут только клиентские действия: оформить заказ, посмотреть свои заказы,
 * отменить, пока кухня не начала готовить. Всё, что делает персонал, — в routes/staff.ts.
 *
 * Два правила, ради которых написана половина файла:
 *   1) сумма заказа считается на сервере, цена из тела запроса не принимается;
 *   2) телефон клиенту не возвращается — он есть только у персонала (152-ФЗ: минимизация данных).
 *
 * Заказ без регистрации разрешён: гость указывает имя и телефон, и это всё.
 * Отказ в обслуживании из-за отказа от регистрации недопустим (ст. 16 закона «О защите прав потребителей»).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.ts';
import { audit, orders, tables, users } from '../db.ts';
import { bearer, normalizePhone, verifyToken } from '../auth.ts';
import type { TokenPayload } from '../auth.ts';
import { hub } from '../events.ts';
import type { ApiError, ApiLine, ApiOrder, Format, PaymentId } from '../types.ts';

/** Версия текста согласия, под которым клиент оформляет заказ. Пишется в журнал. */
const CONSENT_VERSION = '1';

/** Ограничения на состав заказа: защита от мусора и от случайной «тысячи шаурмы». */
const LIMITS = {
  lines: 50,
  qty: 50,
  unit: 100_000,
  name: 120,
  guestName: 60,
  portion: 40,
  sauces: 10,
  sauceName: 60,
  itemId: 64,
  comment: 500,
  pickupLabel: 60,
} as const;

const FORMATS: Format[] = ['hall', 'terrace', 'togo'];
const PAYMENTS: PaymentId[] = ['cash', 'card', 'online'];

/* ---------- мелкие помощники ---------- */

/** Ответ об ошибке в формате ApiError. */
function fail(reply: FastifyReply, status: number, error: string, message: string) {
  const body: ApiError = { error, message };
  return reply.status(status).send(body);
}

/** Токен клиента. Токен сотрудника здесь не годится: у персонала свои маршруты. */
function clientToken(req: FastifyRequest): TokenPayload | null {
  const payload = verifyToken(bearer(req.headers.authorization));
  return payload && payload.role === 'user' ? payload : null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const cut = (v: unknown, max: number): string => str(v).slice(0, max);

/** «10:00» → минуты от полуночи; иначе null. */
function parseHm(raw: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Открыто ли кафе сейчас. Часы берутся из настроек в часовом поясе сервера
 * (сервер должен стоять на московском времени, как и кафе).
 * Часы не заданы или заданы неверно — принимаем заказы круглосуточно.
 */
function isOpenNow(at: Date = new Date()): boolean {
  const from = parseHm(config.workHours.from);
  const to = parseHm(config.workHours.to);
  if (from === null || to === null || from === to) return true;
  const cur = at.getHours() * 60 + at.getMinutes();
  // Смена через полночь (например, с 10:00 до 02:00) — интервал переворачивается.
  return from < to ? cur >= from && cur < to : cur >= from || cur < to;
}

/** Заказ в том виде, в каком его можно показать клиенту: без телефона. */
const forClient = (order: ApiOrder): ApiOrder => ({ ...order, phone: undefined, mine: true });

/** Разбор строк заказа: возвращает либо очищенные строки, либо текст ошибки. */
function parseLines(raw: unknown): { lines: ApiLine[]; total: number } | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'Корзина пуста, добавьте блюда';
  if (raw.length > LIMITS.lines) return `В одном заказе не больше ${LIMITS.lines} позиций`;

  const lines: ApiLine[] = [];
  let total = 0;

  for (const item of raw) {
    if (!item || typeof item !== 'object') return 'Состав заказа испорчен, соберите корзину заново';
    const src = item as Record<string, unknown>;

    const name = cut(src.name, LIMITS.name);
    if (!name) return 'У одной из позиций нет названия';

    const unit = Number(src.unit);
    if (!Number.isFinite(unit) || unit <= 0 || unit > LIMITS.unit) return `Неверная цена позиции «${name}»`;

    const qty = Number(src.qty);
    if (!Number.isInteger(qty) || qty <= 0) return `Неверное количество позиции «${name}»`;
    if (qty > LIMITS.qty) return `Больше ${LIMITS.qty} порций «${name}» в одном заказе не принимаем, позвоните нам`;

    const sauceNames = Array.isArray(src.sauceNames)
      ? src.sauceNames.slice(0, LIMITS.sauces).map(s => cut(s, LIMITS.sauceName)).filter(Boolean)
      : [];
    const portion = cut(src.portion, LIMITS.portion);
    const itemId = cut(src.itemId, LIMITS.itemId);

    // Пересобираем строку сами: в базу попадают только известные поля.
    lines.push({
      itemId: itemId || undefined,
      name,
      portion: portion || undefined,
      sauceNames: sauceNames.length ? sauceNames : undefined,
      unit,
      qty,
    });
    total += unit * qty;
  }

  // Сумма считается здесь и только здесь: значение total из тела запроса игнорируется.
  return { lines, total: Math.round(total) };
}

/* ---------- маршруты ---------- */

export async function orderRoutes(app: FastifyInstance) {
  /** Занятость столиков для экрана корзины. Публично: номера столиков — не персональные данные. */
  app.get('/tables', async () => tables.state());

  /** Оформление заказа. */
  app.post('/orders', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    // Согласие на обработку данных — условие приёма заказа: без него мы не вправе хранить имя и телефон.
    if (body.consent !== true) {
      return fail(reply, 400, 'consent_required', 'Нужно согласие на обработку персональных данных');
    }

    if (!isOpenNow()) {
      return fail(reply, 409, 'closed', 'Сейчас мы закрыты, заказ можно оформить в рабочие часы');
    }

    const format = FORMATS.find(f => f === body.format);
    if (!format) return fail(reply, 400, 'bad_format', 'Выберите, где вы будете есть');

    const payment = PAYMENTS.find(p => p === body.payment);
    if (!payment) return fail(reply, 400, 'bad_payment', 'Выберите способ оплаты');

    const parsed = parseLines(body.lines);
    if (typeof parsed === 'string') return fail(reply, 400, 'bad_lines', parsed);
    const { lines, total } = parsed;

    const pickup = body.pickup === 'time' ? 'time' : body.pickup === 'asap' ? 'asap' : undefined;
    const pickupLabel = cut(body.pickupLabel, LIMITS.pickupLabel) || undefined;
    const comment = cut(body.comment, LIMITS.comment) || undefined;

    // Кто заказывает: свой профиль по токену либо гость с именем и телефоном.
    const token = clientToken(req);
    let userId: string | null = null;
    let phone: string | null = null;
    let name = '';

    if (token) {
      const user = users.byId(token.sub);
      if (user) {
        userId = user.id;
        phone = user.phone;
        name = user.name;
      } else if (token.phone) {
        // Профиль удалён, но токен ещё жив — заказ примем как гостевой по телефону из токена.
        phone = token.phone;
      }
    }

    if (!phone) {
      phone = normalizePhone(str(body.phone));
      if (!phone) return fail(reply, 400, 'bad_phone', 'Укажите номер телефона: по нему мы сообщим, что заказ готов');
    }

    name = cut(body.name, LIMITS.guestName) || name || 'Гость';

    /*
     * Столик. Дальше и до создания заказа нет ни одного await: обращения к SQLite
     * синхронные, поэтому проверка «свободен» и занятие столика не разъедутся
     * между двумя одновременными заказами.
     */
    let table: number | null = null;
    if (format !== 'togo') {
      const zone: 'hall' | 'terrace' = format;
      const state = tables.state();
      if (body.table === 'any' || body.table === null || body.table === undefined) {
        // Свободных нет — заказ всё равно принимаем, столик назначит персонал.
        table = tables.firstFree(zone);
      } else {
        const n = Number(body.table);
        if (!Number.isInteger(n) || !state.zones[zone].includes(n)) {
          return fail(reply, 400, 'bad_table', 'Такого столика нет, выберите другой');
        }
        if (state.occupied[n]) {
          return fail(reply, 409, 'table_taken', 'Столик уже занят, выберите другой');
        }
        table = n;
      }
    }

    const created = orders.create({ userId, format, table, pickup, pickupLabel, payment, lines, comment, total, name, phone });

    // Кухня получает заказ целиком, клиент — свой заказ без телефона (об этом заботится hub).
    hub.publishOrder(created, { userId, phone });
    hub.publishTables(tables.state());

    const actor = userId ? 'user:' + userId : 'guest';
    audit(actor, 'order.created', { no: created.no, format, table, total, positions: lines.length, guest: !userId });
    if (!userId) {
      // Согласие гостя фиксируем отдельно: доказывать его придётся кафе.
      audit(actor, 'consent.given', { source: 'order', no: created.no, version: CONSENT_VERSION });
    }

    return reply.status(201).send(forClient(created));
  });

  /** Свои заказы: и оформленные в приложении, и принятые персоналом по звонку на тот же номер. */
  app.get('/orders', async (req, reply) => {
    const token = clientToken(req);
    if (!token) return fail(reply, 401, 'unauthorized', 'Нужен вход, чтобы посмотреть свои заказы');

    const user = users.byId(token.sub);
    const phone = user?.phone ?? token.phone ?? null;

    const merged = new Map<number, ApiOrder>();
    if (user) for (const o of orders.byUser(user.id)) merged.set(o.no, forClient(o));
    if (phone) for (const o of orders.byPhone(phone)) if (!merged.has(o.no)) merged.set(o.no, forClient(o));

    return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt);
  });

  /**
   * Один заказ. Чужой заказ — 404, а не 403: иначе по коду ответа можно перебором
   * узнать, какие номера заказов существуют.
   */
  app.get<{ Params: { no: string } }>('/orders/:no', async (req, reply) => {
    const token = clientToken(req);
    if (!token) return fail(reply, 401, 'unauthorized', 'Нужен вход, чтобы посмотреть заказ');

    const found = findOwn(req.params.no, token);
    if (!found) return fail(reply, 404, 'not_found', 'Заказ не найден');

    return forClient(found.order);
  });

  /** Отмена клиентом — пока заказ не встал на плиту. */
  app.post<{ Params: { no: string } }>('/orders/:no/cancel', async (req, reply) => {
    const token = clientToken(req);
    if (!token) return fail(reply, 401, 'unauthorized', 'Нужен вход, чтобы отменить заказ');

    const found = findOwn(req.params.no, token);
    if (!found) return fail(reply, 404, 'not_found', 'Заказ не найден');

    const { order, ownerId, ownerPhone } = found;
    if (order.status === 'cancelled') return forClient(order);
    if (order.status !== 'new' && order.status !== 'accepted') {
      return fail(reply, 409, 'too_late', 'Заказ уже готовится, отмените по телефону');
    }

    const updated = orders.setStatus(order.no, 'cancelled');
    if (!updated) return fail(reply, 404, 'not_found', 'Заказ не найден');

    hub.publishOrder(updated, { userId: ownerId, phone: ownerPhone });
    hub.publishTables(tables.state());
    audit(ownerId ? 'user:' + ownerId : 'guest', 'order.cancelled', { no: updated.no, by: 'client' });

    return forClient(updated);
  });
}

/**
 * Ищет заказ, принадлежащий владельцу токена: по идентификатору пользователя
 * либо по телефону (заказ мог внести персонал по звонку).
 */
function findOwn(rawNo: string, token: TokenPayload):
  { order: ApiOrder; ownerId: string | null; ownerPhone: string | null } | null {
  const no = Number(rawNo);
  if (!Number.isInteger(no)) return null;

  const row = orders.rawByNo(no);
  if (!row) return null;

  const user = users.byId(token.sub);
  const phone = user?.phone ?? token.phone ?? null;
  const mine = (row.user_id !== null && row.user_id === (user?.id ?? token.sub))
    || (row.phone !== null && phone !== null && row.phone === phone);
  if (!mine) return null;

  const order = orders.byNo(no, { withPhone: false, userId: user?.id ?? token.sub });
  return order ? { order, ownerId: row.user_id, ownerPhone: row.phone } : null;
}
