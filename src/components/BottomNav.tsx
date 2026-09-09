import { Icon } from './Icon';
import { useStore, selCartCount, type Screen } from '../state/store';
import type { IconName } from '../data/menu';

interface Tab { key: 'home' | 'menu' | 'order' | 'profile'; name: string; icon: IconName; active: (s: Screen) => boolean }
const TABS: Tab[] = [
  { key: 'home', name: 'Главная', icon: 'home', active: s => s === 'home' || s === 'about' },
  { key: 'menu', name: 'Меню', icon: 'burger', active: s => s === 'menu' },
  { key: 'order', name: 'Заказ', icon: 'receipt', active: s => s === 'cart' || s === 'status' },
  { key: 'profile', name: 'Профиль', icon: 'user', active: s => s === 'profile' },
];

/** Нижняя навигация, 4 вкладки: Главная · Меню · Заказ · Профиль. «Заказ» ведёт в корзину, если она не пуста, иначе — на статус. */
export function BottomNav() {
  const screen = useStore(s => s.screen);
  const go = useStore(s => s.go);
  const openActive = useStore(s => s.openActive);
  const cartCount = useStore(selCartCount);
  const hasCart = cartCount > 0;
  return (
    <nav className="bottom-nav" aria-label="Основная навигация">
      {TABS.map(t => {
        const on = t.active(screen);
        const color = on ? 'var(--copper)' : 'var(--nav-inactive)';
        const target: Screen = t.key === 'order' ? (hasCart ? 'cart' : 'status') : t.key;
        // «Заказ» без корзины ведёт к активному заказу: иначе показывался тот, что открыли из истории.
        const open = target === 'status' ? openActive : () => go(target);
        return (
          <button key={t.key} type="button" className={['bottom-nav__tab', on ? 'bottom-nav__tab--on' : ''].join(' ').trim()} onClick={open} aria-current={on ? 'page' : undefined}>
            <Icon name={t.icon} size={24} color={color} strokeWidth={1.7} />
            <span className="bottom-nav__label">{t.name}</span>
            {t.key === 'order' && hasCart && <span className="bottom-nav__badge" aria-hidden="true">{cartCount}</span>}
          </button>
        );
      })}
    </nav>
  );
}
