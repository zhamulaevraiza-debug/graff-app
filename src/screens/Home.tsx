/**
 * Главная — витрина кафе: крупный заголовок с фотографией навылет, три обещания бренда
 * карточками, активный заказ, формат получения, категории, Новинки ★ и адрес.
 *
 * Верх экрана собран по макету владельца: заголовок «Вкус в каждой детали», кнопка
 * «Смотреть меню» и снимок, выходящий за правый край. Категории, новинки и адрес
 * остаются ниже — без них в меню было бы не попасть.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, selActiveMine } from '../state/store';
import {
  MENU, NEW_ITEMS, FORMATS, PROMISES, TOWN, ADDRESS, HOURS, TAGLINE_LINES,
  HERO_EYEBROW, HERO_TITLE, HERO_SUB, PHONE_DISPLAY, PHONE_TEL,
} from '../data/menu';
import { orderView, type Order } from '../lib/orders';
import { Icon } from '../components/Icon';
import { HeaderLogo } from '../components/Logo';
import { Photo } from '../components/Photo';
import './Home.css';

export function Home() {
  const go = useStore(s => s.go);
  const openCat = useStore(s => s.openCat);
  const openDish = useStore(s => s.openDish);
  const format = useStore(s => s.format);
  const pickFormat = useStore(s => s.pickFormat);
  // первый активный заказ пользователя — ссылка стабильна, пока заказ не изменится
  const active = useStore(s => selActiveMine(s)[0]);
  const heroPhoto = useStore(s => s.settings.heroPhotos);
  const [sheet, setSheet] = useState(false);
  const burger = useRef<HTMLButtonElement>(null);

  // Фокус возвращаем на кнопку, которой лист открыли: иначе он падает в начало страницы.
  const closeSheet = () => { setSheet(false); burger.current?.focus(); };

  return (
    <div className="screen home">
      {/* шапка: логотип и кнопка меню */}
      <div className="home-head">
        <HeaderLogo height={46} />
        <button
          ref={burger}
          type="button"
          className="home-burger"
          onClick={() => setSheet(true)}
          aria-label="Меню и контакты"
          aria-haspopup="dialog"
          aria-expanded={sheet}
        >
          <Icon name="bars" size={22} color="var(--h-title)" strokeWidth={1.8} />
        </button>
      </div>

      {/* заголовок, кнопка и фотография */}
      <section className="hero">
        <div className={heroPhoto ? 'hero__top hero__top--photo' : 'hero__top'}>
          {heroPhoto && (
            <div className="hero__photo">
              <Leaf className="hero__leaf" />
              <Photo id="hero-burger" width="100%" height="100%" placeholder="Фото бургера" icon="burger" style={{ borderRadius: '26px 0 0 26px' }} />
            </div>
          )}
          <div className={heroPhoto ? 'hero__col' : 'hero__col hero__col--wide'}>
            <div className="hero__eyebrow">{HERO_EYEBROW}</div>
            <h1 className="hero__title">
              {HERO_TITLE.map((line, i) => <span key={i} style={{ display: 'block' }}>{line}</span>)}
            </h1>
            <p className="hero__sub">
              {HERO_SUB.map((line, i) => <span key={i} style={{ display: 'block' }}>{line}</span>)}
            </p>
          </div>
        </div>
        <div className="hero__bottom">
          <button type="button" className="hero__cta" onClick={() => go('menu')}>
            Смотреть меню
            <Icon name="arrow" size={20} color="#fff" strokeWidth={1.8} />
          </button>
          <div className="hero__hand">
            {TAGLINE_LINES.map((line, i) => <span key={i} style={{ display: 'block' }}>{line}</span>)}
          </div>
        </div>
      </section>

      {/* три обещания бренда */}
      <div className="home-promises">
        {PROMISES.map(p => (
          <div key={p.icon} className="home-promise">
            <span className="home-promise__badge">
              <Icon name={p.icon} size={19} color={p.color || 'var(--copper)'} strokeWidth={1.7} />
            </span>
            <span className="home-promise__text">{p.tile}</span>
          </div>
        ))}
      </div>

      {/* активный заказ */}
      {active && <ActiveOrderCard order={active} />}

      {/* формат получения */}
      <div className="home-formats" role="radiogroup" aria-label="Формат получения">
        {FORMATS.map(f => {
          const on = format === f.id;
          return (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => pickFormat(f.id)}
              className={['home-format', on ? 'home-format--on' : ''].join(' ').trim()}
            >
              <Icon d={f.icon} size={24} color={on ? '#fff' : 'var(--h-title)'} strokeWidth={1.5} />
              {f.name}
            </button>
          );
        })}
      </div>

      {/* категории */}
      <h2 className="home-cap">Категории</h2>
      <div className="hscroll" style={{ padding: '12px var(--h-gutter) 4px' }}>
        {MENU.map(c => (
          <button key={c.id} type="button" className="home-cat" onClick={() => openCat(c.id)}>
            <span className="home-cat__tile"><Icon d={c.icon} size={28} strokeWidth={1.5} /></span>
            <span className="home-cat__name">{c.name}</span>
          </button>
        ))}
      </div>

      {/* Новинки ★ */}
      <h2 className="home-cap">Новинки ★</h2>
      <div className="hscroll" style={{ padding: '12px var(--h-gutter) 4px' }}>
        {NEW_ITEMS.map(it => (
          <button
            key={it.id}
            type="button"
            className="home-new"
            onClick={() => openDish(it.id, 0, 'home')}
            aria-label={`${it.name}, ${it.priceLabel}`}
          >
            {/* own: своё фото блюдо получает один раз — в панели персонала — и показывается им и здесь. */}
            <Photo id={'new-' + it.id} own={'dish-' + it.id} height={86} radius={12} placeholder={'Фото: ' + it.name} icon="star" />
            <span className="home-new__name">{it.name}</span>
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="t-price">{it.priceLabel}</span>
              <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--grad)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, lineHeight: 1 }}>+</span>
            </span>
          </button>
        ))}
      </div>

      {/* адрес и часы → «О нас» */}
      <button type="button" className="home-place" onClick={() => go('about')}>
        <Icon name="pin" size={22} />
        <span className="grow" style={{ display: 'block' }}>
          <span style={{ display: 'block', fontWeight: 500 }}>{TOWN}, {ADDRESS}</span>
          <span className="home-order__sub" style={{ marginTop: 0 }}>{HOURS} · зал и терраса</span>
        </span>
        <Icon name="chevron" size={18} strokeWidth={1.8} />
      </button>

      {sheet && <HomeSheet onClose={closeSheet} />}
    </div>
  );
}

/** Карточка «Ваш заказ» с минутами в кольце — единственная часть главной, живущая по секундному таймеру. */
function ActiveOrderCard({ order }: { order: Order }) {
  const now = useStore(s => s.now);
  const openActive = useStore(s => s.openActive);
  const view = orderView(order, now);
  const ready = order.status === 'ready';
  return (
    <button type="button" className="home-order" onClick={openActive}>
      <span className="home-order__ring" style={{ color: view.ringColor }}>
        {ready ? <Icon name="check" size={26} color={view.ringColor} strokeWidth={2} /> : view.minutesShort}
      </span>
      <span className="grow" style={{ display: 'block' }}>
        <span className="home-order__cap">Ваш заказ</span>
        <span className="home-order__title">№{view.no} — {view.statusText}</span>
        <span className="home-order__sub">{view.where || view.subline}</span>
      </span>
      <Icon name="chevron" size={20} color="var(--h-muted)" strokeWidth={1.8} />
    </button>
  );
}

/**
 * Лист из кнопки в шапке: то, до чего с главной иначе не дотянуться, — звонок и разделы.
 * Рисуется рядом с нижней навигацией, а не внутри экрана: экран — отдельный слой,
 * и перекрыть из него навигацию невозможно.
 */
function HomeSheet({ onClose }: { onClose: () => void }) {
  const go = useStore(s => s.go);
  const openLegal = useStore(s => s.openLegal);

  const box = useRef<HTMLDivElement>(null);

  // Лист объявлен модальным, значит и вести себя должен так: фокус переходит внутрь,
  // Tab ходит по кругу внутри листа, Escape закрывает. Иначе озвучка обещает одно, а выходит другое.
  useEffect(() => {
    const items = () => Array.from(box.current?.querySelectorAll<HTMLElement>('a, button') ?? []);
    items()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const list = items();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      const inside = !!box.current?.contains(active);
      if (e.shiftKey && (active === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const goTo = (fn: () => void) => () => { onClose(); fn(); };
  const host = document.querySelector('.phone') || document.body;

  return createPortal((
    <div className="home-sheet" role="dialog" aria-modal="true" aria-label="Меню и контакты" onClick={onClose}>
      <div className="home-sheet__box" ref={box} onClick={e => e.stopPropagation()}>
        <div className="home-sheet__grip" />
        <a href={PHONE_TEL} className="home-sheet__item" onClick={onClose}>
          <Icon name="phone" size={21} />
          <span className="grow">
            Позвонить
            <span className="home-sheet__sub" style={{ display: 'block' }}>{PHONE_DISPLAY}</span>
          </span>
        </a>
        <button type="button" className="home-sheet__item" onClick={goTo(() => go('menu'))}>
          <Icon name="burger" size={21} /><span className="grow">Меню</span>
        </button>
        <button type="button" className="home-sheet__item" onClick={goTo(() => go('about'))}>
          <Icon name="pin" size={21} /><span className="grow">О нас и контакты</span>
        </button>
        <button type="button" className="home-sheet__item" onClick={goTo(() => openLegal(null))}>
          <Icon name="receipt" size={21} /><span className="grow">Правовая информация</span>
        </button>
        <button type="button" className="home-sheet__item" onClick={onClose}>
          <Icon name="back" size={21} color="var(--sec)" /><span className="grow" style={{ color: 'var(--sec)' }}>Закрыть</span>
        </button>
      </div>
    </div>
  ), host);
}

/** Листик у фотографии — та же зелень, что на снимке блюда в макете. */
function Leaf({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={30} height={30} fill="none" stroke="#6E9A62" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 20c0-8 6-14 16-16 0 10-6 16-16 16z" fill="#DCE8D4" />
      <path d="M4 20c2-6 6-9 11-11" />
    </svg>
  );
}
