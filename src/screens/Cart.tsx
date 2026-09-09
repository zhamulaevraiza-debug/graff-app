import { useEffect } from 'react';
import { ZONES, PAYMENTS, FORMAT_NAME } from '../data/menu';
import { rub, isPhoneComplete } from '../lib/format';
import { useStore, selCartCount, selCartTotal, selUserInitial, pickupSlots, LIVE } from '../state/store';
import { Icon, Crown } from '../components/Icon';
import { ScreenTitle, SectionLabel } from '../components/Titles';
import { FormatPicker } from '../components/FormatPicker';
import { CallLine } from '../components/CallButton';
import { CONSENT_SHORT, OFFER_NOTE } from '../data/legal';
import './Cart.css';

/** Корзина и оформление заказа: позиции, комментарий, формат получения, столик / время, имя и телефон, оплата, итог. */
export function Cart() {
  const cart = useStore(s => s.cart);
  const comment = useStore(s => s.comment);
  const format = useStore(s => s.format);
  const table = useStore(s => s.table);
  const pickup = useStore(s => s.pickup);
  const pickupTime = useStore(s => s.pickupTime);
  const payment = useStore(s => s.payment);
  const guestName = useStore(s => s.guestName);
  const guestPhone = useStore(s => s.guestPhone);
  const occupied = useStore(s => s.occupied);
  const user = useStore(s => s.user);
  const initial = useStore(selUserInitial);
  const count = useStore(selCartCount);
  const total = useStore(selCartTotal);
  // связь с сервером: идёт отправка и текст последней ошибки (в демонстрации всегда пусто)
  const sending = useStore(s => s.busy);
  const netError = useStore(s => s.netError);
  const setNetError = useStore(s => s.setNetError);

  const go = useStore(s => s.go);
  const changeLine = useStore(s => s.changeLine);
  const setComment = useStore(s => s.setComment);
  const pickTable = useStore(s => s.pickTable);
  const pickAnyTable = useStore(s => s.pickAnyTable);
  const pickAsap = useStore(s => s.pickAsap);
  const pickSlot = useStore(s => s.pickSlot);
  const setPayment = useStore(s => s.setPayment);
  const setGuestName = useStore(s => s.setGuestName);
  const setGuestPhone = useStore(s => s.setGuestPhone);
  const placeOrder = useStore(s => s.placeOrder);
  const consentGiven = useStore(s => !!s.consentAt);
  const setConsent = useStore(s => s.setConsent);
  const openLegal = useStore(s => s.openLegal);

  // ошибка сервера относится к прошлой попытке: как только гость меняет состав или формат получения — убираем её
  useEffect(() => { setNetError(null); }, [cart, format, setNetError]);

  // на боевом сервере кухня связывается с гостем по телефону: без него заказ не оформить
  const needPhone = LIVE && !user && !isPhoneComplete(guestPhone);

  // ближайшие слоты по 15 минут: подписка на границу слота (не на секундный таймер), чтобы чипы и итог
  // не расходились со временем, которое placeOrder посчитает в момент нажатия
  const slotBase = useStore(s => Math.ceil(s.now / 900000));
  const slots = pickupSlots(slotBase * 900000);
  const slot = slots.find(sl => sl.ts === pickupTime);

  // Пока гость заполняет корзину, время идёт: выбранный слот может уйти в прошлое, а выбранный
  // столик — оказаться занятым. Молча подставлять другое время или занятый столик нельзя.
  useEffect(() => {
    if (pickup === 'time' && !slot) pickAsap();
  }, [pickup, slot, pickAsap]);
  useEffect(() => {
    if (table !== 'any' && occupied[table]) pickAnyTable();
  }, [table, occupied, pickAnyTable]);

  const formatSummary = format === 'togo'
    ? 'С собой' + (pickup === 'time' && slot ? ' · к ' + slot.label : ' · как можно скорее')
    : FORMAT_NAME[format] + (table === 'any' ? ' · любой свободный столик' : ' · столик ' + table);
  const totalLabel = rub(total);

  return (
    <div className="screen screen--gutter" style={{ paddingBottom: 'calc(var(--nav-h) + 30px)' }}>
      <ScreenTitle icon="bag" plate="КОРЗИНА" script="Корзина" />

      {cart.length === 0 ? (
        <div className="empty" style={{ marginTop: 90 }}>
          <Crown width={80} strokeWidth={1} />
          <div className="empty__title">Пока пусто. Начните с бургера ♥</div>
          <button
            type="button"
            className="btn btn--secondary"
            style={{ height: 48, padding: '0 28px', fontSize: 15, letterSpacing: '.08em' }}
            onClick={() => go('menu')}
          >
            К МЕНЮ
          </button>
        </div>
      ) : (
        <>
          {/* позиции корзины */}
          <div className="list" style={{ marginTop: 14 }}>
            {cart.map(l => {
              const meta = [
                l.sauceNames.length ? (l.sauceNames.length > 1 ? 'соусы: ' : 'соус: ') + l.sauceNames.join(', ').toLowerCase() : '',
                rub(l.unit) + ' × ' + l.qty,
              ].filter(Boolean).join(' · ');
              return (
                <div key={l.key} className="list__row cart-line">
                  <div className="list__grow">
                    <div className="cart-line__name">{l.name}</div>
                    <div className="list__sub">{meta}</div>
                  </div>
                  <div className="row gap-8">
                    <button type="button" className="cart-qty" onClick={() => changeLine(l.key, -1)} aria-label={`Убрать: ${l.name}`}>−</button>
                    <div className="cart-line__qty">{l.qty}</div>
                    <button type="button" className="cart-qty" onClick={() => changeLine(l.key, 1)} aria-label={`Добавить: ${l.name}`}>+</button>
                  </div>
                  <div className="t-price cart-line__sum">{rub(l.unit * l.qty)}</div>
                </div>
              );
            })}
          </div>

          <input
            className="input input--white"
            style={{ marginTop: 10 }}
            placeholder="Комментарий к заказу"
            value={comment}
            onChange={e => setComment(e.target.value)}
            aria-label="Комментарий к заказу"
          />

          {/* формат получения */}
          <SectionLabel>ФОРМАТ ПОЛУЧЕНИЯ</SectionLabel>
          <FormatPicker />

          {format !== 'togo' ? (
            <div className="card card--beige card--pad-sm" style={{ marginTop: 10 }}>
              <div className="row between">
                <span style={{ font: '700 14px var(--f-body)' }}>Столик</span>
                <button
                  type="button"
                  className={`chip chip--sm${table === 'any' ? ' chip--on' : ''}`}
                  onClick={pickAnyTable}
                  aria-pressed={table === 'any'}
                >
                  Любой свободный
                </button>
              </div>
              {ZONES.map(zn => {
                const free = zn.tables.filter(n => !occupied[n]).length;
                return (
                  <div key={zn.id} style={{ marginTop: 10, opacity: format === zn.id ? 1 : .45 }}>
                    <div className="row gap-6" style={{ fontSize: 13, color: 'var(--sec)', marginBottom: 6 }}>
                      <Icon d={zn.icon} size={16} />
                      {zn.name}
                      <span className="cart-zone-leader" />
                      <span>свободно {free} из {zn.tables.length}</span>
                    </div>
                    <div className="grid-4">
                      {zn.tables.map(n => {
                        const busy = !!occupied[n];
                        const mine = !busy && table === n && format === zn.id;
                        return (
                          <button
                            key={n}
                            type="button"
                            className={['table-cell', 'cart-table', busy ? 'table-cell--busy' : '', mine ? 'table-cell--mine' : ''].join(' ').trim()}
                            disabled={busy}
                            aria-pressed={mine}
                            aria-label={`Столик ${n}${busy ? ', занят' : ''}`}
                            onClick={() => { if (!busy) pickTable(n, zn.id); }}
                          >
                            {n}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <div className="legend">
                <span className="legend__item"><span className="legend__sw" />свободен</span>
                <span className="legend__item"><span className="legend__sw legend__sw--busy" />занят</span>
                <span className="legend__item"><span className="legend__sw legend__sw--mine" />ваш</span>
              </div>
            </div>
          ) : (
            <div className="card card--beige card--pad-sm" style={{ marginTop: 10 }}>
              <div style={{ font: '700 14px var(--f-body)' }}>Когда забрать</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`chip${pickup === 'asap' ? ' chip--on' : ''}`}
                  onClick={pickAsap}
                  aria-pressed={pickup === 'asap'}
                >
                  Как можно скорее
                </button>
                {slots.map(sl => {
                  const on = pickup === 'time' && pickupTime === sl.ts;
                  return (
                    <button
                      key={sl.ts}
                      type="button"
                      className={`chip${on ? ' chip--on' : ''}`}
                      onClick={() => pickSlot(sl.ts)}
                      aria-pressed={on}
                    >
                      {sl.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* имя и телефон */}
          <SectionLabel>ИМЯ И ТЕЛЕФОН</SectionLabel>
          {user ? (
            <div className="card row gap-12" style={{ padding: '10px 14px', borderRadius: 14 }}>
              <div className="cart-avatar">{initial}</div>
              <div className="grow">
                <div style={{ fontWeight: 500 }}>{user.name}</div>
                <div className="t-small">{user.phone}</div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--sec)' }}>из профиля</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 8 }}>
              <input
                className="input input--white"
                placeholder="Имя"
                value={guestName}
                onChange={e => setGuestName(e.target.value)}
                autoComplete="name"
                aria-label="Имя"
              />
              <input
                className="input input--white"
                placeholder="+7 ___ ___-__-__"
                inputMode="tel"
                value={guestPhone}
                onChange={e => setGuestPhone(e.target.value)}
                autoComplete="tel"
                aria-label="Телефон"
              />
            </div>
          )}

          {/* оплата */}
          <SectionLabel>ОПЛАТА</SectionLabel>
          <div className="list" style={{ borderRadius: 14 }} role="radiogroup" aria-label="Оплата">
            {PAYMENTS.map(pm => {
              const on = payment === pm.id;
              return (
                <button
                  key={pm.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-disabled={pm.soon || undefined}
                  className={`list__row cart-pay${pm.soon ? ' cart-pay--soon' : ''}`}
                  disabled={pm.soon}
                  onClick={() => setPayment(pm.id)}
                >
                  <span className={`cart-radio${on ? ' cart-radio--on' : ''}`}><span className="cart-radio__dot" /></span>
                  <span className="grow">{pm.name}</span>
                  {pm.soon && <span className="cart-pay__soon">скоро</span>}
                </button>
              );
            })}
          </div>

          {/* итог */}
          <div className="stack gap-6" style={{ marginTop: 18 }}>
            <div className="leader-row t-sec"><span>Блюда · {count}</span><span className="leader" /><span>{totalLabel}</span></div>
            <div className="leader-row t-sec"><span>{formatSummary}</span><span className="leader" /><span>0 ₽</span></div>
            <div className="leader-row leader-row--big"><span>ИТОГО</span><span className="leader" /><span style={{ color: 'var(--price)' }}>{totalLabel}</span></div>
          </div>

          {/* Согласие на обработку данных — до оформления заказа (152-ФЗ, ст. 9).
              Строка видна всегда: гость должен видеть, что согласие отмечено, и мочь его снять.
              Раньше блок пропадал сразу после отметки, и кнопка «Оформить» прыгала на его место. */}
          <div className="cart-consent">
            <input
              id="cart-consent"
              type="checkbox"
              className="cart-consent__box"
              checked={consentGiven}
              onChange={e => setConsent(e.target.checked)}
            />
            <label htmlFor="cart-consent">{CONSENT_SHORT}</label>
          </div>

          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            style={{ marginTop: 16 }}
            disabled={!consentGiven || sending || needPhone}
            onClick={() => placeOrder()}
          >
            {sending ? 'ОТПРАВЛЯЕМ…' : `ОФОРМИТЬ ЗАКАЗ · ${totalLabel}`}
          </button>

          {needPhone && (
            <div className="cart-note t-small">Укажите телефон: по нему кухня свяжется с вами</div>
          )}
          {netError && (
            <div className="cart-note field-err" role="alert">{netError}</div>
          )}

          <div className="cart-legal-note">
            {OFFER_NOTE}. Оплата — при получении в кафе, там же выдаётся кассовый чек.{' '}
            <button type="button" className="cart-legal-link" onClick={() => openLegal('terms')}>Условия оферты</button>
            <span aria-hidden="true"> · </span>
            <button type="button" className="cart-legal-link" onClick={() => openLegal('privacy')}>Политика данных</button>
          </div>
          <CallLine />
        </>
      )}
    </div>
  );
}
