/**
 * Клиент HTTP-API кафе GRAFF.
 *
 * Боевой режим включается переменной сборки VITE_API_URL (адрес сервера, например
 * https://graff.example.ru/api). Если переменная пуста — сервера нет, приложение остаётся
 * демо на localStorage: isLive() вернёт false, а любой вызов метода — ошибку с кодом 'demo'.
 *
 * Типы ниже — общий с сервером контракт (server/src/types.ts). Он повторён здесь намеренно:
 * клиент и сервер собираются отдельно и не делят исходники. Менять контракт нужно в двух
 * местах согласованно.
 *
 * Персональные данные: телефон уходит на сервер только в запросах входа и оформления заказа;
 * в ответах клиенту сервер телефон не отдаёт (поле phone заполнено только для персонала).
 */
import { phoneDigits10 } from './format';

export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
/** Боевой режим: адрес сервера задан при сборке. */
export const isLive = () => API_URL !== '';

/** Сколько ждём ответ сервера, миллисекунд. */
const TIMEOUT = 15_000;

/* ======================= контракт с сервером ======================= */

export type OrderStatus = 'new' | 'accepted' | 'cooking' | 'ready' | 'done' | 'cancelled';
export type Format = 'hall' | 'terrace' | 'togo';
export type PaymentId = 'cash' | 'card' | 'online';

export interface ApiLine {
  /** id позиции меню; пусто у заказов, внесённых персоналом вручную */
  itemId?: string;
  name: string;
  /** масса или объём порции на момент заказа */
  portion?: string;
  sauceNames?: string[];
  /** цена за единицу с учётом соусов, рубли */
  unit: number;
  qty: number;
}

export interface ApiOrder {
  no: number;
  status: OrderStatus;
  createdAt: number;
  acceptedAt?: number;
  readyAt?: number;
  doneAt?: number;
  /** обещанное время готовности, минут от acceptedAt */
  eta?: number;
  format: Format;
  table: number | null;
  pickup?: 'asap' | 'time';
  pickupLabel?: string;
  payment: PaymentId;
  lines: ApiLine[];
  comment?: string;
  total: number;
  name: string;
  /** телефон в маске: приходит только персоналу */
  phone?: string;
  /** заказ принадлежит текущему пользователю */
  mine?: boolean;
  /** заказ внесён персоналом по телефонному звонку */
  byPhone?: boolean;
}

/**
 * Ответ на оформление заказа. Гостю без регистрации сервер добавляет сюда ключ на этот заказ:
 * по нему приложение обновляет статус и подписывается на живые события.
 */
export interface CreatedOrder extends ApiOrder {
  orderToken?: string;
}

export interface ApiUser {
  id: string;
  name: string;
  phone: string;
  marketingConsent: boolean;
}

export interface RequestCodeBody {
  phone: string;
  /** согласие на обработку персональных данных: без него сервер код не отправит */
  consent: true;
  /** согласие на рекламу — отдельное и необязательное */
  marketing?: boolean;
}
export interface RequestCodeReply {
  ok: true;
  /** сколько секунд ждать до повторной отправки */
  retryAfter: number;
  /** у провайдера «log» сервер возвращает код, чтобы проверить вход без SMS */
  devCode?: string;
}

export interface VerifyCodeBody {
  phone: string;
  code: string;
  name?: string;
  /** отметка «Акции и новинки» со сплэша: сервер и включает, и выключает её по этому полю */
  marketing?: boolean;
}
export interface VerifyCodeReply {
  token: string;
  user: ApiUser;
}

export interface CreateOrderBody {
  lines: ApiLine[];
  format: Format;
  table: number | 'any' | null;
  pickup?: 'asap' | 'time';
  pickupLabel?: string;
  payment: PaymentId;
  comment?: string;
  /** для гостя без профиля */
  name?: string;
  phone?: string;
  /** подтверждение согласия на обработку данных для гостевого заказа */
  consent: true;
}

/**
 * Заказ, принятый персоналом по телефонному звонку: одна строка со свободным текстом
 * и суммой, которую назвал кассир. Столик назначается при принятии заказа.
 */
export interface StaffOrderBody {
  phone: string;
  /** что заказали — свободным текстом */
  text: string;
  format: Format;
  /** сумма, названная гостю по телефону, рубли */
  sum: number;
  /** имя гостя; если номер уже есть в базе, сервер подставит имя из профиля */
  name?: string;
}

export interface StaffLoginBody {
  login: string;
  pin: string;
}
export interface StaffLoginReply {
  token: string;
  staff: { id: string; name: string; role: 'staff' | 'admin' };
}

export interface TablesState {
  /** номер столика → занят ли */
  occupied: Record<number, boolean>;
  zones: { terrace: number[]; hall: number[] };
}

/** События потока SSE (server/src/events.ts). */
export type StreamEvent =
  | { type: 'order'; order: ApiOrder }
  | { type: 'tables'; tables: TablesState }
  | { type: 'ping' };

/** Тело ошибки сервера (на сервере — интерфейс ApiError). */
export interface ApiErrorBody {
  error: string;
  message: string;
}

/**
 * Что можно поменять в своём профиле. Сервер ждёт поле marketing;
 * marketingConsent принимается как синоним — так же называется поле в ApiUser.
 */
export interface MePatch {
  name?: string;
  /** отзыв или выдача согласия на рекламу; сервер пишет это в журнал согласий */
  marketing?: boolean;
  /** то же самое, но под именем поля профиля */
  marketingConsent?: boolean;
}

/** Выгрузка своих данных (152-ФЗ, ст. 14). */
export interface MyDataExport {
  user: ApiUser;
  consent: {
    version: string | null;
    at: number | null;
    marketing: boolean;
    marketingAt: number | null;
  };
  orders: ApiOrder[];
  exportedAt: number;
}

/**
 * Адреса маршрутов сервера (server/src/routes/*.ts) — меняются согласованно с сервером.
 * Клиентские маршруты отвечают самим значением, маршруты персонала — в обёртке
 * ({ orders }, { order }, { tables }); обёртку разбирают методы ниже.
 */
export const ROUTES = {
  requestCode: '/auth/request-code',
  verifyCode: '/auth/verify',
  me: '/me',
  meExport: '/me/data',
  orders: '/orders',
  order: (no: number) => `/orders/${no}`,
  cancelOrder: (no: number) => `/orders/${no}/cancel`,
  tables: '/tables',
  staffLogin: '/staff/login',
  staffOrders: '/staff/orders',
  staffAccept: (no: number) => `/staff/orders/${no}/accept`,
  staffStatus: (no: number) => `/staff/orders/${no}/status`,
  staffEta: (no: number) => `/staff/orders/${no}/eta`,
  staffTables: '/staff/tables',
  staffToggleTable: (n: number) => `/staff/tables/${n}/toggle`,
  stream: '/stream',
} as const;

/* ======================= токены ======================= */

const TOKEN_KEY = 'graff-token';
const STAFF_TOKEN_KEY = 'graff-staff-token';
/** Ключ на один заказ для гостя без регистрации: «<номер>:<токен>». */
const ORDER_TOKEN_KEY = 'graff-order-token';

/**
 * Запасное хранилище: в приватном окне localStorage может быть недоступен.
 * Память — именно запасной путь, а не зеркало: пока localStorage работает, токен читается
 * только оттуда. Иначе выход из аккаунта в соседней вкладке (или очистка данных сайта)
 * не доходил бы до этой вкладки и она продолжала бы слать стёртый токен.
 */
const memory = new Map<string, string>();
/** localStorage отказал — дальше живём на памяти вкладки до перезагрузки. */
let storageBroken = false;

function readKey(key: string): string {
  if (!storageBroken) {
    try {
      return localStorage.getItem(key) || '';
    } catch {
      storageBroken = true;
    }
  }
  return memory.get(key) || '';
}
function writeKey(key: string, value: string) {
  if (!storageBroken) {
    try {
      localStorage.setItem(key, value);
      memory.delete(key);
      return;
    } catch {
      storageBroken = true;
    }
  }
  memory.set(key, value);
}
function dropKey(key: string) {
  memory.delete(key);
  if (storageBroken) return;
  try {
    localStorage.removeItem(key);
  } catch {
    storageBroken = true;
  }
}

export const getToken = () => readKey(TOKEN_KEY);
export const setToken = (token: string) => writeKey(TOKEN_KEY, token);
export const clearToken = () => dropKey(TOKEN_KEY);

/**
 * Ключ гостя на его заказ. Сервер выдаёт его в ответе на оформление, когда входа не было,
 * и принимает в GET /orders/:no и в потоке событий. Без него заказ, оформленный без входа,
 * навсегда застыл бы на «ждём кухню».
 */
export function setOrderToken(no: number, token: string) {
  writeKey(ORDER_TOKEN_KEY, `${no}:${token}`);
}
export const clearOrderToken = () => dropKey(ORDER_TOKEN_KEY);
/** Ключ на заказ: без номера — любой сохранённый, с номером — только если он про этот заказ. */
export function orderToken(no?: number): string {
  const raw = readKey(ORDER_TOKEN_KEY);
  const at = raw.indexOf(':');
  if (at < 1) return '';
  if (no !== undefined && Number(raw.slice(0, at)) !== no) return '';
  return raw.slice(at + 1);
}
/** Номер заказа, за которым следит гость без регистрации. */
export function watchedOrderNo(): number | null {
  const raw = readKey(ORDER_TOKEN_KEY);
  const at = raw.indexOf(':');
  const no = at > 0 ? Number(raw.slice(0, at)) : NaN;
  return Number.isInteger(no) ? no : null;
}

export const getStaffToken = () => readKey(STAFF_TOKEN_KEY);
export const setStaffToken = (token: string) => writeKey(STAFF_TOKEN_KEY, token);
export const clearStaffToken = () => dropKey(STAFF_TOKEN_KEY);

/** Есть ли вход: токен лежит, но мог протухнуть — сервер проверит. */
export const hasToken = () => getToken() !== '';
export const hasStaffToken = () => getStaffToken() !== '';

/* ======================= ошибки ======================= */

/**
 * Ошибка обращения к серверу. message — по-русски, годится для показа гостю.
 * status = 0 означает, что ответа не было вовсе (нет сети, таймаут, демо-режим).
 */
export class ApiError extends Error {
  status: number;
  code: string;
  /** для ответа 429: через сколько секунд можно повторить (запрос кода, вход) */
  retryAfter?: number;
  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
  /**
   * Запрос не ушёл: сети нет, домен недоступен. Безопасно повторить чтение (GET).
   * Для отправки (POST) даже здесь нет полной гарантии: fetch падает TypeError и тогда,
   * когда связь оборвалась уже во время чтения ответа, — сначала смотрим myOrders().
   */
  get offline() {
    return this.status === 0 && this.code === 'network';
  }
  /**
   * Ответа не дождались за 15 секунд. Что успел сделать сервер — неизвестно:
   * заказ мог быть создан, разослан на кухню и записан в журнал, просто ответ не дошёл.
   * Слепо повторять createOrder нельзя — гость получит два одинаковых заказа.
   * Правильный путь: вызвать myOrders() (или getOrder по последнему номеру) и показать
   * заказ, если он уже создан. Идемпотентности у POST /orders пока нет: сервер не принимает
   * клиентский ключ попытки — это нужно добавить в CreateOrderBody при доработке сервера.
   */
  get maybeSent() {
    return this.status === 0 && this.code === 'timeout';
  }
  /** Нужен вход заново. */
  get unauthorized() {
    return this.status === 401;
  }
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Сервер не принял запрос',
  401: 'Нужно войти заново',
  403: 'Недостаточно прав',
  404: 'Ничего не нашлось',
  409: 'Так сделать нельзя: данные уже изменились',
  410: 'Заказ больше не доступен',
  422: 'Сервер не принял данные',
  429: 'Слишком часто. Подождите немного',
  503: 'Кафе сейчас не принимает заказы',
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

/** Код ошибки сервера кафе: 'too_many_attempts', 'bad_code'. У Fastify там 'Not Found'. */
const OWN_CODE = /^[a-z][a-z0-9_]*$/;
/** Признак русского текста: сообщения кафе написаны для гостя. */
const CYRILLIC = /[А-Яа-яЁё]/;

/**
 * Разбор неуспешного ответа в понятную ошибку.
 *
 * Тело формирует не только код кафе: общий ограничитель частоты и стандартный 404 Fastify
 * отдают {statusCode, error: 'Not Found', message: 'Route GET:/orders/9 not found'}.
 * Такому телу не верим: гостю в зале нужен русский текст, а сравнения вида e.code === 'not_found'
 * не должны молча ломаться о код с пробелом и заглавными буквами.
 */
async function errorFrom(res: Response, token?: string | null): Promise<ApiError> {
  let code = `http_${res.status}`;
  let message = '';
  let retryAfter: number | undefined;
  try {
    const data: unknown = await res.json();
    if (isObject(data)) {
      // statusCode в теле — признак стандартной ошибки Fastify, а не ответа кафе.
      const own = !('statusCode' in data);
      if (typeof data.error === 'string' && OWN_CODE.test(data.error)) code = data.error;
      if (typeof data.message === 'string' && data.message && (own || CYRILLIC.test(data.message))) {
        message = data.message;
      }
      if (typeof data.retryAfter === 'number') retryAfter = data.retryAfter;
    }
  } catch {
    /* тело не JSON — обойдёмся текстом по коду ответа */
  }
  // Заголовок Retry-After не читаем: он не входит в безопасные заголовки ответа CORS,
  // а сервер зарегистрирован без exposedHeaders, поэтому при разных доменах приложения
  // и API браузер всегда вернёт null. Таймер показываем только там, где сервер кладёт
  // retryAfter в тело (/auth/request-code). Чтобы читать заголовок, серверу нужно
  // добавить exposedHeaders: ['Retry-After'] в настройки cors.
  if (!message) {
    message = STATUS_TEXT[res.status] || (res.status >= 500 ? 'Сервер кафе временно недоступен' : `Ошибка сервера (${res.status})`);
  }
  // Токен протух или отозван — стираем, чтобы приложение вернуло гостя ко входу.
  if (res.status === 401) forgetToken(token);
  return new ApiError(res.status, code, message, retryAfter);
}

/** Стирает тот токен, с которым пришёл отказ. */
function forgetToken(token?: string | null) {
  if (!token) return;
  if (token === getStaffToken()) clearStaffToken();
  if (token === getToken()) clearToken();
}

/* ======================= запрос ======================= */

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** токен клиента или сотрудника; без него запрос уходит без заголовка Authorization */
  token?: string | null;
  /** внешняя отмена (размонтирование экрана) — складывается с таймаутом */
  signal?: AbortSignal;
}

/** Сервера нет: приложение собрано без VITE_API_URL и работает как демо. */
const demoError = () => new ApiError(0, 'demo', 'Демо-режим: адрес сервера кафе не задан при сборке');

/** Один запрос к серверу: JSON туда и обратно, таймаут 15 секунд, ошибки — в ApiError. */
async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  if (!isLive()) throw demoError();
  const { method = 'GET', body, token, signal } = opts;

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, TIMEOUT);
  const relayAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', relayAbort, { once: true });
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(API_URL + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
      credentials: 'omit',
      cache: 'no-store',
      mode: 'cors',
    });
    if (!res.ok) throw await errorFrom(res, token);
    return await parseBody<T>(res);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (timedOut) throw new ApiError(0, 'timeout', 'Сервер кафе не ответил вовремя. Попробуйте ещё раз');
    if (signal?.aborted) throw new ApiError(0, 'aborted', 'Запрос отменён');
    // fetch падает TypeError, когда сети нет или домен недоступен.
    throw new ApiError(0, 'network', 'Нет связи с сервером кафе');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relayAbort);
  }
}

/** Успешный ответ: JSON либо пустое тело (204). */
async function parseBody<T>(res: Response): Promise<T> {
  if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(res.status, 'bad_response', 'Сервер кафе прислал непонятный ответ');
  }
}

/**
 * Токен клиента для методов, где вход обязателен.
 *
 * Демо-режим проверяем первым: без сервера смысла говорить про вход нет, а вызывающий код
 * ждёт обещанную ошибку с кодом 'demo'. Вызывать только внутри async-функций — тогда
 * ошибка приходит отказом промиса, а не выбросом в теле эффекта React.
 */
function userToken(): string {
  if (!isLive()) throw demoError();
  const t = getToken();
  if (!t) throw new ApiError(401, 'no_token', 'Нужно войти по номеру телефона');
  return t;
}
/** Токен сотрудника: смена закончилась — вход в панель заново. */
function staffToken(): string {
  if (!isLive()) throw demoError();
  const t = getStaffToken();
  if (!t) throw new ApiError(401, 'no_staff_token', 'Войдите в панель персонала');
  return t;
}

/**
 * Разбор обёртки ответа персонала ({ orders }, { order }, { tables }).
 * Прокси или 204 могут отдать пустое тело — тогда нужна понятная ApiError,
 * а не TypeError вида «Cannot read properties of undefined», который обойдёт
 * обработку ошибок в сторе.
 */
function unwrap<T>(reply: unknown, key: string, ok: (v: unknown) => boolean): T {
  const value = isObject(reply) ? reply[key] : undefined;
  if (!ok(value)) throw new ApiError(200, 'bad_response', 'Сервер кафе прислал непонятный ответ');
  return value as T;
}

/* ======================= вход и профиль ======================= */

/** Отметки с экрана входа. consent обязателен: его значение задаёт человек, а не код. */
export interface RequestCodeOptions {
  /** отметка «согласен на обработку персональных данных» */
  consent: boolean;
  /** отдельная и необязательная отметка про рекламу */
  marketing?: boolean;
}

/**
 * Запрос кода из SMS.
 *
 * Согласие — единственное поле контракта, которое клиентский слой не имеет права
 * подставлять за человека: по нему сервер сохраняет отметку с версией документов
 * и пишет её в журнал, то есть создаёт доказательство согласия по 152-ФЗ.
 * Поэтому consent приходит сюда с экрана входа, а не берётся из константы.
 *
 * Второй аргумент допускает и старую форму (просто отметка про рекламу) — так его
 * пока передаёт state/live.ts, где кнопка входа недоступна без отметки о согласии.
 * Эту форму нужно убрать, как только экран начнёт передавать обе отметки явно.
 */
export async function requestCode(
  phone: string,
  options: RequestCodeOptions | boolean = false,
  signal?: AbortSignal,
) {
  const opts: RequestCodeOptions = typeof options === 'boolean'
    ? { consent: true, marketing: options }
    : options;
  if (opts.consent !== true) {
    throw new ApiError(0, 'consent_required', 'Отметьте согласие на обработку персональных данных');
  }
  const body: RequestCodeBody = { phone: phoneDigits10(phone), consent: true, marketing: opts.marketing ?? false };
  return request<RequestCodeReply>(ROUTES.requestCode, { method: 'POST', body, signal });
}

/** Проверка кода. При успехе токен клиента сразу сохраняется. */
export async function verifyCode(phone: string, code: string, name?: string, marketing?: boolean, signal?: AbortSignal) {
  const body: VerifyCodeBody = { phone: phoneDigits10(phone), code: code.trim(), name: name?.trim() || undefined, marketing };
  const reply = await request<VerifyCodeReply>(ROUTES.verifyCode, { method: 'POST', body, signal });
  if (reply?.token) setToken(reply.token);
  return reply;
}

/** Свой профиль. */
export async function me(signal?: AbortSignal) {
  return request<ApiUser>(ROUTES.me, { token: userToken(), signal });
}

/** Изменение имени и согласия на рекламу. */
export async function updateMe(patch: MePatch, signal?: AbortSignal) {
  const token = userToken();
  const body: { name?: string; marketing?: boolean } = {};
  if (typeof patch.name === 'string') body.name = patch.name.trim();
  const marketing = patch.marketing ?? patch.marketingConsent;
  if (typeof marketing === 'boolean') body.marketing = marketing;
  return request<ApiUser>(ROUTES.me, { method: 'PATCH', body, token, signal });
}

/**
 * Удаление профиля и данных (152-ФЗ, ст. 21).
 *
 * Токен стираем только тогда, когда удаление действительно состоялось, и при 401
 * (аккаунта уже нет). При обрыве связи или 500 профиль в базе цел — если бы мы стёрли
 * токен, человек оказался бы «вышедшим» из аккаунта с сохранёнными данными и не смог бы
 * повторить удаление без нового входа по SMS. Ошибку пробрасываем: экран покажет
 * «не удалось удалить, попробуйте ещё раз».
 */
export async function deleteMe(signal?: AbortSignal) {
  try {
    const res = await request<{ ok: true }>(ROUTES.me, { method: 'DELETE', token: userToken(), signal });
    clearToken();
    return res;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) clearToken();
    throw e;
  }
}

/** Выгрузка своих данных: профиль, заказы, отметки о согласиях. */
export async function exportMyData(signal?: AbortSignal) {
  return request<MyDataExport>(ROUTES.meExport, { token: userToken(), signal });
}

/* ======================= заказы клиента ======================= */

/**
 * Оформление заказа. Гость без профиля отправляет имя и телефон в теле.
 *
 * При ошибке связи повторять вызов вслепую нельзя: таймаут (ApiError.maybeSent) и обрыв
 * во время чтения ответа наступают и тогда, когда сервер заказ уже создал и разослал
 * на кухню — повтор даст второй такой же заказ. Сначала myOrders(), и только если заказа
 * там нет — новая попытка.
 */
export async function createOrder(body: CreateOrderBody, signal?: AbortSignal) {
  const payload: CreateOrderBody = { ...body, phone: body.phone ? phoneDigits10(body.phone) : undefined };
  return request<CreatedOrder>(ROUTES.orders, { method: 'POST', body: payload, token: getToken() || null, signal });
}

/** История своих заказов. */
export async function myOrders(signal?: AbortSignal) {
  return request<ApiOrder[]>(ROUTES.orders, { token: userToken(), signal });
}

/**
 * Один заказ по номеру. Годится и вход по телефону, и ключ на заказ, который сервер выдаёт
 * гостю при оформлении без регистрации, — иначе такой заказ нельзя было бы даже обновить.
 */
export async function getOrder(no: number, signal?: AbortSignal) {
  const guest = orderToken(no);
  return request<ApiOrder>(ROUTES.order(no), { token: guest || userToken(), signal });
}

/** Отмена своего заказа, пока кухня его не приняла. */
export async function cancelOrder(no: number, signal?: AbortSignal) {
  return request<ApiOrder>(ROUTES.cancelOrder(no), { method: 'POST', token: userToken(), signal });
}

/** Занятость столиков для выбора места в зале и на террасе. */
export function getTables(signal?: AbortSignal) {
  return request<TablesState>(ROUTES.tables, { token: getToken() || null, signal });
}

/* ======================= панель персонала ======================= */

/** Вход сотрудника по логину и PIN. При успехе токен сохраняется отдельно от клиентского. */
export async function staffLogin(login: string, pin: string, signal?: AbortSignal) {
  const body: StaffLoginBody = { login: login.trim(), pin: pin.trim() };
  const reply = await request<StaffLoginReply>(ROUTES.staffLogin, { method: 'POST', body, signal });
  if (reply?.token) setStaffToken(reply.token);
  return reply;
}

/** Заказы на кухне: активные и недавно выданные, с телефонами гостей. */
export async function staffOrders(signal?: AbortSignal) {
  const reply = await request<{ orders: ApiOrder[] }>(ROUTES.staffOrders, { token: staffToken(), signal });
  return unwrap<ApiOrder[]>(reply, 'orders', Array.isArray);
}

/** Заказ по телефонному звонку, внесённый персоналом. */
export async function staffCreateOrder(body: StaffOrderBody, signal?: AbortSignal) {
  const payload: StaffOrderBody = { ...body, phone: phoneDigits10(body.phone), sum: Math.round(body.sum) };
  const reply = await request<{ order: ApiOrder }>(ROUTES.staffOrders, { method: 'POST', body: payload, token: staffToken(), signal });
  return unwrap<ApiOrder>(reply, 'order', isObject);
}

/** Принять заказ и назвать время готовности, минут (10, 15, 20 или 30). */
export async function staffAccept(no: number, eta: number, signal?: AbortSignal) {
  const reply = await request<{ order: ApiOrder }>(ROUTES.staffAccept(no), { method: 'POST', body: { eta }, token: staffToken(), signal });
  return unwrap<ApiOrder>(reply, 'order', isObject);
}

/** Перевод заказа в следующий статус. */
export async function staffStatus(no: number, status: OrderStatus, signal?: AbortSignal) {
  const reply = await request<{ order: ApiOrder }>(ROUTES.staffStatus(no), { method: 'POST', body: { status }, token: staffToken(), signal });
  return unwrap<ApiOrder>(reply, 'order', isObject);
}

/** Сдвинуть обещанное время готовности («+5 мин»), пока заказ не готов. */
export async function staffEta(no: number, eta: number, signal?: AbortSignal) {
  const reply = await request<{ order: ApiOrder }>(ROUTES.staffEta(no), { method: 'POST', body: { eta }, token: staffToken(), signal });
  return unwrap<ApiOrder>(reply, 'order', isObject);
}

/** Столики глазами персонала. */
export async function staffTables(signal?: AbortSignal) {
  const reply = await request<{ tables: TablesState }>(ROUTES.staffTables, { token: staffToken(), signal });
  return unwrap<TablesState>(reply, 'tables', isObject);
}

/** Занять или освободить столик вручную; возвращается новое состояние зала. */
export async function staffToggleTable(n: number, signal?: AbortSignal) {
  const reply = await request<{ n: number; occupied: boolean; tables: TablesState }>(
    ROUTES.staffToggleTable(n), { method: 'POST', token: staffToken(), signal },
  );
  return unwrap<TablesState>(reply, 'tables', isObject);
}

/** Все методы одним объектом — удобно передавать в стор. */
export const api = {
  requestCode, verifyCode, me, updateMe, deleteMe, exportMyData,
  createOrder, myOrders, getOrder, cancelOrder, getTables,
  staffLogin, staffOrders, staffCreateOrder, staffAccept, staffStatus, staffEta,
  staffTables, staffToggleTable,
};
