/**
 * Модель заказа и чистая логика статусов — перенесено из прототипа (design/GRAFF App.dc.html).
 * Статусы: new → accepted → cooking → ready → done.
 * Время: eta (мин) считается от acceptedAt и идёт по-настоящему.
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
  /** выбранное персоналом время до принятия */
  pendingEta: number;
  eta?: number;
  acceptedAt?: number;
  readyAt?: number;
  doneAt?: number;
  byPhone?: boolean;
}

export type Occupied = Record<number, boolean>;
/** order — какой заказ открыть по тапу на баннер */
export interface ToastMsg { title: string; text: string; order?: number }

/**
 * Где гость получает заказ. Столик назначает персонал, и до этого момента table пуст —
 * без этой проверки в баннере и в уведомлении получалось «Столик null».
 */
export const whereText = (o: Pick<Order, 'format' | 'table'>): string =>
  o.format === 'togo' ? 'Подойдите к стойке' : (o.table ? `Столик ${o.table}` : 'Столик назначит персонал');

export const orderTotal = (lines: Line[]) => lines.reduce((a, l) => a + l.unit * l.qty, 0);

/** Заказ по звонку персонал вводит строками от руки — повторять в таком нечего. */
export const canRepeat = (o: Order): boolean => o.lines.some(l => !!l.itemId && !!ITEMS[l.itemId]);

/**
 * Пересобирает строку заказа так, как её делает корзина. У заказа с сервера ключи строк
 * другие, и без пересборки «повторить» клало бы то же блюдо в корзину второй строкой.
 */
export function relineForCart(l: Line): Line | null {
  const it = l.itemId ? ITEMS[l.itemId] : undefined;
  if (!it) return null;
  const bySize = it.hasSizes ? it.sizes.findIndex(z => l.name.includes(' · ' + z.l)) : 0;
  const ids = (l.sauceNames || [])
    .map(n => SAUCES.find(x => x.name.toLowerCase() === n.trim().toLowerCase()))
    .filter((x): x is (typeof SAUCES)[number] => !!x)
    .map(x => x.id);
  return mkLine(it.id, bySize < 0 ? 0 : bySize, l.qty, ids);
}

export function mkLine(itemId: string, sizeIdx: number, qty: number, sauceIds: string[] = []): Line {
  const it = ITEMS[itemId];
  const z = it.sizes[sizeIdx] || it.sizes[0];
  const ids = sauceIds.slice().sort();
  const sauces = ids.map(id => SAUCES.find(s => s.id === id)!).filter(Boolean);
  const unit = z.p + sauces.reduce((a, s) => a + s.p, 0);
  return {
    key: itemId + '|' + sizeIdx + '|' + ids.join(','),
    itemId,
    name: it.name + (it.hasSizes ? ' · ' + z.l : '') + it.groupNote,
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

export function minutesLeft(o: Order, now: number): number {
  if (!o.acceptedAt) return o.eta || 0;
  return Math.max(0, Math.ceil(((o.eta || 0) * 60000 - (now - o.acceptedAt)) / 60000));
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
    if (n.mine) toast = { title: 'Заказ принят!', text: `№${n.no} · готовим ~${n.eta} мин` + (n.table ? ` · столик ${n.table}` : ''), order: n.no };
  }
  if (status === 'ready') {
    n.readyAt = now;
    if (n.mine) toast = { title: `Ваш заказ №${n.no} готов!`, text: whereText(n), order: n.no };
  }
  if (status === 'done') {
    n.doneAt = now;
    if (n.table) occ = { ...occ, [n.table]: false };
  }
  return { order: n, occ, toast };
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
export function orderView(o: Order, now: number): OrderView {
  const left = minutesLeft(o, now);
  const tot = (o.eta || 15) * 60000;
  const el = o.acceptedAt ? now - o.acceptedAt : 0;
  const prog = o.status === 'ready' || o.status === 'done' ? 1 : (o.status === 'new' || o.status === 'cancelled' ? 0 : Math.min(1, el / tot));
  const idx = STEP_IDX[o.status];
  const color = o.status === 'ready' ? C.green : (o.status === 'done' || o.status === 'cancelled' ? C.muted : C.copper);
  const where = whereText(o);
  const etaAt = o.acceptedAt ? 'к ' + fmtTime(o.acceptedAt + tot) : '';
  // Время вышло, а кухня ещё не нажала «Готов»: «~0 мин» и время в прошлом выглядят как поломка.
  const overdue = left <= 0;
  const ring: Record<OrderStatus, [string, string, string]> = {
    new: ['Ждём кухню', '—', 'время уточняет персонал'],
    accepted: overdue ? ['', 'Вот-вот', 'кухня заканчивает'] : ['Будет готов через', `~${left} мин`, etaAt],
    cooking: overdue ? ['', 'Вот-вот', 'кухня заканчивает'] : ['Будет готов через', `~${left} мин`, etaAt],
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
    minutesShort: o.status === 'new' ? '…' : (o.status === 'cancelled' ? '×' : (o.status === 'ready' || o.status === 'done' ? '✓' : (overdue ? 'вот-вот' : `${left} мин`))),
    subline: o.status === 'new' ? 'Ждём подтверждения кухни'
      : o.status === 'cancelled' ? 'Заказ отменён'
      : o.status === 'ready' ? where
      : o.status === 'done' ? 'Выдан'
      : overdue ? `Кухня заканчивает · ${where}`
      : `Будет готов через ~${left} мин · ${where}`,
    where, left,
  };
}

/** Текст состава для списков (история, персонал). */
export function itemsText(o: Order, withSauces = false): string {
  return o.lines.map(l => (l.qty > 1 ? l.qty + ' × ' : '') + l.name + (withSauces && l.sauceNames && l.sauceNames.length ? ' + ' + l.sauceNames.join(', ').toLowerCase() : '')).join(', ');
}

/**
 * С какого номера начинается счёт заказов. То же значение, что и на сервере
 * (ORDER_START_NO): номера не должны разъезжаться при переходе на боевой режим.
 */
export const FIRST_ORDER_NO = 1001;
