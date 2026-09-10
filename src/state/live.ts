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
import { orderTotal, whereText } from '../lib/orders';
import type { Format, PaymentId } from '../data/menu';

/* ---------- доступ к стору ---------- */

export interface StoreAccess {
  get: () => StoreShape;
  set: (patch: Partial<StoreShape>) => void;
  /** показать баннер уведомления */
  /** order — номер заказа, который откроется по тапу на баннер */
  toast: (title: string, text: string, order?: number) => void;
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
  resendAfter: number;
  staffAuthed: boolean;
  panelTicket: string | null;
  staffSeenAt: number;
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
    // Сервер отказал в доступе: вход больше не действует (например, аккаунт удалён
    // или срок токена вышел). Показываем гостя, чтобы человек мог войти заново,
    // а не смотрел на своё имя в приложении, которое ничего не может сделать.
    if (e instanceof api.ApiError && e.status === 401 && !api.hasToken()) s.set({ user: null });
    // Сервер сказал, через сколько можно повторить (429). Без этого отсчёт на экране входа
    // обнулялся бы после отказа и кнопка «Отправить ещё раз» снова звала на бесполезный запрос.
    if (e instanceof api.ApiError && e.retryAfter) s.set({ resendAfter: Date.now() + e.retryAfter * 1000 });
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
    // pendingEta — выбор сотрудника в панели, его в ответе сервера нет: без этой строки
    // любое событие сбрасывало бы выбранное время обратно на 15 минут.
    ? state.orders.map(x => (x.no === next.no ? { ...x, ...next, pendingEta: x.pendingEta } : x))
    : [next, ...state.orders];
  s.set({ orders });

  if (!next.mine || !prev) return;
  if (prev.status !== next.status) {
    if (next.status === 'accepted') {
      s.toast('Заказ принят!', `№${next.no} · готовим ~${next.eta ?? 15} мин` + (next.table ? ` · столик ${next.table}` : ''), next.no);
    } else if (next.status === 'ready') {
      s.toast(`Ваш заказ №${next.no} готов!`, whereText(next), next.no);
    } else if (next.status === 'cancelled') {
      s.toast(`Заказ №${next.no} отменён`, 'Свяжитесь с нами, если это ошибка', next.no);
    }
  } else if (prev.eta !== next.eta && (next.status === 'accepted' || next.status === 'cooking')) {
    s.toast('Время готовности изменено', `Заказ №${next.no} будет готов через ~${next.eta} мин`, next.no);
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
  // Гость без регистрации подписывается ключом на свой заказ, выданным при оформлении.
  const guest = !staff && !api.hasToken() ? api.orderToken() : '';
  if (!api.isLive() || (!api.hasToken() && !staff && !guest)) {
    s.set({ online: false });
    return;
  }
  disconnect = connectStream({
    staff,
    token: guest || undefined,
    onOrder: applyOrder,
    onTables: applyTables,
    onState: state => s.set({ online: state === 'online' }),
    // Сервер больше не признаёт ключ: смена кончилась, аккаунт удалён, срок вышел.
    // Молчать нельзя — человек видел бы своё имя в приложении, которое ничего не может.
    onAuthLost: () => {
      s.set({ online: false });
      if (staff) {
        api.clearStaffToken();
        s.set({ staffAuthed: false, netError: 'Смена закончилась, войдите в панель заново' });
      } else if (guest) {
        api.clearOrderToken();
      } else {
        api.clearToken();
        s.set({ user: null, netError: 'Вход больше не действует, войдите заново' });
      }
    },
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

  // Профиль без токена в боевом режиме означает, что вход уже недействителен
  // (например, аккаунт удалён на другом устройстве). Показываем гостя.
  if (!api.hasToken() && s.get().user) s.set({ user: null });

  if (api.hasToken()) {
    try {
      const user = await api.me();
      s.set({ user: { name: user.name, phone: user.phone }, marketingConsent: user.marketingConsent });
      const list = await api.myOrders().catch(() => undefined);
      if (list) s.set({ orders: list.map(fromApi) });
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 401) {
        // Сервер не признаёт вход: срок токена вышел или аккаунт удалён.
        api.clearToken();
        s.set({ user: null });
      }
      // Нет связи — профиль и вход сохраняем: интернет вернётся, а заказы
      // с устройства всё это время видны. Выкидывать человека из аккаунта нельзя.
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
  s.set({ loginStep: 'code', codeInput: '', resendAfter: 0 });
  // в режиме проверки без SMS сервер возвращает код, чтобы можно было войти
  if (reply.devCode) s.toast('Код для входа', reply.devCode);
  return true;
}

/** Проверка кода. Возвращает true, если вход состоялся. */
export async function confirmCode(): Promise<boolean> {
  const s = store();
  const st = s.get();
  // Отметку «Акции и новинки» гость ставит или снимает до входа — отправляем её вместе с кодом,
  // иначе сервер о выборе не узнает и снятая отметка молча включилась бы обратно.
  const reply = await run(() => api.verifyCode(st.phoneInput, st.codeInput, st.nameInput || undefined, st.marketingConsent));
  if (!reply) return false;
  const marketing = reply.user.marketingConsent;

  const named = reply.user.name.trim().length > 0;
  s.set({
    user: { name: reply.user.name, phone: reply.user.phone },
    marketingConsent: marketing,
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
  api.clearOrderToken();
  stopStream();
  store().set({ user: null, orders: [], viewOrder: null });
}

/** Удаление аккаунта на сервере. false — сервер отказал: стирать данные на устройстве нельзя. */
export async function deleteAccount(): Promise<boolean> {
  const done = await run(() => api.deleteMe());
  if (done === undefined) return false;
  api.clearOrderToken();
  stopStream();
  return true;
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

  const body: api.CreateOrderBody = {
    consent: true,
    format: st.format,
    table: st.format === 'togo' ? null : st.table,
    pickup: st.format === 'togo' ? st.pickup : undefined,
    pickupLabel: st.format === 'togo' && st.pickup === 'time' && st.pickupTime > Date.now() ? pickupLabel(st.pickupTime) : undefined,
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
  };

  s.set({ busy: true, netError: null });
  let order: api.CreatedOrder | undefined;
  try {
    order = await api.createOrder(body);
  } catch (e) {
    s.set({ busy: false });
    // Ответа не дождались: заказ мог дойти до кухни. Повторная отправка сделала бы второй
    // такой же заказ, поэтому сначала спрашиваем сервер, появился ли он.
    if (e instanceof api.ApiError && e.maybeSent) {
      const found = await findJustPlaced(orderTotal(st.cart));
      if (!found) {
        s.set({ netError: 'Ответ от сервера не пришёл. Проверьте вкладку «Заказ»: если заказа там нет, оформите ещё раз или позвоните нам' });
        return undefined;
      }
      order = found;
    } else {
      if (e instanceof api.ApiError && e.status === 401 && !api.hasToken()) s.set({ user: null });
      s.set({ netError: errorText(e) });
      return undefined;
    }
  }
  s.set({ busy: false });

  // Гостю без входа сервер выдал ключ на этот заказ: только по нему он и увидит,
  // что заказ приняли и приготовили.
  if (order.orderToken) api.setOrderToken(order.no, order.orderToken);

  applyOrder({ ...order, mine: true });
  s.set({
    cart: [], comment: '', screen: 'status', viewOrder: order.no,
    table: 'any', pickup: 'asap', pickupTime: 0,
  });
  // после заказа стол занят — обновим схему
  void api.getTables().then(applyTables).catch(() => undefined);
  reconnect();
  return order.no;
}

/**
 * Заказ мог быть создан, пока пропадала связь. Ищем его среди своих: у вошедшего —
 * в истории, у гостя — по ключу на заказ. Ничего не нашли — значит, отправлять заново безопасно.
 */
async function findJustPlaced(total: number): Promise<api.ApiOrder | undefined> {
  const since = Date.now() - 5 * 60_000;
  if (api.hasToken()) {
    const list = await api.myOrders().catch(() => undefined);
    return list?.find(o => o.createdAt >= since && o.total === total);
  }
  const no = api.watchedOrderNo();
  if (no == null) return undefined;
  const found = await api.getOrder(no).catch(() => undefined);
  return found && found.createdAt >= since && found.total === total ? found : undefined;
}

/** Подпись выбранного времени самовывоза: «14:30». В pickupTime лежит метка времени слота. */
function pickupLabel(ts: number): string {
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

/** Первый шаг: код заведения. Пропуск кладём в стор — с ним принимается вход сотрудника. */
export async function staffPanelCode(code: string): Promise<boolean> {
  const s = store();
  const reply = await run(() => api.staffPanel(code));
  if (!reply) return false;
  s.set({ panelTicket: reply.ticket });
  return true;
}

/** Второй шаг: номер сотрудника и его PIN. Без пропуска сервер даже не проверяет PIN. */
export async function staffLogin(login: string, pin: string): Promise<boolean> {
  const s = store();
  const ticket = s.get().panelTicket;
  if (!ticket) {
    s.set({ netError: 'Сначала введите код заведения' });
    return false;
  }
  const reply = await run(() => api.staffLogin(login, pin, ticket));
  if (!reply) return false;
  s.set({ staffAuthed: true, staffSeenAt: Date.now() });
  await loadStaffOrders();
  reconnect();
  return true;
}

export async function staffLogout(): Promise<void> {
  const s = store();
  api.clearStaffToken();
  s.set({ staffAuthed: false, orders: [] });
  reconnect();
  // На этом же устройстве мог быть вошедший гость: возвращаем ему его заказы,
  // иначе после выхода из панели он видел бы пустую историю.
  if (api.hasToken()) {
    const list = await api.myOrders().catch(() => undefined);
    if (list) s.set({ orders: list.map(fromApi) });
  }
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
