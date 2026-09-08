import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useStore, selCartCount, selCartTotal } from '../state/store';
import { MENU, TAGLINE, catIcon } from '../data/menu';
import { rub } from '../lib/format';
import { Icon, SpeedStrokes } from '../components/Icon';
import { PlateTitle, ScreenTitle } from '../components/Titles';
import { Photo } from '../components/Photo';
import { Promises } from '../components/Promises';
import './Menu.css';

/** после программной прокрутки scroll-spy молчит, чтобы не перескакивать по промежуточным категориям */
const SCROLL_LOCK_MS = 800;
/** высота липкой шапки до первого измерения (как в прототипе) */
const HEADER_FALLBACK = 130;
/** поле, в пределах которого активный таб считаем «на виду» */
const TAB_EDGE = 18;
/** последняя категория — её заголовок должен доезжать до шапки */
const LAST_ID = MENU[MENU.length - 1].id;
/** запас нижнего отступа, чтобы заголовок последней категории гарантированно прошёл под кромку шапки */
const TAIL_SLACK = 2;

const headerHeightOf = (el: HTMLElement | null) => el?.offsetHeight || HEADER_FALLBACK;
const catIndex = (id: string) => MENU.findIndex(c => c.id === id);

/** Меню — печатное меню кафе, перенесённое на телефон: липкие табы категорий, списки «название ……… цена», плавающая корзина. */
export function Menu() {
  const cat = useStore(s => s.cat);
  const menuJump = useStore(s => s.menuJump);
  const selectCat = useStore(s => s.selectCat);
  const clearMenuJump = useStore(s => s.clearMenuJump);
  const openDish = useStore(s => s.openDish);
  const go = useStore(s => s.go);
  const cartCount = useStore(selCartCount);
  const cartTotal = useStore(selCartTotal);

  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const lockUntil = useRef(0);
  const initialised = useRef(false);

  /** прокрутить список к категории (под липкую шапку) */
  const scrollToCat = useCallback((id: string, smooth: boolean) => {
    const sc = scrollRef.current, el = sectionRefs.current[id];
    if (!sc || !el) return;
    lockUntil.current = Date.now() + SCROLL_LOCK_MS;
    sc.scrollTo({ top: Math.max(0, el.offsetTop - headerHeightOf(headerRef.current)), behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  /** scroll-spy: активный таб следует за прокруткой — последняя секция, чей верх ушёл под шапку */
  const onScroll = () => {
    if (Date.now() < lockUntil.current) return;
    const sc = scrollRef.current;
    if (!sc) return;
    const edge = sc.scrollTop + headerHeightOf(headerRef.current) + 1;
    let cur = 0;
    MENU.forEach((c, i) => {
      const el = sectionRefs.current[c.id];
      if (el && el.offsetTop <= edge) cur = i;
    });
    const chosen = useStore.getState().cat;
    // у самого низа списка не отбираем у пользователя выбранную категорию, если она дальше найденной
    // (страховка на случай, когда хвост ещё не измерен — например, до загрузки шрифтов)
    const atBottom = sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 1;
    if (atBottom && catIndex(chosen) > cur) return;
    if (MENU[cur].id !== chosen) selectCat(MENU[cur].id);
  };

  const pickTab = (id: string) => { selectCat(id); scrollToCat(id, true); };

  // нижний отступ подбираем так, чтобы заголовок последней категории мог встать ровно под шапку —
  // иначе «Варенья» и «Соусы» не доезжают до верха, и scroll-spy подсвечивал бы «Напитки».
  // Объявлен раньше эффекта прыжка, чтобы первый scrollTo к последней категории не обрезался.
  useLayoutEffect(() => {
    const sc = scrollRef.current, head = headerRef.current, last = sectionRefs.current[LAST_ID], foot = footRef.current;
    if (!sc || !last || !foot) return;
    const fit = () => {
      const tail = foot.offsetTop + foot.offsetHeight - last.offsetTop; // от заголовка последней категории до низа футера
      const need = sc.clientHeight - headerHeightOf(head) - tail + TAIL_SLACK;
      sc.style.setProperty('--menu-tail', `${Math.max(0, Math.ceil(need))}px`);
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    [sc, head, last, foot].forEach(el => { if (el) ro.observe(el); });
    return () => ro.disconnect();
  }, []);

  // при открытии экрана — мгновенно к запрошенной категории (переход с главной) или к выбранной ранее
  useLayoutEffect(() => {
    const target = menuJump || (!initialised.current ? useStore.getState().cat : null);
    initialised.current = true;
    if (target) scrollToCat(target, false);
    if (menuJump) clearMenuJump();
  }, [menuJump, scrollToCat, clearMenuJump]);

  // активный таб всегда на виду в горизонтальной ленте
  useEffect(() => {
    const bar = tabsRef.current, tab = tabRefs.current[cat];
    if (!bar || !tab) return;
    const left = tab.offsetLeft, right = left + tab.offsetWidth;
    if (left < bar.scrollLeft + TAB_EDGE) bar.scrollTo({ left: Math.max(0, left - TAB_EDGE), behavior: 'smooth' });
    else if (right > bar.scrollLeft + bar.clientWidth - TAB_EDGE) bar.scrollTo({ left: right - bar.clientWidth + TAB_EDGE, behavior: 'smooth' });
  }, [cat]);

  return (
    <>
      <div ref={scrollRef} className="screen menu-screen" onScroll={onScroll}>
        {/* липкая шапка: заголовок, рукописный слоган и табы категорий */}
        <div ref={headerRef} className="menu-head">
          <div className="menu-head__row">
            <ScreenTitle icon="burger" plate="МЕНЮ" script="Меню" scriptSize={34} />
            <div className="t-hand menu-head__tag">{TAGLINE}</div>
          </div>
          <div ref={tabsRef} className="hscroll menu-tabs">
            {MENU.map(c => {
              const on = c.id === cat;
              return (
                <button
                  key={c.id}
                  type="button"
                  ref={el => { tabRefs.current[c.id] = el; }}
                  className={on ? 'menu-tab menu-tab--on' : 'menu-tab'}
                  aria-current={on || undefined}
                  onClick={() => pickTab(c.id)}
                >
                  <Icon d={c.icon} size={18} color={on ? '#fff' : 'var(--copper)'} />
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* секции категорий — как колонки печатного меню */}
        {MENU.map(c => (
          <section key={c.id} ref={el => { sectionRefs.current[c.id] = el; }} className="menu-cat" aria-label={c.name}>
            <div className="menu-cat__head">
              <div className="grow">
                <PlateTitle
                  icon={c.icon}
                  block
                  peach={c.isNew}
                  right={c.isNew ? <span className="menu-cat__star" role="img" aria-label="новинки">★</span> : undefined}
                >
                  {c.name}
                </PlateTitle>
              </div>
              <SpeedStrokes width={22} />
            </div>

            {c.hasPhoto && (
              <Photo id={'cat-' + c.id} height={130} radius={14} placeholder={c.photo} icon={catIcon(c.id)} style={{ marginTop: 12 }} />
            )}

            {c.groups.map((g, gi) => (
              <div key={gi} className="menu-group">
                {g.hasName && (
                  <div className="menu-group__title">
                    {g.hasIcon && <Icon d={g.icon} size={18} />}
                    {g.name}
                  </div>
                )}
                {g.items.map(it => (
                  // обёртка ловит тапы по отступам строки (как в прототипе); сами кнопки гасят всплытие
                  <div key={it.id} className="menu-item" onClick={() => openDish(it.id, 0, 'menu')}>
                    <button
                      type="button"
                      className="leader-row menu-item__main"
                      onClick={e => { e.stopPropagation(); openDish(it.id, 0, 'menu'); }}
                    >
                      <span className="menu-item__name">{it.name}</span>
                      <span className="leader" aria-hidden="true" />
                      <span className="t-price">{it.priceLabel}</span>
                    </button>
                    {it.hasSizes && (
                      <div className="menu-sizes">
                        {it.sizes.map((z, i) => (
                          <button
                            key={i}
                            type="button"
                            className="chip chip--xs"
                            onClick={e => { e.stopPropagation(); openDish(it.id, i, 'menu'); }}
                          >
                            {z.l}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </section>
        ))}

        <div ref={footRef} className="menu-foot">
          <Promises variant="footer" full />
        </div>
      </div>

      {/* плавающая корзина — вне прокрутки, над нижней навигацией */}
      {cartCount > 0 && (
        <button type="button" className="fab-cart" onClick={() => go('cart')}>
          <span>КОРЗИНА · {cartCount}</span>
          <span>{rub(cartTotal)}</span>
        </button>
      )}
    </>
  );
}
