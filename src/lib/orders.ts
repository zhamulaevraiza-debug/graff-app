/**
 * Модель заказа и чистая логика статусов — перенесено из прототипа (design/GRAFF App.dc.html).
 * Статусы: new → accepted → cooking → ready → done.
 * Время: eta (мин) считается от acceptedAt; speed — ускорение демо-таймера (1 = реальное время, 12 = «1 мин = 5 с»).
 */
import {
  ITEMS, SAUCES, ZONES, FORMAT_NAME, STATUS_TEXT, STEP_IDX, PAY_TEXT, ICON, C, portionOf,
  type Format, type PaymentId, type OrderStatus,
} from '../data/menu';
import { rub, fmtTime } from './format';

export interface Line {
  key: string;
  itemId?: string;
  name: string;
  sauceNames: string[];
  unit: number;
  qty: number;
  /** масса/объём порции на момент заказа — часть подтверждения предварительного заказа */
  portion?: string;
}

export interface Order {
  no: number;
  createdAt: number;
  status: OrderStatus;
  format: Format;
  table: number | null;
  pickup?: 'asap' | 'time';
  pickupLabel?: string;
  payment: PaymentId;
  lines: Line[];
  comment?: string;
  total: number;
  name: string;
  phone: string;
  /** заказ текущего пользователя этого устройства (виден в «Заказ» и истории) */
  mine: boolean;
  /** кухня-автопилот ведёт статусы сама (демо без персонала) */
  auto: boolean;
  /** выбранное персоналом время до принятия */
  pendingEta: number;
  eta?: number;
  acceptedAt?: number;
  readyAt?: number;
  doneAt?: number;
  byPhone?: boolean;
}

export type Occupied = Record<number, boolean>;
export interface ToastMsg { title: string; text: string }

export const orderTotal = (lines: Line[]) => lines.reduce((a, l) => a + l.unit * l.qty, 0);

export function mkLine(itemId: string, sizeIdx: number, qty: number, sauceIds: string[] = []): Line {
  const it = ITEMS[itemId];
  const z = it.sizes[sizeIdx] || it.sizes[0];
  const ids = sauceIds.slice().sort();
  const sauces = ids.map(id => SAUCES.find(s => s.id === id)!).filter(Boolean);
  const unit = z.p + sauces.reduce((a, s) => a + s.p, 0);
  const groupNote = it.group && it.catId === 'burgers' ? ' (' + it.group.toLowerCase().replace(/ые$/, 'ый') + ')' : '';
  return {
    key: itemId + '|' + sizeIdx + '|' + ids.join(','),
    itemId,
    name: it.name + (it.hasSizes ? ' · ' + z.l : '') + groupNote,
    sauceNames: sauces.map(s => s.name),
    unit,
    qty,
    portion: portionOf(itemId, sizeIdx) || undefined,
  };
}

/** Объединяет строки корзины с одинаковым ключом. */
export function mergeLines(cart: Line[], lines: Line[]): Line[] {
  const out = cart.map(l => ({ ...l }));
  lines.forEach(l => { const ex = out.find(x => x.key === l.key); if (ex) ex.qty += l.qty; else out.push({ ...l }); });
  return out;
}

export const zoneName = (f: Format) => (f === 'hall' ? 'Зал' : 'Терраса');

export function formatText(o: Pick<Order, 'format' | 'table' | 'pickup' | 'pickupLabel'>): string {
  if (o.format === 'togo') return 'С собой' + (o.pickup === 'time' && o.pickupLabel ? ' · к ' + o.pickupLabel : '');
  return o.table ? `Столик ${o.table} · ${zoneName(o.format)}` : `${zoneName(o.format)} · столик назначит персонал`;
}

export function freeTable(format: Format, occ: Occupied): number | null {
  const z = ZONES.find(z => z.id === format);
  return z ? (z.tables.find(n => !occ[n]) ?? null) : null;
}

export function minutesLeft(o: Order, now: number, speed: number): number {
  if (!o.acceptedAt) return o.eta || 0;
  return Math.max(0, Math.ceil(((o.eta || 0) * 60000 - (now - o.acceptedAt) * speed) / 60000));
}

/** Перевод заказа в статус. Возвращает новый заказ, занятость столиков и push для клиента (если заказ его). */
export function transition(o: Order, status: OrderStatus, occ: Occupied, now: number, extra?: Partial<Order>): { order: Order; occ: Occupied; toast?: ToastMsg } {
  const n: Order = { ...o, status, ...(extra || {}) };
  let toast: ToastMsg | undefined;
  if (status === 'accepted') {
    n.acceptedAt = now;
    n.eta = n.eta || 15;
    if (n.format !== 'togo' && !n.table) {
      const t = freeTable(n.format, occ);
      if (t) { n.table = t; occ = { ...occ, [t]: true }; }
    }
    if (n.mine) toast = { title: 'Заказ принят!', text: `№${n.no} · готовим ~${n.eta} мин` + (n.table ? ` · столик ${n.table}` : '') };
  }
  if (status === 'ready') {
    n.readyAt = now;
    if (n.mine) toast = { title: `Ваш заказ №${n.no} готов!`, text: n.format === 'togo' ? 'Подойдите к стойке' : `Столик ${n.table}` };
  }
  if (status === 'done') {
    n.doneAt = now;
    if (n.table) occ = { ...occ, [n.table]: false };
  }
  return { order: n, occ, toast };
}

/** Один тик кухни-автопилота: ведёт заказы с auto=true по статусам. */
export function kitchenTick(orders: Order[], occ: Occupied, now: number, speed: number): { orders: Order[]; occ: Occupied; changed: boolean; toasts: ToastMsg[] } {
  let changed = false;
  const toasts: ToastMsg[] = [];
  const out = orders.map(o => {
    if (!o.auto || o.status === 'done' || o.status === 'cancelled') return o;
    let next: [OrderStatus, Partial<Order>?] | null = null;
    if (o.status === 'new' && now - o.createdAt > 4000) next = ['accepted', { eta: 12 }];
    else if (o.status === 'accepted' || o.status === 'cooking') {
      const el = (now - (o.acceptedAt || now)) * speed, tot = (o.eta || 15) * 60000;
      if (o.status === 'accepted' && el > tot * 0.2) next = ['cooking'];
      else if (o.status === 'cooking' && el >= tot) next = ['ready'];
    } else if (o.status === 'ready' && now - (o.readyAt || now) > 90000) next = ['done'];
    if (!next) return o;
    changed = true;
    const r = transition(o, next[0], occ, now, next[1]);
    occ = r.occ;
    if (r.toast) toasts.push(r.toast);
    return r.order;
  });
  return { orders: out, occ, changed, toasts };
}

export interface StepView { name: string; icon: string; bg: string; fg: string; border: string; anim: string; textColor: string; weight: number; current: boolean; done: boolean }
export interface OrderView {
  no: number; status: OrderStatus; statusText: string; formatLabel: string;
  ringColor: string; ringOffset: string; progress: number; ringTop: string; ringMain: string; ringSub: string;
  headline: string; steps: StepView[];
  lines: { qtyName: string; sumLabel: string }[];
  formatText: string; payText: string; totalLabel: string;
  minutesShort: string; subline: string; where: string; left: number;
}

export const RING_LEN = 603.2; // 2πr, r = 96

/** Вью-модель для экрана статуса, карточки «Ваш заказ» и истории. */
export function orderView(o: Order, now: number, speed: number): OrderView {
  const left = minutesLeft(o, now, speed);
  const tot = (o.eta || 15) * 60000;
  const el = o.acceptedAt ? (now - o.acceptedAt) * speed : 0;
  const prog = o.status === 'ready' || o.status === 'done' ? 1 : (o.status === 'new' || o.status === 'cancelled' ? 0 : Math.min(1, el / tot));
  const idx = STEP_IDX[o.status];
  const color = o.status === 'ready' ? C.green : (o.status === 'done' || o.status === 'cancelled' ? C.muted : C.copper);
  const where = o.format === 'togo' ? 'Подойдите к стойке' : (o.table ? `Столик ${o.table}` : 'Столик назначит персонал');
  const etaAt = o.acceptedAt ? 'к ' + fmtTime(o.acceptedAt + tot / speed) : '';
  const ring: Record<OrderStatus, [string, string, string]> = {
    new: ['Ждём кухню', '—', 'время уточняет персонал'],
    accepted: ['Будет готов через', `~${left} мин`, etaAt],
    cooking: ['Будет готов через', `~${left} мин`, etaAt],
    ready: ['', 'Готов!', where],
    done: ['', 'Выдан', o.doneAt ? fmtTime(o.doneAt) : ''],
    cancelled: ['', 'Отменён', o.doneAt ? fmtTime(o.doneAt) : ''],
  };
  const headline: Record<OrderStatus, string> = {
    new: 'Заказ отправлен', accepted: 'Заказ принят!', cooking: 'Готовим…', ready: 'Готово — приятного аппетита!',
    done: 'Спасибо, что выбираете нас!', cancelled: 'Заказ отменён',
  };
  const steps: StepView[] = ([['Принят', ICON.check], ['Готовится', ICON.chef], ['Готов', ICON.bell], ['Выдан', ICON.hand]] as [string, string][]).map(([name, icon], i) => {
    const done = i < idx, cur = i === idx, pending = i === 0 && idx < 0, on = done || cur;
    return {
      name, icon, current: cur, done,
      bg: on ? (i >= 2 && cur ? (i === 2 ? C.green : C.muted) : C.copper) : 'transparent',
      fg: on ? '#fff' : (pending ? C.copper : C.muted),
      border: on ? 'transparent' : (pending ? C.copper : C.line),
      anim: (cur && i < 2) || pending ? 'gr-pulse 1.6s ease-in-out infinite' : 'none',
      textColor: on ? C.text : C.sec,
      weight: cur ? 700 : 400,
    };
  });
  return {
    no: o.no, status: o.status, statusText: STATUS_TEXT[o.status], formatLabel: FORMAT_NAME[o.format].toUpperCase(),
    ringColor: color, ringOffset: (RING_LEN * (1 - prog)).toFixed(1), progress: prog,
    ringTop: ring[o.status][0], ringMain: ring[o.status][1], ringSub: ring[o.status][2],
    headline: headline[o.status], steps,
    lines: o.lines.map(l => ({
      qtyName: `${l.qty} × ${l.name}` + (l.portion ? ` · ${l.portion}` : '') + (l.sauceNames && l.sauceNames.length ? ' + ' + l.sauceNames.join(', ').toLowerCase() : ''),
      sumLabel: rub(l.unit * l.qty),
    })),
    formatText: formatText(o), payText: PAY_TEXT[o.payment] || '', totalLabel: rub(o.total),
    minutesShort: o.status === 'new' ? '…' : (o.status === 'cancelled' ? '×' : (o.status === 'ready' || o.status === 'done' ? '✓' : `${left} мин`)),
    subline: o.status === 'new' ? 'Ждём подтверждения кухни'
      : o.status === 'cancelled' ? 'Заказ отменён'
      : o.status === 'ready' ? where
      : o.status === 'done' ? 'Выдан'
      : `Будет готов через ~${left} мин · ${where}`,
    where, left,
  };
}

/** Текст состава для списков (история, персонал). */
export function itemsText(o: Order, withSauces = false): string {
  return o.lines.map(l => (l.qty > 1 ? l.qty + ' × ' : '') + l.name + (withSauces && l.sauceNames && l.sauceNames.length ? ' + ' + l.sauceNames.join(', ').toLowerCase() : '')).join(', ');
}

/** Демо-данные первого запуска (как в прототипе): два заказа на кухне и два в истории клиента. */
export function seedOrders(now: number, speed: number): Order[] {
  const base: Omit<Order, 'total'>[] = [
    { no: 1245, createdAt: now - 14 * 60000, status: 'cooking', eta: 20, acceptedAt: now - (9 * 60000) / speed, format: 'hall', table: 9, lines: [mkLine('burgers-0-4', 0, 1), mkLine('drinks-0-5', 1, 2)], name: 'Аслан', phone: '+7 928 000-00-21', mine: false, auto: false, pendingEta: 15, payment: 'cash' },
    { no: 1246, createdAt: now - 4 * 60000, status: 'new', format: 'togo', table: null, lines: [mkLine('fastfood-0-0', 1, 1), mkLine('fastfood-0-6', 1, 1)], name: 'Мадина', phone: '+7 963 000-00-08', mine: false, auto: false, pendingEta: 15, byPhone: true, payment: 'cash' },
    { no: 1198, createdAt: now - 3 * 86400000, status: 'done', doneAt: now - 3 * 86400000 + 25 * 60000, format: 'terrace', table: 4, lines: [mkLine('burgers-0-0', 0, 2), mkLine('drinks-3-1', 1, 1)], name: 'Гость', phone: '', mine: true, auto: false, pendingEta: 15, payment: 'card' },
    { no: 1173, createdAt: now - 9 * 86400000, status: 'done', doneAt: now - 9 * 86400000 + 20 * 60000, format: 'togo', table: null, lines: [mkLine('fastfood-0-1', 1, 1), mkLine('tea-0-0', 1, 1)], name: 'Гость', phone: '', mine: true, auto: false, pendingEta: 15, payment: 'cash' },
  ];
  return base.map(o => ({ ...o, total: orderTotal(o.lines) }));
}
export const SEED_OCCUPIED: Occupied = { 2: true, 5: true, 9: true, 12: true };
export const SEED_NEXT_NO = 1247;
