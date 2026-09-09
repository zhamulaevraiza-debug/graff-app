/**
 * Главная — шапка печатного меню на телефоне: логотип, «Позвонить», hero с бургером и фри,
 * три обещания бренда, карточка активного заказа, формат получения, категории, Новинки ★, адрес.
 * Источник: design/GRAFF App.dc.html, секция isHome (строки 100–183).
 */
import { useStore, selActiveMine, selSpeed } from '../state/store';
import { MENU, NEW_ITEMS, TOWN, ADDRESS, HOURS, SLOGAN_LINES, TAGLINE } from '../data/menu';
import { orderView, type Order } from '../lib/orders';
import { Icon, Crown, SpeedStrokes } from '../components/Icon';
import { HeaderLogo } from '../components/Logo';
import { Photo } from '../components/Photo';
import { Promises } from '../components/Promises';
import { CallRound } from '../components/CallButton';
import { FormatPicker } from '../components/FormatPicker';

/** Сброс стилей нативной кнопки: карточка/плитка выглядит как в макете, но остаётся <button>. */
const btnReset = {
  background: 'none', border: 0, padding: 0, margin: 0, color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
} as const;

export function Home() {
  const go = useStore(s => s.go);
  const openCat = useStore(s => s.openCat);
  const openDish = useStore(s => s.openDish);
  // первый активный заказ пользователя — ссылка стабильна, пока заказ не изменится
  const active = useStore(s => selActiveMine(s)[0]);
  const heroPhotos = useStore(s => s.settings.heroPhotos);

  return (
    <div className="screen">
      {/* шапка: логотип и «Позвонить» */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '0 var(--gutter)' }}>
        <HeaderLogo />
        <CallRound />
      </div>

      {/* hero как верх печатного меню; два круглых фото по краям можно убрать в панели персонала */}
      {/* колонки фото сжимаются на узких экранах (320–375px), чтобы правая колонка не уезжала за край */}
      <div
        style={heroPhotos
          ? { margin: '22px var(--gutter) 0', display: 'grid', gridTemplateColumns: 'minmax(64px, 104px) minmax(max-content, 1fr) minmax(64px, 104px)', alignItems: 'center', gap: 6 }
          : { margin: '22px var(--gutter) 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
      >
        {heroPhotos ? (
          <div style={{ position: 'relative' }}>
            <div className="t-hand" style={{ position: 'absolute', left: 0, top: -18, width: 96 }}>{SLOGAN_LINES}</div>
            <Photo id="hero-burger" shape="circle" width="100%" height="auto" placeholder="Фото бургера" icon="burger" style={{ marginTop: 20, aspectRatio: '1' }} />
          </div>
        ) : (
          <div className="t-hand">{SLOGAN_LINES}</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', minWidth: 0 }}>
          <Crown width={26} strokeWidth={1.4} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <SpeedStrokes width={20} style={{ flex: 'none' }} />
            <div style={{ font: '400 clamp(38px, 12vw, 46px)/1 var(--f-script)', color: 'var(--copper)' }}>Меню</div>
            <SpeedStrokes width={20} mirror style={{ flex: 'none' }} />
          </div>
          <button
            type="button"
            onClick={() => go('menu')}
            style={{
              marginTop: 8, border: '1.5px solid var(--copper)', borderRadius: 999, padding: '5px 14px',
              font: '700 12px var(--f-head)', letterSpacing: '.1em', color: 'var(--copper)', background: 'transparent',
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}
          >
            СМОТРЕТЬ
          </button>
        </div>
        {heroPhotos ? (
          <div style={{ position: 'relative', minWidth: 0 }}>
            <Photo id="hero-fries" shape="circle" width="100%" height="auto" placeholder="Фото фри GRAFF" icon="fries" style={{ aspectRatio: '1' }} />
            <div className="t-hand" style={{ textAlign: 'right', marginTop: 6 }}>{TAGLINE}</div>
          </div>
        ) : (
          <div className="t-hand">{TAGLINE}</div>
        )}
      </div>

      {/* три обещания бренда */}
      <Promises variant="framed" style={{ margin: '18px var(--gutter) 0' }} />

      {/* активный заказ */}
      {active && <ActiveOrderCard order={active} />}

      {/* формат получения */}
      <div style={{ margin: '16px var(--gutter) 0' }}>
        <FormatPicker />
      </div>

      {/* категории */}
      <div style={{ margin: '20px var(--gutter) 0', font: '700 13px var(--f-head)', letterSpacing: '.14em', color: 'var(--text)' }}>КАТЕГОРИИ</div>
      <div className="hscroll" style={{ padding: '10px var(--gutter) 4px' }}>
        {MENU.map(c => (
          <button
            key={c.id}
            type="button"
            onClick={() => openCat(c.id)}
            style={{ ...btnReset, flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 72 }}
          >
            <span style={{ width: 60, height: 60, borderRadius: 18, background: c.plateBg, border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon d={c.icon} size={28} strokeWidth={1.5} />
            </span>
            <span style={{ font: '500 12px var(--f-body)', textAlign: 'center' }}>{c.name}</span>
          </button>
        ))}
      </div>

      {/* Новинки ★ */}
      <div style={{ margin: '14px var(--gutter) 0', background: 'var(--peach)', border: '1px solid var(--line)', borderRadius: 16, padding: '12px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', font: '700 15px var(--f-head)', letterSpacing: '.1em' }}>
          <span className="star" style={{ fontSize: 18 }}>★</span> НОВИНКИ
        </div>
        <div className="hscroll" style={{ padding: '10px 14px 0' }}>
          {NEW_ITEMS.map(it => (
            <button
              key={it.id}
              type="button"
              onClick={() => openDish(it.id, 0, 'home')}
              aria-label={`${it.name}, ${it.priceLabel}`}
              style={{
                ...btnReset, flex: 'none', width: 150, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 14, padding: 10,
                display: 'flex', flexDirection: 'column', gap: 8,
              }}
            >
              <Photo id={'new-' + it.id} height={84} radius={10} placeholder={'Фото: ' + it.name} icon="star" />
              <span style={{ fontSize: 14, lineHeight: 1.2, minHeight: 34 }}>{it.name}</span>
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="t-price">{it.priceLabel}</span>
                <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--grad)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, lineHeight: 1 }}>+</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* адрес и часы → «О нас» */}
      <button
        type="button"
        onClick={() => go('about')}
        style={{
          ...btnReset, margin: '14px var(--gutter) 0', width: 'calc(100% - var(--gutter) * 2)', display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 14px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14,
        }}
      >
        <Icon name="pin" size={22} />
        <span className="grow" style={{ display: 'block' }}>
          <span style={{ display: 'block', fontWeight: 500 }}>{TOWN}, {ADDRESS}</span>
          <span className="t-small" style={{ display: 'block' }}>{HOURS} · зал и терраса</span>
        </span>
        <Icon name="chevron" size={18} strokeWidth={1.8} />
      </button>
    </div>
  );
}

/** Карточка «Ваш заказ» с минутами в кольце — единственная часть главной, живущая по секундному таймеру. */
function ActiveOrderCard({ order }: { order: Order }) {
  const now = useStore(s => s.now);
  const speed = useStore(selSpeed);
  const openActive = useStore(s => s.openActive);
  const view = orderView(order, now, speed);
  return (
    <button
      type="button"
      onClick={openActive}
      style={{
        ...btnReset, margin: '16px var(--gutter) 0', width: 'calc(100% - var(--gutter) * 2)', background: '#fff', border: '1px solid var(--line)',
        borderRadius: 16, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: 'var(--shadow-card)',
      }}
    >
      <span
        style={{
          width: 56, height: 56, borderRadius: '50%', border: `3px solid ${view.ringColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
          font: '700 14px/1 var(--f-head)', color: view.ringColor, textAlign: 'center', flex: 'none',
        }}
      >
        {view.minutesShort}
      </span>
      <span className="grow" style={{ display: 'block' }}>
        <span style={{ display: 'block', font: '700 11px var(--f-head)', letterSpacing: '.14em', color: 'var(--sec)' }}>ВАШ ЗАКАЗ</span>
        <span style={{ display: 'block', font: '700 18px var(--f-head)' }}>№{view.no} · {view.statusText}</span>
        <span className="t-small" style={{ display: 'block' }}>{view.subline}</span>
      </span>
      <Icon name="chevron" size={20} strokeWidth={1.8} />
    </button>
  );
}
