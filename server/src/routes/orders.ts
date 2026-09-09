/**
 * Заказы со стороны клиента.
 *
 * Здесь живут только клиентские действия: оформить заказ, посмотреть свои заказы,
 * отменить, пока кухня не начала готовить. Всё, что делает персонал, — в routes/staff.ts.
 *
 * Три правила, ради которых написана половина файла:
 *   1) сумма заказа считается на сервере, цена из тела запроса не принимается;
 *   2) телефон клиенту не возвращается — он есть только у персонала (152-ФЗ: минимизация данных);
 *   3) телефон из тела запроса никем не подтверждён, поэтому доступ к заказу он не открывает.
 *
 * Заказ без регистрации разрешён: гость указывает имя и телефон, и это всё.
 * Отказ в обслуживании из-за отказа от регистрации недопустим (ст. 16 закона «О защите прав потребителей»).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.ts';
import { audit, orders, tables, users } from '../db.ts';
import { bearer, normalizePhone, signToken, verifyToken } from '../auth.ts';
import type { TokenPayload } from '../auth.ts';
import { hub } from '../events.ts';
import type { ApiError, ApiLine, ApiOrder, Format, PaymentId } from '../types.ts';

/** Версия текста согласия, под которым клиент оформляет заказ. Пишется в журнал. */
const CONSENT_VERSION = '1.0';

/**
 * Ключ гостя на один заказ: субъект токена выглядит как «order:1005».
 * Такой токен выдаётся вместе с гостевым заказом и не открывает ничего, кроме него.
 */
const ORDER_SUB = 'order:';

/** Сколько живёт ключ гостевого заказа, часов: столько, сколько имеет смысл смотреть статус. */
const ORDER_TOKEN_HOURS = 12;

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
  /** Сколько неподтверждённых заказов разрешено держать на один номер телефона. */
  pending: 3,
} as const;

const FORMATS: Format[] = ['hall', 'terrace', 'togo'];
const PAYMENTS: PaymentId[] = ['cash', 'card', 'online'];

/** Строка профиля так, как её отдаёт база: свой тип объявлять негде, берём из репозитория. */
type UserRow = NonNullable<ReturnType<typeof users.byId>>;

/** Ответ на создание заказа: сам заказ и, для гостя, ключ доступа именно к этому заказу. */
type CreatedOrder = ApiOrder & { orderToken?: string };

/**
 * Кто пришёл с токеном: либо клиент с живым профилем, либо гость с ключом на один заказ.
 * Третьего не дано: телефон сам по себе прав ни на что не даёт.
 */
interface Caller {
  /** профиль клиента, вошедшего по SMS */
  user: UserRow | null;
  /** номер заказа, к которому даёт доступ гостевой ключ */
  orderNo: number | null;
  /** субъект действия для журнала */
  actor: string;
}

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

/**
 * Разбор токена клиента.
 *
 * Профиля нет — токен недействителен, и откатываться на телефон из токена нельзя:
 * человек мог удалить аккаунт (152-ФЗ, ст. 21), а токен живёт до 90 дней. Иначе по
 * мёртвому токену открывался бы доступ к чужим заказам на тот же номер телефона.
 */
function caller(req: FastifyRequest): Caller | null {
  const payload = clientToken(req);
  if (!payload) return null;

  if (payload.sub.startsWith(ORDER_SUB)) {
    const no = Number(payload.sub.slice(ORDER_SUB.length));
    if (!Number.isInteger(no)) return null;
    return { user: null, orderNo: no, actor: ORDER_SUB + no };
  }

  const user = users.byId(payload.sub);
  if (!user) return null;
  return { user, orderNo: null, actor: 'user:' + user.id };
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

/**
 * Разбор строк заказа: возвращает либо очищенные строки, либо текст ошибки.
 *
 * Цены приходят от клиента: своего справочника меню на сервере пока нет.
 * Поэтому здесь только формальная проверка (целые рубли, разумные пределы),
 * а настоящая защита от подделки цены появится вместе с таблицей меню —
 * тогда unit нужно будет считать по itemId и присланное значение игнорировать,
 * как уже игнорируется присланная сумма заказа.
 */
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

    // Цены в меню — целые рубли: дробная копеечная цена дала бы заказ на нулевую сумму.
    const unit = Number(src.unit);
    if (!Number.isInteger(unit) || unit < 1 || unit > LIMITS.unit) return `Неверная цена позиции «${name}»`;

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
  const sum = Math.round(total);
  // Заказ на ноль рублей кухня увидела бы как оплаченный по нулю — такого не принимаем.
  if (sum <= 0) return 'Заказ на нулевую сумму принять нельзя, соберите корзину заново';
  return { lines, total: sum };
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
    const profile = token && !token.sub.startsWith(ORDER_SUB) ? users.byId(token.sub) : undefined;

    let userId: string | null = null;
    let phone: string | null = null;
    // Имя из тела запроса берём только у гостя: у клиента с профилем имя меняется через PATCH /me.
    let name = 'Гость';

    if (profile) {
      userId = profile.id;
      phone = profile.phone;
      name = profile.name || 'Гость';
    } else {
      name = cut(body.name, LIMITS.guestName) || 'Гость';
      phone = normalizePhone(str(body.phone));
      if (!phone) {
        // Токен есть, а профиля нет — аккаунт удалён. Телефон из токена не подставляем:
        // человек воспользовался правом на удаление, вернуть его номер в базу мы не вправе.
        if (token) return fail(reply, 401, 'unauthorized', 'Профиль не найден. Войдите заново или оформите заказ как гость');
        return fail(reply, 400, 'bad_phone', 'Укажите номер телефона: по нему мы сообщим, что заказ готов');
      }
    }

    // Телефон никто не подтверждал, поэтому ограничиваем число висящих заказов на номер:
    // иначе с одного адреса можно за минуту занять все столики и завалить кухонный экран.
    const pending = orders.byPhone(phone).filter(o => o.status === 'new').length;
    if (pending >= LIMITS.pending) {
      return fail(reply, 409, 'too_many_active',
        'Слишком много неподтверждённых заказов на этот номер. Дождитесь ответа кухни или позвоните нам');
    }

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

    // userId проставлен только по живому профилю, поэтому actor — действительно тот, кто заказывал.
    const actor = userId ? 'user:' + userId : 'guest';
    audit(actor, 'order.created', { no: created.no, format, table, total, positions: lines.length, guest: !userId });

    const out: CreatedOrder = forClient(created);
    if (!userId) {
      // Согласие гостя фиксируем отдельно: доказывать его придётся кафе.
      audit(actor, 'consent.given', { source: 'order', no: created.no, version: CONSENT_VERSION });
      // Ключ на этот заказ: без него гость, отказавшийся от регистрации, потерял бы заказ из виду.
      out.orderToken = signToken({ sub: ORDER_SUB + created.no, role: 'user' }, ORDER_TOKEN_HOURS * 3600);
    }

    return reply.status(201).send(out);
  });

  /** Свои заказы: и оформленные в приложении, и принятые персоналом по звонку на тот же номер. */
  app.get('/orders', async (req, reply) => {
    const who = caller(req);
    if (!who?.user) return fail(reply, 401, 'unauthorized', 'Нужен вход, чтобы посмотреть свои заказы');
    const user = who.user;

    const merged = new Map<number, ApiOrder>();
    for (const o of orders.byUser(user.id)) merged.set(o.no, forClient(o));
    // По телефону подхватываем только заказы, внесённые персоналом по звонку: гостевой заказ
    // с неподтверждённым номером не должен попадать в чужой личный кабинет.
    for (const o of orders.byPhone(user.phone)) if (o.byPhone && !merged.has(o.no)) merged.set(o.no, forClient(o));

    return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt);
  });

  /**
   * Один заказ. Чужой заказ — 404, а не 403: иначе по коду ответа можно перебором
   * узнать, какие номера заказов существуют.
   */
  app.get<{ Params: { no: string } }>('/orders/:no', async (req, reply) => {
    const who = caller(req);
    if (!who) return fail(reply, 401, 'unauthorized', 'Нужен вход, чтобы посмотреть заказ');

    const found = findOwn(req.params.no, who);
    if (!found) return fail(reply, 404, 'not_found', 'Заказ не найден');

    return forClient(found.order);
  });

  /** Отмена клиентом — пока заказ не встал на плиту. */
  app.post<{ Params: { no: string } }>('/orders/:no/cancel', async (req, reply) => {
    const who = caller(req);
    if (!who) return fail(reply, 401, 'unauthorized', 'Нужен вход, чтобы отменить заказ');

    const found = findOwn(req.params.no, who);
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
    // В журнале — тот, кто отменил (владелец заказа уходит в подробности): запись должна
    // отвечать на вопрос «кто это сделал», иначе она бесполезна в спорной ситуации.
    audit(who.actor, 'order.cancelled', { no: updated.no, by: 'client', owner: ownerId ?? 'guest' });

    return forClient(updated);
  });
}

/**
 * Ищет заказ, принадлежащий тому, кто пришёл с токеном.
 *
 * Клиенту с профилем принадлежат его собственные заказы и заказы, внесённые персоналом
 * по звонку на его номер (by_phone). Совпадение телефона само по себе ничего не значит:
 * номер в гостевом заказе никто не подтверждал, его мог указать кто угодно.
 * Гостевой ключ открывает ровно один заказ — тот, на который он выдан.
 */
function findOwn(rawNo: string, who: Caller):
  { order: ApiOrder; ownerId: string | null; ownerPhone: string | null } | null {
  const no = Number(rawNo);
  if (!Number.isInteger(no)) return null;
  if (who.orderNo !== null && who.orderNo !== no) return null;

  const row = orders.rawByNo(no);
  if (!row) return null;

  const user = who.user;
  const mine = user
    ? row.user_id === user.id || (row.by_phone === 1 && row.phone !== null && row.phone === user.phone)
    : who.orderNo === no && row.user_id === null;
  if (!mine) return null;

  const order = orders.byNo(no, { withPhone: false, userId: user?.id ?? null });
  return order ? { order, ownerId: row.user_id, ownerPhone: row.phone } : null;
}
