/**
 * Состояние приложения (zustand + persist в localStorage).
 * Логика перенесена из класса Component прототипа (design/GRAFF App.dc.html).
 *
 * Бэкенда пока нет: клиент и панель персонала работают с одним локальным состоянием.
 * Между вкладками одного браузера состояние синхронизируется через событие `storage`
 * (см. App.tsx) — так панель персонала в соседней вкладке двигает статус заказа у клиента.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { ITEMS, SAUCES, type Format, type PaymentId, type OrderStatus } from '../data/menu';
import { formatPhone, isPhoneComplete, phoneKey, fmtTime } from '../lib/format';
import { LEGAL_VERSION, type LegalDocId } from '../data/legal';
import { DEMO_PANEL_CODE, DEMO_STAFF, STAFF_IDLE_MINUTES } from '../data/staff';
import * as api from '../lib/api';
import * as live from './live';
import {
  mkLine, mergeLines, orderTotal, transition, minutesLeft, canRepeat, relineForCart, FIRST_ORDER_NO,
  type Line, type Order, type Occupied, type ToastMsg,
} from '../lib/orders';

export type Screen = 'splash' | 'home' | 'menu' | 'dish' | 'cart' | 'status' | 'profile' | 'about' | 'legal' | 'staff';
export const SCREENS: Screen[] = ['splash', 'home', 'menu', 'dish', 'cart', 'status', 'profile', 'about', 'legal', 'staff'];
/** экраны с нижней навигацией */
export const NAV_SCREENS: Screen[] = ['home', 'menu', 'cart', 'status', 'profile', 'about', 'legal'];
export type LoginStep = 'phone' | 'code' | 'name';
export type ProfileSub = null | 'orders' | 'favs';
export type StaffTab = 'orders' | 'tables';
export type HeaderStyle = 'plate' | 'script';
export interface Settings {
  /** push-баннеры внутри приложения */
  pushBanners: boolean;
  /** заголовки экранов: плашка (иконка + ЗАГЛАВНЫЕ) или рукописный медный */
  headerStyle: HeaderStyle;
  /** два круглых фото по краям шапки на главной */
  heroPhotos: boolean;
}
export interface User { name: string; phone: string }
export interface Toast extends ToastMsg { id: number; target: Screen }
export interface StaffForm { phone: string; text: string; format: Format; sum: string }

/**
 * Боевой режим включается адресом сервера в переменной сборки VITE_API_URL.
 * Без сервера приложение работает как демонстрация: заказы живут на устройстве,
 * а статусы двигает персонал через панель кухни — так же, как это будет на сервере.
 */
export const LIVE = api.isLive();

export const DEFAULT_SETTINGS: Settings = {
  pushBanners: true,
  headerStyle: 'plate',
  heroPhotos: true,
};

export interface AppState {
  // навигация
  screen: Screen;
  profileSub: ProfileSub;
  staffTab: StaffTab;
  /** категория, к которой надо прокрутить меню при открытии (одноразово) */
  menuJump: string | null;
  // вход
  user: User | null;
  loginStep: LoginStep;
  phoneInput: string;
  codeInput: string;
  nameInput: string;
  phoneErr: boolean;
  // меню / блюдо
  cat: string;
  dishId: string | null;
  dishSize: number;
  dishSauces: Record<string, boolean>;
  dishQty: number;
  dishFrom: Screen;
  // корзина / оформление
  cart: Line[];
  comment: string;
  format: Format;
  table: number | 'any';
  pickup: 'asap' | 'time';
  /** выбранное время самовывоза — метка времени слота; 0, пока время не выбрано */
  pickupTime: number;
  payment: PaymentId;
  guestName: string;
  guestPhone: string;
  // заказы и столики
  orders: Order[];
  nextNo: number;
  occupied: Occupied;
  viewOrder: number | null;
  // профиль
  favorites: Record<string, boolean>;
  favFormat: Format;
  notifOn: boolean;
  /** согласие на обработку персональных данных: когда дано и на какую редакцию документов (152-ФЗ) */
  consentAt: number | null;
  consentVersion: string | null;
  /** отдельное согласие на рекламные рассылки (ФЗ «О рекламе», ст. 18) — по умолчанию выключено */
  marketingConsent: boolean;
  /** когда дано рекламное согласие — бремя доказывания согласия лежит на кафе */
  marketingConsentAt: number | null;
  /** открытый правовой документ; null — список документов */
  legalDoc: LegalDocId | null;
  /**
   * Когда гость закрыл уведомление о данных на устройстве; null — ещё не показывали.
   * Показывается один раз: приложение не пишет на устройство ничего сверх необходимого,
   * но человек должен знать, что там хранится (152-ФЗ, ст. 14).
   */
  storageNoticeAt: number | null;
  // персонал
  staffForm: StaffForm | null;
  // ui
  toast: Toast | null;
  now: number;
  settings: Settings;
  // связь с сервером (боевой режим)
  /** текст последней ошибки сервера или связи */
  netError: string | null;
  /** идёт запрос: кнопки блокируются, чтобы не отправить заказ дважды */
  busy: boolean;
  /** открыт поток живых обновлений */
  online: boolean;
  /** сервер отказал в повторной отправке кода до этого времени (мс); 0 — ограничения нет */
  resendAfter: number;
  /** пропуск за код заведения — первый шаг входа в панель; null — код ещё не введён */
  panelTicket: string | null;
  /** последнее действие в панели: по нему она закрывается сама, если её забыли открытой */
  staffSeenAt: number;
  /** сотрудник вошёл в панель */
  staffAuthed: boolean;
}

export interface AppActions {
  go: (screen: Screen) => void;
  setProfileSub: (sub: ProfileSub) => void;
  setStaffTab: (tab: StaffTab) => void;
  // вход
  setPhoneInput: (v: string) => void;
  setCodeInput: (v: string) => void;
  setNameInput: (v: string) => void;
  sendCode: () => void;
  backToPhone: () => void;
  confirmCode: () => void;
  finishLogin: () => void;
  skipLogin: () => void;
  logout: () => void;
  // меню / блюдо
  selectCat: (id: string) => void;
  openCat: (id: string) => void;
  clearMenuJump: () => void;
  openDish: (id: string, sizeIdx?: number, from?: Screen) => void;
  dishBack: () => void;
  dishInc: () => void;
  dishDec: () => void;
  setDishSize: (i: number) => void;
  toggleDishSauce: (id: string) => void;
  toggleFav: (id?: string) => void;
  addToCart: () => void;
  // корзина
  changeLine: (key: string, d: number) => void;
  setComment: (v: string) => void;
  pickFormat: (f: Format) => void;
  pickTable: (n: number, zone: Format) => void;
  pickAnyTable: () => void;
  pickAsap: () => void;
  /** ts — метка времени выбранного слота */
  pickSlot: (ts: number) => void;
  setPayment: (p: PaymentId) => void;
  setGuestName: (v: string) => void;
  setGuestPhone: (v: string) => void;
  placeOrder: () => boolean;
  repeatOrder: (no: number) => void;
  // статус
  viewOrderNo: (no: number | null) => void;
  openActive: () => void;
  // профиль
  cycleFavFormat: () => void;
  toggleNotif: () => void;
  // правовое
  setConsent: (accepted: boolean) => void;
  setMarketing: (accepted: boolean) => void;
  openLegal: (doc: LegalDocId | null) => void;
  /** «Понятно» под уведомлением о данных на устройстве */
  dismissStorageNotice: () => void;
  deleteAccount: () => Promise<void>;
  // персонал
  toggleStaffForm: () => void;
  setStaffForm: (patch: Partial<StaffForm>) => void;
  submitStaffForm: () => void;
  staffAccept: (no: number) => void;
  setPending: (no: number, m: number) => void;
  setStatus: (no: number, status: OrderStatus, extra?: Partial<Order>) => void;
  bumpEta: (no: number) => void;
  toggleOccupied: (n: number) => void;
  // ui
  showToast: (title: string, text: string, opts?: { force?: boolean; target?: Screen; order?: number }) => void;
  hideToast: () => void;
  toastTap: () => void;
  tick: () => void;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  // связь с сервером
  /** загрузка профиля, заказов и столиков при старте, подписка на живые события */
  bootstrap: () => Promise<void>;
  setNetError: (msg: string | null) => void;
  /** вход сотрудника в панель по логину и PIN */
  /** первый шаг: код заведения открывает панель */
  staffPanelCode: (code: string) => Promise<boolean>;
  /** второй шаг: номер сотрудника и его личный PIN */
  staffLogin: (login: string, pin: string) => Promise<boolean>;
  /** закрыть панель: кнопкой или сама по бездействию */
  lockStaff: () => void;
  /** отметить действие в панели, чтобы она не закрылась под руками */
  touchStaff: () => void;
  /** отмена своего заказа, пока кухня не начала готовить */
  cancelOrder: (no: number) => Promise<void>;
}

export type Store = AppState & AppActions;

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastSeq = 0;

/**
 * Хранилище с двумя защитами:
 * 1) не пишем, если строка не изменилась — секундный таймер обновляет только `now`, а он не сохраняется,
 *    поэтому без этой проверки приложение писало бы в localStorage каждую секунду и могло затирать
 *    свежие изменения из соседней вкладки;
 * 2) приватный режим и запрет на хранилище не должны ронять приложение — работаем из памяти.
 */
const memory = new Map<string, string>();
let lastWritten: string | null = null;
const safeStorage: Storage = {
  get length() { try { return localStorage.length; } catch { return memory.size; } },
  key(i) { try { return localStorage.key(i); } catch { return [...memory.keys()][i] ?? null; } },
  getItem(k) { try { return localStorage.getItem(k); } catch { return memory.get(k) ?? null; } },
  setItem(k, v) {
    if (v === lastWritten) return;
    lastWritten = v;
    try { localStorage.setItem(k, v); } catch { memory.set(k, v); }
  },
  removeItem(k) { lastWritten = null; try { localStorage.removeItem(k); } catch { memory.delete(k); } },
  clear() { lastWritten = null; try { localStorage.clear(); } catch { memory.clear(); } },
};
/** Сбрасывает защиту от повторной записи — вызывается, когда состояние пришло из другой вкладки. */
export const forgetLastWrite = () => { lastWritten = null; };
const pickupSlotTs = (now: number, i: number) => Math.ceil(now / 900000) * 900000 + i * 900000;

function initialState(): AppState {
  const now = Date.now();
  return {
    screen: 'splash', profileSub: null, staffTab: 'orders', menuJump: null,
    user: null, loginStep: 'phone', phoneInput: '', codeInput: '', nameInput: '', phoneErr: false,
    cat: 'burgers', dishId: null, dishSize: 0, dishSauces: {}, dishQty: 1, dishFrom: 'menu',
    cart: [], comment: '', format: 'hall', table: 'any', pickup: 'asap', pickupTime: 0, payment: 'cash', guestName: '', guestPhone: '',
    // демо-заказы нужны только для показа приложения без сервера
    orders: [], nextNo: FIRST_ORDER_NO, occupied: {}, viewOrder: null,
    favorites: {}, favFormat: 'hall', notifOn: true,
    consentAt: null, consentVersion: null, marketingConsent: false, marketingConsentAt: null, legalDoc: null,
    storageNoticeAt: null,
    staffForm: null,
    toast: null, now, settings: { ...DEFAULT_SETTINGS },
    netError: null, busy: false, online: false, resendAfter: 0,
    // Панель закрыта, пока не введён код заведения и не вошёл сотрудник — и в демонстрации тоже.
    panelTicket: null, staffSeenAt: 0, staffAuthed: LIVE && api.hasStaffToken(),
  };
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...initialState(),

      go: screen => set({ screen, profileSub: null }),
      setProfileSub: sub => set({ profileSub: sub }),
      setStaffTab: tab => set({ staffTab: tab }),

      // ---- вход по номеру → SMS-код → имя ----
      setPhoneInput: v => set({ phoneInput: formatPhone(v), phoneErr: false }),
      setCodeInput: v => set({ codeInput: v.replace(/\D/g, '').slice(0, 4) }),
      setNameInput: v => set({ nameInput: v }),
      sendCode: () => {
        if (!isPhoneComplete(get().phoneInput)) { set({ phoneErr: true }); return; }
        if (LIVE) { void live.sendCode(); return; }
        set({ loginStep: 'code', codeInput: '' });
      },
      backToPhone: () => set({ loginStep: 'phone' }),
      confirmCode: () => {
        const code = get().codeInput;
        if (LIVE) { if (code.length >= 4) void live.confirmCode(); return; }
        if (code.length === 4) set({ loginStep: 'name' });
      },
      finishLogin: () => {
        const s = get();
        if (LIVE) { void live.saveName(); return; }
        set({ user: { name: s.nameInput.trim() || 'Гость', phone: s.phoneInput }, screen: 'home', loginStep: 'phone', codeInput: '', nameInput: '',
          consentAt: s.consentAt || Date.now(), consentVersion: s.consentVersion || LEGAL_VERSION });
      },
      skipLogin: () => set({ user: null, screen: 'home', loginStep: 'phone' }),
      logout: () => {
        if (LIVE) live.logout();
        set({ user: null, screen: 'splash', loginStep: 'phone', phoneInput: '', codeInput: '', nameInput: '', profileSub: null });
      },

      // ---- меню / блюдо ----
      selectCat: id => set({ cat: id }),
      openCat: id => set({ screen: 'menu', cat: id, menuJump: id, profileSub: null }),
      clearMenuJump: () => set({ menuJump: null }),
      openDish: (id, sizeIdx = 0, from) => set({ screen: 'dish', dishId: id, dishSize: sizeIdx, dishSauces: {}, dishQty: 1, dishFrom: from || get().screen }),
      dishBack: () => { const s = get(); set({ screen: s.dishFrom === 'dish' ? 'menu' : s.dishFrom }); },
      dishInc: () => set({ dishQty: get().dishQty + 1 }),
      dishDec: () => set({ dishQty: Math.max(1, get().dishQty - 1) }),
      setDishSize: i => set({ dishSize: i }),
      toggleDishSauce: id => { const d = { ...get().dishSauces }; d[id] = !d[id]; set({ dishSauces: d }); },
      toggleFav: id => {
        const s = get(); const key = id ?? s.dishId; if (!key) return;
        const f = { ...s.favorites }; if (f[key]) delete f[key]; else f[key] = true; set({ favorites: f });
      },
      addToCart: () => {
        const s = get(); if (!s.dishId || !ITEMS[s.dishId]) return;
        const line = mkLine(s.dishId, s.dishSize, s.dishQty, Object.keys(s.dishSauces).filter(k => s.dishSauces[k]));
        set({ cart: mergeLines(s.cart, [line]), screen: s.dishFrom === 'dish' ? 'menu' : s.dishFrom });
      },

      // ---- корзина / оформление ----
      changeLine: (key, d) => set({ cart: get().cart.map(l => (l.key === key ? { ...l, qty: l.qty + d } : l)).filter(l => l.qty > 0) }),
      setComment: v => set({ comment: v }),
      pickFormat: f => set({ format: f, table: 'any' }),
      pickTable: (n, zone) => set({ table: n, format: zone }),
      pickAnyTable: () => set({ table: 'any' }),
      pickAsap: () => set({ pickup: 'asap' }),
      pickSlot: ts => set({ pickup: 'time', pickupTime: ts }),
      setPayment: p => set({ payment: p }),
      setGuestName: v => set({ guestName: v }),
      setGuestPhone: v => set({ guestPhone: formatPhone(v) }),
      placeOrder: () => {
        const s = get(); if (!s.cart.length) return false;
        if (LIVE) { void live.placeOrder(); return true; }
        const now = Date.now();
        const total = orderTotal(s.cart);
        const table = s.format === 'togo' ? null : (s.table === 'any' ? null : s.table);
        let occ = s.occupied; if (table) occ = { ...occ, [table]: true };
        const o: Order = {
          no: s.nextNo, createdAt: now, status: 'new', format: s.format, table,
          pickup: s.format === 'togo' ? s.pickup : undefined,
          pickupLabel: s.format === 'togo' && s.pickup === 'time' && s.pickupTime > now ? fmtTime(s.pickupTime) : '',
          payment: s.payment, lines: s.cart, comment: s.comment.trim() || undefined, total,
          name: s.user ? s.user.name : (s.guestName.trim() || 'Гость'), phone: s.user ? s.user.phone : s.guestPhone,
          mine: true, pendingEta: 15,
        };
        set({ orders: [o, ...s.orders], nextNo: s.nextNo + 1, cart: [], comment: '', occupied: occ, screen: 'status', viewOrder: o.no, profileSub: null, table: 'any', pickup: 'asap', pickupTime: 0 });
        return true;
      },
      repeatOrder: no => {
        const s = get(); const o = s.orders.find(x => x.no === no); if (!o) return;
        // повторить можно только позиции из меню (не ручные строки заказа по звонку):
        // если повторять нечего, не уводим в пустую корзину — кнопка у таких заказов и не показывается
        if (!canRepeat(o)) return;
        const lines = o.lines.map(relineForCart).filter((l): l is Line => !!l);
        set({ cart: mergeLines(s.cart, lines), screen: 'cart', profileSub: null, format: o.format, table: 'any' });
      },

      // ---- статус ----
      viewOrderNo: no => set({ viewOrder: no }),
      openActive: () => {
        const s = get(); const a = selActiveMine(s)[0];
        set({ screen: 'status', viewOrder: a ? a.no : null, profileSub: null });
      },

      // ---- профиль ----
      cycleFavFormat: () => {
        const ord: Format[] = ['hall', 'terrace', 'togo'];
        const f = ord[(ord.indexOf(get().favFormat) + 1) % 3];
        set({ favFormat: f, format: f, table: 'any' });
      },
      toggleNotif: () => {
        const on = !get().notifOn; set({ notifOn: on });
        if (on && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission().catch(() => undefined);
        }
      },

      // ---- правовое: согласия, документы, удаление аккаунта ----
      setConsent: accepted => set(accepted
        ? { consentAt: Date.now(), consentVersion: LEGAL_VERSION }
        : { consentAt: null, consentVersion: null, marketingConsent: false, marketingConsentAt: null }),
      setMarketing: accepted => {
        set({ marketingConsent: accepted, marketingConsentAt: accepted ? Date.now() : null });
        if (LIVE) void live.setMarketing(accepted);
      },
      openLegal: doc => set({ screen: 'legal', legalDoc: doc, profileSub: null }),
      dismissStorageNotice: () => set({ storageNoticeAt: Date.now() }),
      /**
       * Отзыв согласия и удаление аккаунта (152-ФЗ ст. 9 ч. 2, требования Google Play и App Store).
       * Локально стираем профиль, свои заказы, избранное и корзину; заказы кафе (чужие) не трогаем.
       * При появлении сервера здесь же отправляется запрос на удаление данных на стороне кафе.
       */
      deleteAccount: async () => {
        const s = get();
        // Данные на устройстве стираем только после того, как сервер подтвердил удаление:
        // иначе при отказе профиль остался бы на сервере и вернулся при следующем запуске.
        if (LIVE && !(await live.deleteAccount())) return;
        set({
          user: null, orders: s.orders.filter(o => !o.mine), cart: [], comment: '', favorites: {},
          consentAt: null, consentVersion: null, marketingConsent: false, marketingConsentAt: null, notifOn: true,
          guestName: '', guestPhone: '', phoneInput: '', codeInput: '', nameInput: '',
          viewOrder: null, profileSub: null, legalDoc: null, screen: 'splash', loginStep: 'phone',
        });
      },

      // ---- персонал ----
      toggleStaffForm: () => {
        const s = get();
        set({ staffForm: s.staffForm ? null : { phone: s.user ? s.user.phone : '', text: '', format: 'togo', sum: '' } });
      },
      setStaffForm: patch => {
        const f = get().staffForm || { phone: '', text: '', format: 'togo', sum: '' };
        const next = { ...f, ...patch };
        if (patch.phone !== undefined) next.phone = formatPhone(patch.phone);
        if (patch.sum !== undefined) next.sum = patch.sum.replace(/\D/g, '').slice(0, 6);
        set({ staffForm: next });
      },
      submitStaffForm: () => {
        const s = get(); const f = s.staffForm; if (!f) return;
        const sum = parseInt(f.sum, 10) || 0;
        if (LIVE) {
          void live.staffCreateOrder(f.phone, f.text, f.format, sum).then(ok => { if (ok) set({ staffForm: null }); });
          return;
        }
        const mine = !!(s.user && phoneKey(f.phone) && phoneKey(f.phone) === phoneKey(s.user.phone));
        const o: Order = {
          no: s.nextNo, createdAt: Date.now(), status: 'new', format: f.format, table: null, payment: 'cash',
          lines: [{ key: 'manual-' + s.nextNo, name: f.text.trim() || 'Заказ по звонку', sauceNames: [], unit: sum, qty: 1 }],
          total: sum, name: 'По звонку', phone: f.phone, byPhone: true, mine, pendingEta: 15,
        };
        set({ orders: [o, ...s.orders], nextNo: s.nextNo + 1, staffForm: null });
      },
      staffAccept: no => {
        const o = get().orders.find(x => x.no === no);
        const eta = (o && o.pendingEta) || 15;
        if (LIVE) { void live.staffAccept(no, eta); return; }
        get().setStatus(no, 'accepted', { eta });
      },
      setPending: (no, m) => set({ orders: get().orders.map(o => (o.no === no ? { ...o, pendingEta: m } : o)) }),
      setStatus: (no, status, extra) => {
        const s = get();
        if (LIVE) { void live.staffStatus(no, status); return; }
        const now = Date.now(); let occ = s.occupied; let toast: ToastMsg | undefined;
        const orders = s.orders.map(o => {
          if (o.no !== no) return o;
          const r = transition(o, status, occ, now, extra); occ = r.occ; toast = r.toast; return r.order;
        });
        set({ orders, occupied: occ });
        if (toast) get().showToast(toast.title, toast.text);
      },
      bumpEta: no => {
        const s = get();
        if (LIVE) {
          const o = s.orders.find(x => x.no === no);
          void live.staffEta(no, ((o && o.eta) || 15) + 5);
          return;
        }
        let toast: ToastMsg | undefined;
        const orders = s.orders.map(o => {
          if (o.no !== no) return o;
          const n = { ...o, eta: (o.eta || 15) + 5 };
          if (n.mine) toast = { title: 'Время готовности изменено', text: `Заказ №${n.no} будет готов через ~${minutesLeft(n, Date.now())} мин` };
          return n;
        });
        set({ orders });
        if (toast) get().showToast(toast.title, toast.text);
      },
      toggleOccupied: n => {
        if (LIVE) { void live.staffToggleTable(n); return; }
        const occ = { ...get().occupied }; occ[n] = !occ[n]; set({ occupied: occ });
      },

      // ---- push-баннер ----
      showToast: (title, text, opts) => {
        const s = get();
        if (!opts?.force && (!s.settings.pushBanners || !s.notifOn)) return;
        clearTimeout(toastTimer);
        const target: Screen = opts?.target || (s.screen === 'staff' ? 'staff' : 'status');
        set({ toast: { id: ++toastSeq, title, text, target, order: opts?.order } });
        toastTimer = setTimeout(() => set({ toast: null }), 5000);
        // Системное уведомление, когда приложение свёрнуто. На Android конструктор Notification запрещён —
        // там уведомление показывает service worker; если ни то ни другое недоступно, остаётся баннер в приложении.
        if (!opts?.force && typeof document !== 'undefined' && document.hidden && typeof window !== 'undefined'
            && 'Notification' in window && Notification.permission === 'granted') {
          const icon = import.meta.env.BASE_URL + 'icon-192.png';
          const body = { body: text, icon, badge: icon, tag: 'graff-' + title, lang: 'ru' };
          navigator.serviceWorker?.ready
            .then(reg => reg.showNotification(title, body))
            .catch(() => { try { new Notification(title, body); } catch { /* платформа не поддерживает */ } });
        }
      },
      hideToast: () => { clearTimeout(toastTimer); set({ toast: null }); },
      toastTap: () => {
        const t = get().toast; clearTimeout(toastTimer);
        // Баннер знает свой заказ: без этого открывался тот, что был выбран раньше.
        set({
          toast: null, screen: t ? t.target : get().screen, profileSub: null,
          ...(t?.order != null ? { viewOrder: t.order } : {}),
        });
      },

      // ---- таймер: раз в секунду ----
      tick: () => {
        const s = get(); const now = Date.now();
        // Панель кухни, оставленную открытой, закрываем сами: планшет на кухне
        // видят все, а в панели телефоны гостей и вся лента заказов.
        if (s.staffAuthed && s.staffSeenAt && now - s.staffSeenAt > STAFF_IDLE_MINUTES * 60_000) {
          get().lockStaff();
          return;
        }
        set({ now });
      },
      setSetting: (key, value) => set({ settings: { ...get().settings, [key]: value } }),
      // ---- связь с сервером ----
      bootstrap: async () => { if (LIVE) await live.bootstrap(); },
      setNetError: msg => set({ netError: msg }),
      staffPanelCode: async code => {
        if (LIVE) return live.staffPanelCode(code);
        // В демонстрации проверка идёт на устройстве: это показ порядка входа, а не защита.
        if (code.trim() !== DEMO_PANEL_CODE) {
          set({ netError: 'Неверный код заведения' });
          return false;
        }
        set({ panelTicket: 'demo', netError: null });
        return true;
      },
      staffLogin: async (login, pin) => {
        if (LIVE) return live.staffLogin(login, pin);
        if (!get().panelTicket) {
          set({ netError: 'Сначала введите код заведения' });
          return false;
        }
        const who = DEMO_STAFF.find(x => x.number === login.trim() && x.pin === pin.trim());
        if (!who) {
          set({ netError: 'Неверный номер сотрудника или PIN' });
          return false;
        }
        set({ staffAuthed: true, staffSeenAt: Date.now(), netError: null });
        return true;
      },
      lockStaff: () => {
        if (LIVE) void live.staffLogout();
        set({ staffAuthed: false, panelTicket: null, staffSeenAt: 0, staffForm: null, netError: null });
      },
      touchStaff: () => { if (get().staffAuthed) set({ staffSeenAt: Date.now() }); },
      cancelOrder: async no => {
        if (LIVE) { await live.cancelOrder(no); return; }
        get().setStatus(no, 'cancelled');
      },

    }),
    {
      name: 'graff-app',
      version: 5,
      storage: createJSONStorage(() => safeStorage),
      partialize: s => ({
        screen: s.screen, staffTab: s.staffTab,
        user: s.user, cat: s.cat, dishId: s.dishId, dishSize: s.dishSize, dishSauces: s.dishSauces, dishQty: s.dishQty, dishFrom: s.dishFrom,
        cart: s.cart, comment: s.comment, format: s.format, table: s.table, pickup: s.pickup, pickupTime: s.pickupTime, payment: s.payment, guestName: s.guestName, guestPhone: s.guestPhone,
        orders: s.orders, nextNo: s.nextNo, occupied: s.occupied, viewOrder: s.viewOrder,
        favorites: s.favorites, favFormat: s.favFormat, notifOn: s.notifOn, settings: s.settings,
        consentAt: s.consentAt, consentVersion: s.consentVersion, marketingConsent: s.marketingConsent, marketingConsentAt: s.marketingConsentAt,
        storageNoticeAt: s.storageNoticeAt,
        staffAuthed: s.staffAuthed, panelTicket: s.panelTicket, staffSeenAt: s.staffSeenAt,
      }),
      migrate: (persisted, from) => {
        let p = (persisted || {}) as Partial<AppState>;
        // Редакция 3: панель кухни закрывается кодом заведения и личным PIN. Раньше в демонстрации
        // она была открыта всем, и это состояние сохранено на устройстве — закрываем.
        if (from < 3) p = { ...p, staffAuthed: false, panelTicket: null, staffSeenAt: 0 };
        // Редакция 4: вымышленных заказов и занятых столиков больше нет. У тех, кто открывал
        // приложение раньше, они сохранены на устройстве — стираем, счёт начинаем сначала.
        if (from < 4) p = { ...p, orders: [], occupied: {}, nextNo: FIRST_ORDER_NO, viewOrder: null };
        // Редакция 5: переключатель heroPhotos раньше прятал два круглых снимка по краям заголовка,
        // и их выключали, пока не было своих фотографий. Теперь он управляет главным снимком экрана,
        // и старое «выключено» скрывало бы его целиком — возвращаем к значению по умолчанию.
        if (from < 5) p = { ...p, settings: { ...(p.settings || DEFAULT_SETTINGS), heroPhotos: DEFAULT_SETTINGS.heroPhotos } };
        return p;
      },
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<AppState>;
        const merged: Store = { ...current, ...p, settings: { ...DEFAULT_SETTINGS, ...(p.settings || {}) } };
        // сплэш показываем только пока нет решения «войти / без входа»; 'dish' без блюда → меню
        if (merged.screen === 'dish' && !merged.dishId) merged.screen = 'menu';
        return merged;
      },
    },
  ),
);

// Dev: стор — синглтон с таймером и подписчиками; при горячей замене модуля (HMR) Vite создал бы второй экземпляр,
// и таймер старого продолжал бы писать в localStorage. Поэтому любое изменение стора или его зависимостей — полная перезагрузка.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

// Боевой слой работает со стором через мостик: так между файлами нет кольцевой зависимости.
live.bindStore({
  get: () => useStore.getState() as never,
  set: patch => useStore.setState(patch as never),
  toast: (title, text, order) => useStore.getState().showToast(title, text, { order }),
});

/* ---------- селекторы / хелперы для экранов ---------- */
export const selLoggedIn = (s: Store) => !!s.user;
export const selCartCount = (s: Store) => s.cart.reduce((a, l) => a + l.qty, 0);
export const selCartTotal = (s: Store) => orderTotal(s.cart);
export const selMine = (s: Store) => s.orders.filter(o => o.mine);
/** Активные заказы гостя: выданные и отменённые сюда не попадают — иначе карточка «Ваш заказ» висит вечно. */
export const selActiveMine = (s: Store) => s.orders.filter(o => o.mine && o.status !== 'done' && o.status !== 'cancelled');
/** заказ, показываемый на экране статуса: выбранный → активный → последний мой */
export const selViewedOrder = (s: Store): Order | null => {
  const mine = selMine(s);
  return (s.viewOrder != null && s.orders.find(o => o.no === s.viewOrder)) || selActiveMine(s)[0] || mine[0] || null;
};
export const selUserInitial = (s: Store) => (s.user ? s.user.name.trim().charAt(0).toUpperCase() || 'G' : 'G');
export const selDishUnit = (s: Store) => {
  if (!s.dishId || !ITEMS[s.dishId]) return 0;
  const it = ITEMS[s.dishId]; const z = it.sizes[s.dishSize] || it.sizes[0];
  return z.p + SAUCES.reduce((a, sa) => a + (s.dishSauces[sa.id] ? sa.p : 0), 0);
};
export const pickupSlots = (now: number) => [0, 1, 2, 3].map(i => ({ i, ts: pickupSlotTs(now, i), label: fmtTime(pickupSlotTs(now, i)) }));
