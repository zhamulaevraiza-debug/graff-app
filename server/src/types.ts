/**
 * Контракт API. Эти же типы использует приложение (src/lib/api.ts),
 * поэтому менять их надо в двух местах согласованно.
 */

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
  /** телефон в маске: показывается только персоналу */
  phone?: string;
  /** заказ принадлежит текущему пользователю */
  mine?: boolean;
  /** заказ внесён персоналом по телефонному звонку */
  byPhone?: boolean;
}

export interface ApiUser {
  id: string;
  name: string;
  phone: string;
  marketingConsent: boolean;
}

/* ---------- запросы ---------- */

export interface RequestCodeBody {
  phone: string;
  /** согласие на обработку персональных данных: без него код не отправляем */
  consent: true;
  /** согласие на рекламу — отдельное и необязательное */
  marketing?: boolean;
}
export interface RequestCodeReply {
  ok: true;
  /** сколько секунд ждать до повторной отправки */
  retryAfter: number;
  /** в режиме провайдера «log» код возвращается, чтобы можно было проверить работу без SMS */
  devCode?: string;
}

export interface VerifyCodeBody {
  phone: string;
  code: string;
  name?: string;
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

/** События, которые сервер шлёт в поток (SSE). */
export type StreamEvent =
  | { type: 'order'; order: ApiOrder }
  | { type: 'tables'; tables: TablesState }
  | { type: 'ping' };

export interface ApiError {
  error: string;
  message: string;
}
