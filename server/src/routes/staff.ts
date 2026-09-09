/**
 * Панель персонала (кухня).
 *
 * Вход — по логину и PIN, дальше всё закрыто токеном сотрудника: он живёт часами
 * (STAFF_TOKEN_HOURS), то есть заканчивается вместе со сменой.
 *
 * Персоналу, в отличие от клиента, телефоны видны: без них нельзя перезвонить по заказу.
 * Поэтому все маршруты здесь отдают заказы вместе с номером — и ни один из них
 * не доступен без проверки requireStaff().
 *
 * Из-за этого вход сотрудника — самое ценное место сервера: один подобранный PIN открывает
 * имена и телефоны всех гостей. Поэтому у него два независимых рубежа: предел частоты по IP
 * и счётчик неудач по самой учётной записи (ниже), как счётчик попыток кода в routes/auth.ts.
 */
import type { FastifyError, FastifyInstance, FastifyRequest } from 'fastify';
// Только ради типов: плагин ограничения частоты добавляет полю config маршрута ключ rateLimit.
import type {} from '@fastify/rate-limit';
import { config } from '../config.ts';
import { audit, orders, staff, tables, users } from '../db.ts';
import { bearer, normalizePhone, pinMatches, signToken, verifyToken } from '../auth.ts';
import type { TokenPayload } from '../auth.ts';
import { hub } from '../events.ts';
import type { ApiError, ApiLine, ApiOrder, Format, OrderStatus, StaffLoginBody, StaffLoginReply } from '../types.ts';

/* ---------- общее ---------- */

/** Ошибка с кодом состояния: её подхватывает обработчик этого плагина и отдаёт как ApiError. */
function fail(status: number, code: string, message: string): never {
  const err = new Error(message) as Error & { statusCode: number; code: string; expose: boolean };
  err.statusCode = status;
  err.code = code;
  err.expose = true; // текст написан для человека, его отдаём как есть
  throw err;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Названия статусов по-русски: нужны в пояснениях к отказам. */
const STATUS_NAME: Record<OrderStatus, string> = {
  new: 'новый',
  accepted: 'принят',
  cooking: 'готовится',
  ready: 'готов',
  done: 'выдан',
  cancelled: 'отменён',
};

/** Все возможные статусы списком: по нему проверяем присланное значение. */
const STATUSES: OrderStatus[] = ['new', 'accepted', 'cooking', 'ready', 'done', 'cancelled'];

/**
 * Известен ли такой статус.
 *
 * Проверяем по списку, а не оператором `in`: он идёт по цепочке прототипов, поэтому
 * 'toString', 'constructor' и '__proto__' прошли бы как «известный статус», а в текст
 * отказа подставилось бы внутреннее представление JavaScript вместо русского названия.
 */
const isStatus = (v: unknown): v is OrderStatus =>
  typeof v === 'string' && (STATUSES as readonly string[]).includes(v);

/** Куда можно перейти из каждого статуса. Всё остальное — ошибка, а не молчаливое согласие. */
const NEXT_STATUS: Record<OrderStatus, OrderStatus[]> = {
  new: ['cancelled'],
  accepted: ['cooking', 'cancelled'],
  cooking: ['ready', 'cancelled'],
  ready: ['done', 'cancelled'],
  done: [],
  cancelled: [],
};

/** Кнопки времени готовности в панели кухни. */
const ETA_CHOICES = [10, 15, 20, 30];

const FORMATS: Format[] = ['hall', 'terrace', 'togo'];

/** Границы того, что персонал вводит руками: без них в базу и в рассылку уйдёт что угодно. */
const LIMITS = {
  /** логин сотрудника: столько же принимает scripts/add-staff.ts */
  login: 32,
  /** PIN: длиннее человек не наберёт, а гнать килобайты через scrypt незачем */
  pin: 64,
  /** сумма заказа по звонку, рубли */
  sum: 100_000,
  /** описание заказа по звонку — попадает в строку заказа и на экран кухни */
  text: 120,
  /** имя гостя */
  name: 60,
} as const;

/* ---------- формат ответа об ошибке ---------- */

/** Машинный код ошибки: приложение понимает только строчные латинские идентификаторы. */
const OWN_CODE = /^[a-z][a-z0-9_]*$/;

/** Код ошибки в теле ответа должен отвечать статусу, иначе клиент разберёт его неверно. */
const CODE_BY_STATUS: Record<number, string> = {
  400: 'bad_request',
  404: 'not_found',
  405: 'method_not_allowed',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
};

/** Русский текст для частых служебных ошибок Fastify: свои сообщения у них английские. */
const FASTIFY_MESSAGES: Record<string, string> = {
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'Отправьте данные в формате JSON',
  FST_ERR_CTP_INVALID_JSON: 'Тело запроса не является корректным JSON',
  FST_ERR_CTP_INVALID_JSON_BODY: 'Тело запроса не является корректным JSON',
  FST_ERR_CTP_BODY_TOO_LARGE: 'Запрос слишком большой',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'Тело запроса пустое',
  FST_ERR_VALIDATION: 'Некорректный запрос',
};

/* ---------- защита входа от перебора ---------- */

/** Сколько неудач подряд по одному логину терпим до блокировки. */
const LOGIN_MAX_FAILS = 5;

/** Растущие паузы после каждой следующей блокировки одного логина, мс. */
const LOCK_STEPS = [60_000, 5 * 60_000, 15 * 60_000];

/** Через столько без новых попыток счётчик неудач по логину обнуляется сам, мс. */
const FAIL_WINDOW = 15 * 60_000;

/** Столько длится любой отказ на /staff/login: разное время выдало бы существование логина. */
const LOGIN_ANSWER_MS = 400;

/** Больше стольких логинов в памяти держать незачем: это уже перебор, старые записи чистим. */
const LOGIN_TRACK_MAX = 5000;

/**
 * Фиктивный хэш того же вида (соль:хэш) для несуществующих логинов.
 *
 * С ним scrypt считается при любом исходе, и время ответа не выдаёт, заведена ли
 * такая учётная запись. Совпасть с ним не может ни один PIN: настоящий хэш —
 * это результат scrypt, а не строка нулей, да и проверка `!row` срабатывает раньше.
 */
const DUMMY_PIN_HASH = '0'.repeat(32) + ':' + '0'.repeat(64);

/**
 * Неудачные попытки входа по каждому логину.
 *
 * Предел частоты в маршруте считает попытки по IP, а перебор с полусотни адресов такой счёт
 * обходит линейно: 10 000 вариантов четырёхзначного PIN закрываются за часы, притом что логин
 * у кухни один и предсказуем. Поэтому второй рубеж — на самой учётной записи.
 * Паузы намеренно короткие (до четверти часа): иначе посторонний пятью неверными
 * попытками закрыл бы вход настоящей смене.
 */
const loginFails = new Map<string, { fails: number; locks: number; until: number; seen: number }>();

/** Убирает из памяти логины, о которых давно ничего не слышно. */
function pruneLoginFails(nowMs: number) {
  if (loginFails.size <= LOGIN_TRACK_MAX) return;
  for (const [key, rec] of loginFails) {
    if (rec.until <= nowMs && nowMs - rec.seen > FAIL_WINDOW) loginFails.delete(key);
  }
}

/** Сколько миллисекунд вход по этому логину ещё закрыт; 0 — можно проверять PIN. */
function lockLeft(login: string, nowMs: number): number {
  const rec = loginFails.get(login);
  if (!rec) return 0;
  if (rec.until > nowMs) return rec.until - nowMs;
  // Окно прошло без новых попыток — история неудач больше ни о чём не говорит.
  if (nowMs - rec.seen > FAIL_WINDOW) loginFails.delete(login);
  return 0;
}

/** Отмечает неудачу. Возвращает длительность блокировки, если она наступила именно сейчас. */
function noteFail(login: string, nowMs: number): number {
  const rec = loginFails.get(login) ?? { fails: 0, locks: 0, until: 0, seen: nowMs };
  if (nowMs - rec.seen > FAIL_WINDOW) {
    rec.fails = 0;
    rec.locks = 0;
  }
  rec.fails += 1;
  rec.seen = nowMs;

  let locked = 0;
  if (rec.fails >= LOGIN_MAX_FAILS) {
    locked = LOCK_STEPS[Math.min(rec.locks, LOCK_STEPS.length - 1)];
    rec.until = nowMs + locked;
    rec.locks += 1;
    rec.fails = 0;
  }

  loginFails.set(login, rec);
  pruneLoginFails(nowMs);
  return locked;
}

/** Удачный вход стирает историю неудач: сотрудник просто ошибался PIN-кодом. */
const noteSuccess = (login: string) => void loginFails.delete(login);

/* ---------- разбор запроса ---------- */

/** Проверяет токен сотрудника и заодно то, что он не заблокирован в базе. */
function requireStaff(req: FastifyRequest): TokenPayload {
  const payload = verifyToken(bearer(req.headers.authorization));
  if (!payload || (payload.role !== 'staff' && payload.role !== 'admin')) {
    fail(401, 'unauthorized', 'Нужен вход сотрудника');
  }
  if (!staff.byId(payload.sub)) {
    fail(401, 'unauthorized', 'Доступ сотрудника отозван, войдите заново');
  }
  return payload;
}

/**
 * Число из адреса: только цифры и ничего после них.
 *
 * Number.parseInt читает ведущие цифры и молча отбрасывает хвост, поэтому «1002xyz»
 * менял бы заказ №1002: опечатка в клиенте превращалась бы в успешное действие
 * над чужим заказом, а в журнале оставался бы номер, которого в запросе не было.
 */
function parseFromPath(raw: string, message: string): number {
  if (!/^\d{1,9}$/.test(raw)) fail(400, 'bad_request', message);
  const n = Number(raw);
  if (n <= 0) fail(400, 'bad_request', message);
  return n;
}

/** Номер заказа из адреса. */
const parseNo = (raw: string) => parseFromPath(raw, 'Неверный номер заказа');

/** Заказ из базы вместе с владельцем; без него дальше идти некуда. */
function loadOrder(no: number) {
  const row = orders.rawByNo(no);
  if (!row) fail(404, 'not_found', `Заказ №${no} не найден`);
  return row;
}

/**
 * Рассылает обновлённый заказ: кухне — целиком, владельцу — без телефона.
 * Владельца берём из базы, а не из запроса: заказ мог быть создан по звонку.
 */
function publishOrder(order: ApiOrder) {
  const row = orders.rawByNo(order.no);
  hub.publishOrder(order, { userId: row?.user_id ?? null, phone: row?.phone ?? null });
}

/** Занятость столиков видят и кухня, и клиент при выборе места. */
function publishTables() {
  hub.publishTables(tables.state());
}

/* ---------- маршруты ---------- */

export async function staffRoutes(app: FastifyInstance) {
  /**
   * Свой обработчик ошибок: маршруты регистрируются раньше общего обработчика в server.ts,
   * а Fastify запоминает обработчик на момент регистрации маршрута — без этого панель кухни
   * получила бы ответ формата Fastify («error»: «Unauthorized») вместо ApiError {error, message}
   * с машинным кодом, и не смогла бы отличить conflict от not_found.
   * Обработчик объявлен внутри плагина, поэтому на чужие маршруты он не влияет.
   */
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) app.log.error({ err, url: req.url }, 'ошибка в маршрутах персонала');

    const code = String(err.code ?? '');
    const own = (err as { expose?: boolean }).expose === true;
    let error = 'bad_request';
    let message = 'Некорректный запрос';

    if (status >= 500) {
      error = 'internal';
      message = 'Внутренняя ошибка сервера';
    } else if (own && OWN_CODE.test(code)) {
      // Наши собственные отказы: и код, и текст написаны здесь же.
      error = code;
      message = err.message;
    } else if (status === 429) {
      error = 'too_many_requests';
      message = 'Слишком много запросов. Подождите немного и попробуйте снова.';
    } else {
      // Чужие 4xx: код подбираем под статус, служебные коды FST_* наружу не выносим.
      error = CODE_BY_STATUS[status] ?? 'bad_request';
      message = FASTIFY_MESSAGES[code] ?? (err.message && !code.startsWith('FST_') ? err.message : 'Некорректный запрос');
    }

    const body: ApiError = { error, message };
    reply.status(status).send(body);
  });

  /**
   * Вход сотрудника. Два рубежа: предел частоты по IP (ниже) и счётчик неудач
   * по логину (loginFails) — по отдельности каждый из них обходится.
   */
  app.post<{ Body: Partial<StaffLoginBody> }>(
    '/staff/login',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '5 minutes',
          keyGenerator: (req: FastifyRequest) => req.ip,
          // Плагин ждёт именно объект ошибки: из него берётся код ответа.
          errorResponseBuilder: () =>
            Object.assign(new Error('Слишком много попыток входа. Подождите несколько минут.'), {
              statusCode: 429,
              code: 'too_many_requests',
              expose: true,
            }),
        },
      },
    },
    async req => {
      const started = Date.now();
      const body = req.body ?? {};
      // Обрезаем сразу: логин приходит без токена, попадает в журнал и в поиск по базе,
      // а тело запроса ограничено только общим пределом сервера в 256 КБ.
      const login = typeof body.login === 'string' ? body.login.trim().slice(0, LIMITS.login) : '';
      const pin = typeof body.pin === 'string' ? body.pin.slice(0, LIMITS.pin) : '';

      const left = lockLeft(login, started);
      if (left > 0) {
        fail(
          429,
          'too_many_requests',
          `Слишком много попыток входа для этого логина. Подождите ${Math.ceil(left / 1000)} с.`,
        );
      }

      const row = login ? staff.byLogin(login) : undefined;
      // Хэш считаем всегда, в том числе для несуществующего логина: scrypt занимает около
      // 100 мс, и без этого по времени ответа перебирались бы имена учётных записей.
      const matched = pinMatches(pin, row?.pin_hash ?? DUMMY_PIN_HASH);

      if (!row || !pin || !matched) {
        const locked = noteFail(login, Date.now());
        // В actor — не присланный текст, а признак: иначе журнал согласий (152-ФЗ)
        // засоряется вводом постороннего, и запись не отличить от настоящей.
        audit('staff:?', 'staff.login.failed', { ip: req.ip, login });
        if (locked) audit('staff:?', 'staff.login.locked', { ip: req.ip, login, seconds: Math.round(locked / 1000) });
        // Отказ занимает одинаковое время при любом исходе: и работа, и пауза
        // укладываются в общий срок, поэтому по нему нельзя узнать, есть ли такой логин.
        await sleep(Math.max(0, LOGIN_ANSWER_MS - (Date.now() - started)));
        fail(401, 'unauthorized', 'Неверный логин или PIN');
      }

      noteSuccess(login);
      const token = signToken({ sub: row.id, role: row.role }, config.staffTokenHours * 3600);
      audit('staff:' + row.id, 'staff.login', { ip: req.ip });
      const reply: StaffLoginReply = { token, staff: { id: row.id, name: row.name, role: row.role } };
      return reply;
    },
  );

  /** Лента кухни: незакрытые заказы и недавно выданные, с телефонами. */
  app.get('/staff/orders', async req => {
    requireStaff(req);
    return { orders: orders.forStaff() };
  });

  /**
   * Заказ по телефонному звонку: одна строка со свободным текстом и суммой,
   * которую назвал кассир. Если номер уже есть в базе — привязываем к пользователю,
   * тогда заказ появится у него в приложении.
   */
  app.post<{ Body: { phone?: unknown; text?: unknown; format?: unknown; sum?: unknown; name?: unknown } }>(
    '/staff/orders',
    async req => {
      const me = requireStaff(req);
      const body = req.body ?? {};

      const phone = normalizePhone(typeof body.phone === 'string' ? body.phone : '');
      if (!phone) fail(400, 'bad_request', 'Неверный номер телефона');

      const format = FORMATS.includes(body.format as Format) ? (body.format as Format) : null;
      if (!format) fail(400, 'bad_request', 'Неверный формат заказа');

      // Верхняя граница обязательна: Math.round(1e21) — по-прежнему 1e21, и такая «сумма»
      // легла бы в целочисленную колонку вещественным числом и ушла бы кухне и клиенту.
      const sum = Math.round(Number(body.sum));
      if (!Number.isSafeInteger(sum) || sum < 1 || sum > LIMITS.sum) {
        fail(400, 'bad_request', 'Сумма заказа — целое число от 1 до 100 000 ₽');
      }

      const text = typeof body.text === 'string' ? body.text.trim().slice(0, LIMITS.text) : '';
      const line: ApiLine = { name: text || 'Заказ по звонку', unit: sum, qty: 1 };

      const user = users.byPhone(phone);
      const name = (typeof body.name === 'string' && body.name.trim().slice(0, LIMITS.name)) || user?.name || 'По звонку';

      // Столик не занимаем: его назначит кухня, когда примет заказ.
      const order = orders.create({
        userId: user?.id ?? null,
        format,
        table: null,
        payment: 'cash',
        lines: [line],
        total: sum,
        name,
        phone,
        byPhone: true,
      });

      audit('staff:' + me.sub, 'order.created', { no: order.no, byPhone: true });
      publishOrder(order);
      return { order };
    },
  );

  /**
   * Принять заказ и назвать время готовности. Если гость ест в кафе,
   * а столик не выбран — сажаем за первый свободный в его зоне.
   */
  app.post<{ Params: { no: string }; Body: { eta?: unknown } }>('/staff/orders/:no/accept', async req => {
    const me = requireStaff(req);
    const no = parseNo(req.params.no);
    const row = loadOrder(no);

    const eta = Number(req.body?.eta);
    if (!ETA_CHOICES.includes(eta)) {
      fail(400, 'bad_request', `Время готовности: ${ETA_CHOICES.join(', ')} минут`);
    }
    if (row.status !== 'new') {
      fail(409, 'conflict', `Заказ №${no} уже нельзя принять: он сейчас «${STATUS_NAME[row.status]}»`);
    }

    let table = row.table_no;
    if (row.format !== 'togo' && !table) {
      table = tables.firstFree(row.format === 'terrace' ? 'terrace' : 'hall');
    }

    const order = orders.setStatus(no, 'accepted', { eta, table });
    if (!order) fail(404, 'not_found', `Заказ №${no} не найден`);
    if (table && table !== row.table_no) {
      tables.occupy(table, no);
      publishTables();
    }

    audit('staff:' + me.sub, 'order.status', { no, status: 'accepted', eta, table });
    publishOrder(order);
    return { order };
  });

  /** Движение заказа по кухне: готовится → готов → выдан, либо отмена. */
  app.post<{ Params: { no: string }; Body: { status?: unknown } }>('/staff/orders/:no/status', async req => {
    const me = requireStaff(req);
    const no = parseNo(req.params.no);
    const row = loadOrder(no);

    const status = req.body?.status;
    if (!isStatus(status)) fail(400, 'bad_request', 'Неизвестный статус заказа');
    if (!NEXT_STATUS[row.status].includes(status)) {
      fail(
        409,
        'conflict',
        `Заказ №${no} сейчас «${STATUS_NAME[row.status]}», перевести его в «${STATUS_NAME[status]}» нельзя`,
      );
    }

    const order = orders.setStatus(no, status);
    if (!order) fail(404, 'not_found', `Заказ №${no} не найден`);

    audit('staff:' + me.sub, 'order.status', { no, status });
    publishOrder(order);
    // Выданный и отменённый заказ освобождают столик — покажем это в зале.
    if (row.table_no && (status === 'done' || status === 'cancelled')) publishTables();
    return { order };
  });

  /** Сдвинуть время готовности («+5 мин»), пока заказ ещё не готов. */
  app.post<{ Params: { no: string }; Body: { eta?: unknown } }>('/staff/orders/:no/eta', async req => {
    const me = requireStaff(req);
    const no = parseNo(req.params.no);
    const row = loadOrder(no);

    const eta = Math.round(Number(req.body?.eta));
    if (!Number.isFinite(eta) || eta < 5 || eta > 180) {
      fail(400, 'bad_request', 'Время готовности — от 5 до 180 минут');
    }
    if (row.status !== 'accepted' && row.status !== 'cooking') {
      fail(409, 'conflict', `Заказ №${no} сейчас «${STATUS_NAME[row.status]}», время готовности уже не меняют`);
    }

    const order = orders.setEta(no, eta);
    if (!order) fail(404, 'not_found', `Заказ №${no} не найден`);

    audit('staff:' + me.sub, 'order.eta', { no, eta });
    publishOrder(order);
    return { order };
  });

  /** Занятость столиков: зал и терраса. */
  app.get('/staff/tables', async req => {
    requireStaff(req);
    return { tables: tables.state() };
  });

  /** Ручная отметка занятости: гость сел без заказа или, наоборот, ушёл. */
  app.post<{ Params: { n: string } }>('/staff/tables/:n/toggle', async req => {
    const me = requireStaff(req);
    const n = parseFromPath(req.params.n, 'Неверный номер столика');

    const before = tables.state();
    // Object.hasOwn, а не `in`: ключи прототипа не должны считаться существующими столиками.
    if (!Object.hasOwn(before.occupied, n)) fail(404, 'not_found', `Столик №${n} не найден`);

    // Освободить столик, за которым висит незакрытый заказ, — значит развести зал и заказ:
    // за столик тут же сядет следующий гость, а выдача первого заказа освободит место
    // уже под ним. Пусть кухня сначала закроет заказ.
    if (before.occupied[n]) {
      const busy = orders.forStaff().find(o => o.table === n && o.status !== 'done' && o.status !== 'cancelled');
      if (busy) fail(409, 'conflict', `За столиком №${n} заказ №${busy.no}, сначала закройте его`);
    }

    const occupied = tables.toggle(n);
    audit('staff:' + me.sub, 'table.toggle', { n, occupied });
    publishTables();
    return { n, occupied, tables: tables.state() };
  });
}
