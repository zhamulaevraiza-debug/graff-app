import { useEffect, useRef, type ComponentType } from 'react';
import { useStore, NAV_SCREENS, SCREENS, speedOf, forgetLastWrite, type Screen, type ProfileSub, type AppState } from './state/store';
import { minutesLeft, type Order } from './lib/orders';
import type { LegalDocId } from './data/legal';
import { BottomNav } from './components/BottomNav';
import { Toast } from './components/Toast';
import { Splash } from './screens/Splash';
import { Home } from './screens/Home';
import { Menu } from './screens/Menu';
import { Dish } from './screens/Dish';
import { Cart } from './screens/Cart';
import { Status } from './screens/Status';
import { Profile } from './screens/Profile';
import { About } from './screens/About';
import { Legal } from './screens/Legal';
import { Staff } from './screens/Staff';

const SCREEN_COMPONENTS: Record<Screen, ComponentType> = {
  splash: Splash, home: Home, menu: Menu, dish: Dish, cart: Cart, status: Status, profile: Profile, about: About, legal: Legal, staff: Staff,
};

const STORAGE_KEY = 'graff-app';
/** Данные, общие для всех вкладок (клиент ↔ панель персонала). Остальное — состояние интерфейса конкретной вкладки. */
const SHARED_KEYS = ['orders', 'nextNo', 'occupied', 'settings', 'user', 'favorites', 'favFormat', 'notifOn'] as const;
type SharedKey = (typeof SHARED_KEYS)[number];

/* ---------- адресная строка ↔ экран ---------- */
const LEGAL_IDS = ['privacy', 'terms', 'consent', 'requisites'];
const hashFor = (screen: Screen, sub: string | null) => '#/' + screen + (sub ? '/' + sub : '');
/** Под-страница текущего экрана: раздел профиля или открытый документ. */
const subOf = (s: Pick<AppState, 'screen' | 'profileSub' | 'legalDoc'>) =>
  s.screen === 'profile' ? s.profileSub : s.screen === 'legal' ? s.legalDoc : null;

function parseHash(): { screen: Screen; profileSub: ProfileSub; legalDoc: LegalDocId | null } | null {
  const m = location.hash.match(/^#\/([a-z]+)(?:\/([a-z]+))?/);
  if (!m) return null;
  const screen = m[1] as Screen;
  if (!SCREENS.includes(screen)) return null;
  const sub = m[2];
  return {
    screen,
    profileSub: screen === 'profile' && (sub === 'orders' || sub === 'favs') ? sub : null,
    legalDoc: screen === 'legal' && sub && LEGAL_IDS.includes(sub) ? (sub as LegalDocId) : null,
  };
}
// Экран из адреса применяем до первого рендера: ссылка «#/staff» открывает панель персонала,
// а не последний сохранённый экран; без этого первый рендер успевал бы перезаписать адрес.
{
  const initial = parseHash();
  if (initial) {
    const s = useStore.getState();
    if (initial.screen !== s.screen || initial.profileSub !== s.profileSub || initial.legalDoc !== s.legalDoc) {
      useStore.setState({ screen: initial.screen, profileSub: initial.profileSub, legalDoc: initial.legalDoc });
    }
  }
}

/* ---------- синхронизация вкладок ---------- */
function pickShared(src: Partial<AppState>): Partial<AppState> {
  const out: Partial<AppState> = {};
  for (const k of SHARED_KEYS) if (k in src) (out as Record<SharedKey, unknown>)[k] = src[k];
  return out;
}
/** Push-баннеры о моих заказах, которые изменила другая вкладка (например, персонал принял заказ). */
function notifyOrderChanges(prev: Order[], next: Order[], speed: number) {
  const { showToast } = useStore.getState();
  for (const o of next) {
    if (!o.mine) continue;
    const p = prev.find(x => x.no === o.no);
    if (!p) continue;
    if (p.status !== o.status) {
      if (o.status === 'accepted') showToast('Заказ принят!', `№${o.no} · готовим ~${o.eta} мин` + (o.table ? ` · столик ${o.table}` : ''));
      else if (o.status === 'ready') showToast(`Ваш заказ №${o.no} готов!`, o.format === 'togo' ? 'Подойдите к стойке' : `Столик ${o.table}`);
    } else if (p.eta !== o.eta && (o.status === 'accepted' || o.status === 'cooking')) {
      showToast('Время готовности изменено', `Заказ №${o.no} будет готов через ~${minutesLeft(o, Date.now(), speed)} мин`);
    }
  }
}

/** Секундный таймер (кухня-автопилот, обратный отсчёт), синхронизация вкладок, история браузера. */
function useAppEffects() {
  const tick = useStore(s => s.tick);
  const screen = useStore(s => s.screen);
  const profileSub = useStore(s => s.profileSub);
  const legalDocId = useStore(s => s.legalDoc);
  const firstHash = useRef(true);
  const prevScreen = useRef<Screen>(screen);

  // Боевой режим: при старте забираем профиль, свои заказы и столики, подписываемся на живые события.
  useEffect(() => {
    void useStore.getState().bootstrap();
  }, []);

  useEffect(() => {
    tick();
    const t = setInterval(tick, 1000);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [tick]);

  // другая вкладка записала состояние — забираем только общие данные (заказы, столики, настройки…),
  // экран и корзина остаются своими у каждой вкладки
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const incoming = pickShared((JSON.parse(e.newValue).state || {}) as Partial<AppState>);
        const current = useStore.getState();
        if (JSON.stringify(incoming) === JSON.stringify(pickShared(current))) return; // ничего нового — не пишем обратно (иначе вкладки пинг-понгом переписывают друг друга)
        forgetLastWrite();
        useStore.setState(incoming);
        if (incoming.orders) notifyOrderChanges(current.orders, incoming.orders, speedOf(incoming.settings || current.settings));
      } catch { /* чужая/битая запись — игнорируем */ }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // системная кнопка «назад»
  useEffect(() => {
    const onPop = () => {
      const p = parseHash();
      if (!p) return;
      const s = useStore.getState();
      if (p.screen !== s.screen || p.profileSub !== s.profileSub || p.legalDoc !== s.legalDoc) {
        useStore.setState({ screen: p.screen, profileSub: p.profileSub, legalDoc: p.legalDoc });
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const h = hashFor(screen, subOf({ screen, profileSub, legalDoc: legalDocId }));
    if (location.hash !== h) {
      // Экран входа не оставляем в истории: после «Продолжить без входа» или SMS-кода
      // системная кнопка «назад» не должна возвращать вошедшего пользователя на сплэш.
      const replace = firstHash.current || (prevScreen.current === 'splash' && screen === 'home');
      if (replace) history.replaceState({ graff: !firstHash.current }, '', h);
      else history.pushState({ graff: true }, '', h);
    }
    firstHash.current = false;
    prevScreen.current = screen;
  }, [screen, profileSub, legalDocId]);
}

export default function App() {
  useAppEffects();
  const screen = useStore(s => s.screen);
  const Current = SCREEN_COMPONENTS[screen] || Home;
  const showNav = NAV_SCREENS.includes(screen);
  return (
    <div className="app">
      <div className="phone paper">
        <div className="top-inset" />
        <Current key={screen} />
        <Toast />
        {showNav && <BottomNav />}
      </div>
    </div>
  );
}
