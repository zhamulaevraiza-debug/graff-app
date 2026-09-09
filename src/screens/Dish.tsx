import { useStore, selDishUnit } from '../state/store';
import { ITEMS, SAUCES, describe, catIcon, itemInfo, portionOf, PHONE_DISPLAY, PHONE_TEL } from '../data/menu';
import { rub } from '../lib/format';
import { Icon, Crown } from '../components/Icon';
import { Photo } from '../components/Photo';
import { photoCredit } from '../data/photos';
import { useOwnPhoto } from '../lib/photoStore';
import { BackButton } from '../components/Titles';
import { appBack } from '../lib/nav';
import './Dish.css';


/** Заголовок блока размеров — как в прототипе: «5 шт» → Порция, «200 мл» / S·M·L → Объём, иначе Вариант. */
const sizeTitleFor = (first: string) => (/шт/.test(first) ? 'Порция' : /мл|^[SML]$/.test(first) ? 'Объём' : 'Вариант');

export function Dish() {
  const dishId = useStore(s => s.dishId);
  const dishSize = useStore(s => s.dishSize);
  const dishSauces = useStore(s => s.dishSauces);
  const qty = useStore(s => s.dishQty);
  const fav = useStore(s => !!(s.dishId && s.favorites[s.dishId]));
  const unit = useStore(selDishUnit);

  const dishBack = useStore(s => s.dishBack);
  const toggleFav = useStore(s => s.toggleFav);
  const setDishSize = useStore(s => s.setDishSize);
  const toggleDishSauce = useStore(s => s.toggleDishSauce);
  const dishInc = useStore(s => s.dishInc);
  const dishDec = useStore(s => s.dishDec);
  const addToCart = useStore(s => s.addToCart);
  const go = useStore(s => s.go);

  const it = dishId ? ITEMS[dishId] : undefined;
  const photoSlot = it ? 'dish-' + it.id : '';
  const ownPhoto = useOwnPhoto(photoSlot);
  // Снимок из открытого каталога, а не съёмка этой порции — об этом честно говорим под фото.
  // Если кафе поставило собственное фото, оговорка не нужна.
  const stockPhoto = !ownPhoto && !!(it && photoCredit(photoSlot));

  if (!it) {
    return (
      <div className="screen screen--nonav screen--gutter">
        <div className="empty" style={{ paddingTop: 80 }}>
          <Crown width={44} />
          <div className="empty__title">Блюдо не найдено</div>
          <div className="t-sec t-pretty">Похоже, такой позиции больше нет в меню</div>
          <button type="button" className="btn btn--primary btn--md" onClick={() => go('menu')}>В меню</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="screen screen--nonav" style={{ paddingTop: 'calc(var(--sat) + 8px)', paddingBottom: 120 }}>
        <div className="dish-hero">
          <Photo key={it.id} id={'dish-' + it.id} height={250} radius={18} placeholder={'Фото: ' + it.name} icon={catIcon(it.catId)} />
          {stockPhoto && <div className="dish-hero__note">Фото иллюстративное</div>}
          <div className="dish-hero__back"><BackButton glass onClick={() => appBack(dishBack)} /></div>
          <button
            type="button"
            className="round-btn round-btn--glass dish-hero__fav"
            onClick={() => toggleFav()}
            aria-label={fav ? 'Убрать из избранного' : 'В избранное'}
            aria-pressed={fav}
          >
            <Icon name="heart" size={20} strokeWidth={1.7} fill={fav ? 'var(--copper)' : 'none'} />
          </button>
          {it.isNew && <div className="badge-new dish-hero__new"><span className="star">★</span>Новинка</div>}
        </div>

        <div className="dish-body">
          <div className="t-caps">{it.catName}</div>
          <div className="dish-name-row">
            <h1 className="dish-name">{it.name}</h1>
            <div className="dish-unit">{rub(unit)}</div>
          </div>
          <p className="t-sec t-pretty" style={{ marginTop: 8 }}>{describe(it.id)}</p>

          <DishInfo id={it.id} sizeIdx={dishSize} />

          {it.hasSizes && (
            <>
              <div className="dish-label" style={{ marginTop: 16 }}>{sizeTitleFor(it.sizes[0].l)}</div>
              <div className="dish-sizes" role="radiogroup" aria-label={sizeTitleFor(it.sizes[0].l)}>
                {it.sizes.map((z, i) => {
                  const on = i === dishSize;
                  return (
                    <button
                      key={z.l + i}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={'chip' + (on ? ' chip--on' : '')}
                      onClick={() => setDishSize(i)}
                    >
                      <span>{z.l}</span>
                      <span style={{ opacity: .8 }}>{rub(z.p)}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {it.canSauce && (
            <>
              <div className="dish-label" style={{ marginTop: 18 }}>Добавить соус</div>
              <div className="dish-sauces">
                {SAUCES.map(sa => {
                  const on = !!dishSauces[sa.id];
                  return (
                    <button key={sa.id} type="button" role="checkbox" aria-checked={on} className="dish-sauce" onClick={() => toggleDishSauce(sa.id)}>
                      <span className={'dish-check' + (on ? ' dish-check--on' : '')}>
                        <Icon name="check" size={14} color="#fff" strokeWidth={2.4} style={{ opacity: on ? 1 : 0 }} />
                      </span>
                      <span className="dish-sauce__name">{sa.name}</span>
                      <span className="dish-sauce__price">+{sa.p} ₽</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="dish-qty">
            <div className="dish-label">Количество</div>
            <div className="dish-qty__ctl">
              <button type="button" className="dish-qty__btn" onClick={dishDec} aria-label="Меньше">−</button>
              <div className="dish-qty__n" aria-live="polite">{qty}</div>
              <button type="button" className="dish-qty__btn" onClick={dishInc} aria-label="Больше">+</button>
            </div>
          </div>
        </div>
      </div>

      <div className="sticky-cta">
        <button type="button" className="btn btn--primary btn--lg btn--block btn--split" onClick={addToCart}>
          <span>В КОРЗИНУ</span>
          <span>{rub(unit * qty)}</span>
        </button>
      </div>
    </>
  );
}

/**
 * Сведения о блюде, обязательные для общепита: масса/объём порции, состав, пищевая ценность, аллергены
 * (Правила оказания услуг общественного питания, ЗоЗПП ст. 10, ТР ТС 022/2011).
 * Данные берутся из ITEM_INFO в src/data/menu.ts; пока кафе их не заполнило — показываем, где уточнить.
 */
function DishInfo({ id, sizeIdx }: { id: string; sizeIdx: number }) {
  const info = itemInfo(id);
  const portion = portionOf(id, sizeIdx);
  const n = info.nutrition;
  const rows: [string, string][] = [];
  if (portion) rows.push(['Порция', portion]);
  if (info.cooking) rows.push(['Способ приготовления', info.cooking]);
  if (info.composition) rows.push(['Состав', info.composition]);
  if (n) rows.push(['Пищевая ценность', `${n.kcal} ккал · белки ${n.protein} г · жиры ${n.fat} г · углеводы ${n.carbs} г`]);
  if (info.allergens && info.allergens.length) rows.push(['Аллергены', info.allergens.join(', ')]);
  if (info.contraindications) rows.push(['Противопоказания', info.contraindications]);

  return (
    <section className="dish-info" aria-label="Сведения о блюде">
      {rows.length > 0 ? (
        rows.map(([label, value]) => (
          <div key={label} className="dish-info__row">
            <span className="dish-info__label">{label}</span>
            <span className="dish-info__value">{value}</span>
          </div>
        ))
      ) : (
        <div className="t-small t-pretty">
          Состав, массу порции и пищевую ценность уточните у персонала или по телефону{' '}
          <a href={PHONE_TEL}>{PHONE_DISPLAY}</a>.
        </div>
      )}
    </section>
  );
}
