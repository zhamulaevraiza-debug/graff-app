/**
 * Боевой режим: работа приложения через сервер кафе.
 *
 * Здесь собрано всё, что отличает настоящую работу от демонстрации: вход по коду из SMS,
 * отправка заказа на кухню, живые статусы через поток событий, панель персонала.
 * Стор вызывает эти функции, когда включён боевой режим (адрес сервера задан при сборке).
 *
 * Файл не импортирует стор напрямую, чтобы не возникало кольцевой зависимости:
 * стор сам передаёт сюда доступ через bindStore при создании.
 */
import * as api from '../lib/api';
import { connectStream } from '../lib/realtime';
import type { ApiOrder, TablesState } from '../lib/api';
import type { Line, Order } from '../lib/orders';
import { orderTotal } from '../lib/orders';
import type { Format, PaymentId } from '../data/menu';

/* ---------- доступ к стору ---------- */

export interface StoreAccess {
  get: () => StoreShape;
  set: (patch: Partial<StoreShape>) => void;
  /** показать баннер уведомления */
  toast: (title: string, text: string) => void;
}

/** Та часть стора, которая нужна боевому слою (полный тип живёт в store.ts). */
interface StoreShape {
  user: { name: string; phone: string } | null;
  orders: Order[];
  occupied: Record<number, boolean>;
  cart: Line[];
  comment: string;
  format: Format;
  table: number | 'any';
  pickup: 'asap' | 'time';
  pickupTime: number;
  payment: PaymentId;
  guestName: string;
  guestPhone: string;
  phoneInput: string;
  codeInput: string;
  nameInput: string;
  loginStep: 'phone' | 'code' | 'name';
  marketingConsent: boolean;
  screen: string;
  viewOrder: number | null;
  netError: string | null;
  busy: boolean;
  online: boolean;
  staffAuthed: boolean;
}

let ref: StoreAccess | null = null;
export const bindStore = (r: StoreAccess) => { ref = r; };
const store = () => {
  if (!ref) throw new Error('Стор ещё не подключён к боевому слою');
  return ref;
};

/* ---------- перевод заказа с сервера в модель приложения ---------- */

export function fromApi(o: ApiOrder): Order {
  return {
    no: o.no,
    createdAt: o.createdAt,
    status: o.status,
    format: o.format,
    table: o.table,
    pickup: o.pickup,
    pickupLabel: o.pickupLabel,
    payment: o.payment,
    lines: o.lines.map((l, i) => ({
      key: `${l.itemId ?? 'manual'}|${i}`,
      itemId: l.itemId,
      name: l.name,
      portion: l.portion,
      sauceNames: l.sauceNames ?? [],
      unit: l.unit,
      qty: l.qty,
    })),
    comment: o.comment,
    total: o.total,
    name: o.name,
    phone: o.phone ?? '',
    mine: o.mine ?? false,
    // статусы ведёт кухня, автопилот в боевом режиме не нужен
    auto: false,
    pendingEta: o.eta ?? 15,
    eta: o.eta,
    acceptedAt: o.acceptedAt,
    readyAt: o.readyAt,
    doneAt: o.doneAt,
    byPhone: o.byPhone,
  };
}

/** Текст ошибки для показа гостю: у ошибок сервера он уже человеческий. */
export function errorText(e: unknown): string {
  if (e instanceof api.ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return 'Не удалось связаться с сервером кафе';
}

/** Выполняет запрос, показывая занятость и ошибку. Возвращает undefined при неудаче. */
async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
  const s = store();
  s.set({ busy: true, netError: null });
  try {
    return await fn();
  } catch (e) {
    s.set({ netError: errorText(e) });
    return undefined;
  } finally {
    s.set({ busy: false });
  }
}

/* ---------- заказы в состоянии ---------- */

/** Кладёт заказ с сервера в список, заменяя прежнюю версию, и показывает баннер об изменении статуса. */
export function applyOrder(o: ApiOrder) {
  const s = store();
  const state = s.get();
  const next = fromApi(o);
  const prev = state.orders.find(x => x.no === next.no);
  const orders = prev
    ? state.orders.map(x => (x.no === next.no ? { ...x, ...next } : x))
    : [next, ...state.orders];
  s.set({ orders });

  if (!next.mine || !prev) return;
  if (prev.status !== next.status) {
    if (next.status === 'accepted') {
      s.toast('Заказ принят!', `№${next.no} · готовим ~${next.eta ?? 15} мин` + (next.table ? ` · столик ${next.table}` : ''));
    } else if (next.status === 'ready') {
      s.toast(`Ваш заказ №${next.no} готов!`, next.format === 'togo' ? 'Подойдите к стойке' : `Столик ${next.table}`);
    } else if (next.status === 'cancelled') {
      s.toast(`Заказ №${next.no} отменён`, 'Свяжитесь с нами, если это ошибка');
    }
  } else if (prev.eta !== next.eta && (next.status === 'accepted' || next.status === 'cooking')) {
    s.toast('Время готовности изменено', `Заказ №${next.no} будет готов через ~${next.eta} мин`);
  }
}

function applyTables(t: TablesState) {
  store().set({ occupied: t.occupied });
}

/* ---------- поток живых обновлений ---------- */

let disconnect: (() => void) | null = null;

/** Открывает поток заново под текущую роль: гость или кухня. */
export function reconnect() {
  disconnect?.();
  disconnect = null;
  const s = store();
  const staff = s.get().staffAuthed && api.hasStaffToken();
  if (!api.isLive() || (!api.hasToken() && !staff)) {
    s.set({ online: false });
    return;
  }
  disconnect = connectStream({
    staff,
    onOrder: applyOrder,
    onTables: applyTables,
    onState: state => s.set({ online: state === 'online' }),
  });
}

export function stopStream() {
  disconnect?.();
  disconnect = null;
  store().set({ online: false });
}

/* ---------- запуск ---------- */

/** Загружает всё нужное при старте приложения: профиль, свои заказы, столики, поток. */
export async function bootstrap() {
  const s = store();
  if (!api.isLive()) return;

  const tables = await api.getTables().catch(() => undefined);
  if (tables) applyTables(tables);

  if (api.hasToken()) {
    const user = await api.me().catch(() => undefined);
    if (user) {
      s.set({ user: { name: user.name, phone: user.phone }, marketingConsent: user.marketingConsent });
      const list = await api.myOrders().catch(() => undefined);
      if (list) s.set({ orders: list.map(fromApi) });
    } else {
      // токен протух — возвращаем гостя ко входу, данные не теряем
      api.clearToken();
      s.set({ user: null });
    }
  }

  if (s.get().staffAuthed && api.hasStaffToken()) await loadStaffOrders();
  reconnect();
}

/* ---------- вход клиента ---------- */

/** Запрос кода из SMS. Возвращает true, если код отправлен. */
export async function sendCode(): Promise<boolean> {
  const s = store();
  const st = s.get();
  const reply = await run(() => api.requestCode(st.phoneInput, st.marketingConsent));
  if (!reply) return false;
  s.set({ loginStep: 'code', codeInput: '' });
  // в режиме проверки без SMS сервер возвращает код, чтобы можно было войти
  if (reply.devCode) s.toast('Код для входа', reply.devCode);
  return true;
}

/** Проверка кода. Возвращает true, если вход состоялся. */
export async function confirmCode(): Promise<boolean> {
  const s = store();
  const st = s.get();
  const reply = await run(() => api.verifyCode(st.phoneInput, st.codeInput, st.nameInput || undefined));
  if (!reply) return false;
  const named = reply.user.name.trim().length > 0;
  s.set({
    user: { name: reply.user.name, phone: reply.user.phone },
    marketingConsent: reply.user.marketingConsent,
    // имя ещё не известно — спросим на следующем шаге
    loginStep: named ? 'phone' : 'name',
    screen: named ? 'home' : 'splash',
    codeInput: '',
  });
  await bootstrap();
  return true;
}

/** Сохранение имени после первого входа. */
export async function saveName(): Promise<boolean> {
  const s = store();
  const name = s.get().nameInput.trim() || 'Гость';
  const user = await run(() => api.updateMe({ name }));
  if (!user) return false;
  s.set({ user: { name: user.name, phone: user.phone }, screen: 'home', loginStep: 'phone', nameInput: '' });
  return true;
}

export function logout() {
  api.clearToken();
  stopStream();
  store().set({ user: null, orders: [], viewOrder: null });
}

export async function deleteAccount(): Promise<boolean> {
  const done = await run(() => api.deleteMe());
  stopStream();
  return done !== undefined;
}

export async function setMarketing(accepted: boolean): Promise<void> {
  if (!api.hasToken()) return;
  await run(() => api.updateMe({ marketing: accepted }));
}

/* ---------- заказ ---------- */

/** Отправляет корзину на сервер. Возвращает номер заказа или undefined. */
export async function placeOrder(): Promise<number | undefined> {
  const s = store();
  const st = s.get();
  if (!st.cart.length) return undefined;

  const order = await run(() => api.createOrder({
    consent: true,
    format: st.format,
    table: st.format === 'togo' ? null : st.table,
    pickup: st.format === 'togo' ? st.pickup : undefined,
    pickupLabel: st.format === 'togo' && st.pickup === 'time' ? pickupLabel(st.pickupTime) : undefined,
    payment: st.payment,
    comment: st.comment.trim() || undefined,
    lines: st.cart.map(l => ({
      itemId: l.itemId,
      name: l.name,
      portion: l.portion,
      sauceNames: l.sauceNames,
      unit: l.unit,
      qty: l.qty,
    })),
    name: st.user ? undefined : st.guestName.trim() || 'Гость',
    phone: st.user ? undefined : st.guestPhone,
  }));
  if (!order) return undefined;

  applyOrder({ ...order, mine: true });
  s.set({ cart: [], comment: '', screen: 'status', viewOrder: order.no, table: 'any' });
  // после заказа стол занят — обновим схему
  void api.getTables().then(applyTables).catch(() => undefined);
  if (!api.hasToken()) return order.no;
  reconnect();
  return order.no;
}

/** Подпись выбранного времени самовывоза: «14:30». */
function pickupLabel(slot: number): string {
  const ts = Math.ceil(Date.now() / 900000) * 900000 + slot * 900000;
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export async function cancelOrder(no: number): Promise<void> {
  const order = await run(() => api.cancelOrder(no));
  if (order) applyOrder(order);
}

/** Сумма корзины считается и на сервере; здесь — только для показа. */
export const cartTotal = (cart: Line[]) => orderTotal(cart);

/* ---------- панель персонала ---------- */

export async function staffLogin(login: string, pin: string): Promise<boolean> {
  const s = store();
  const reply = await run(() => api.staffLogin(login, pin));
  if (!reply) return false;
  s.set({ staffAuthed: true });
  await loadStaffOrders();
  reconnect();
  return true;
}

export function staffLogout() {
  api.clearStaffToken();
  store().set({ staffAuthed: false, orders: [] });
  reconnect();
}

export async function loadStaffOrders(): Promise<void> {
  const s = store();
  const list = await api.staffOrders().catch(e => {
    // истёкшая смена: просим войти заново, а не показываем пустой экран
    if (e instanceof api.ApiError && e.status === 401) s.set({ staffAuthed: false });
    return undefined;
  });
  if (list) s.set({ orders: list.map(fromApi) });
  const tables = await api.staffTables().catch(() => undefined);
  if (tables) applyTables(tables);
}

export async function staffAccept(no: number, eta: number): Promise<void> {
  const order = await run(() => api.staffAccept(no, eta));
  if (order) applyOrder(order);
}

export async function staffStatus(no: number, status: Order['status']): Promise<void> {
  const order = await run(() => api.staffStatus(no, status));
  if (order) applyOrder(order);
}

export async function staffEta(no: number, eta: number): Promise<void> {
  const order = await run(() => api.staffEta(no, eta));
  if (order) applyOrder(order);
}

export async function staffToggleTable(n: number): Promise<void> {
  const tables = await run(() => api.staffToggleTable(n));
  if (tables) applyTables(tables);
}

export async function staffCreateOrder(phone: string, text: string, format: Format, sum: number): Promise<boolean> {
  const order = await run(() => api.staffCreateOrder({ phone, text, format, sum }));
  if (!order) return false;
  applyOrder(order);
  return true;
}
