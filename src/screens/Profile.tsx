/**
 * Экран «Профиль» с двумя под-экранами: «Мои заказы» и «Избранное» (s.profileSub).
 * Источник: design/GRAFF App.dc.html, секция isProfile (строки 448–492) и history/favList в renderVals().
 * Нижняя навигация рендерится в App.
 */
import { useEffect, useState } from 'react';
import { ITEMS, FORMAT_NAME, STATUS_TEXT } from '../data/menu';
import { rub, fmtDate, fmtTime } from '../lib/format';
import { formatText, itemsText, type Order } from '../lib/orders';
import { enablePush, disablePush, pushSupported, pushPermission, watchPushPermission } from '../lib/push';
import { useStore, selUserInitial } from '../state/store';
import { Icon, Crown } from '../components/Icon';
import { BackButton } from '../components/Titles';
import { appBack } from '../lib/nav';
import './Profile.css';

export function Profile() {
  const profileSub = useStore(s => s.profileSub);
  // key по под-экрану: при переходе экран монтируется заново — прокрутка сверху, лёгкое появление
  const key = profileSub ?? 'main';
  if (profileSub === 'orders') return <OrdersSub key={key} />;
  if (profileSub === 'favs') return <FavsSub key={key} />;
  return <MainSub key={key} />;
}

/* ---------- главный экран профиля ---------- */
function MainSub() {
  const user = useStore(s => s.user);
  const initial = useStore(selUserInitial);
  const orders = useStore(s => s.orders);
  const favorites = useStore(s => s.favorites);
  const favFormat = useStore(s => s.favFormat);
  const marketingConsent = useStore(s => s.marketingConsent);
  const setMarketing = useStore(s => s.setMarketing);
  const openLegal = useStore(s => s.openLegal);
  const deleteAccount = useStore(s => s.deleteAccount);
  const notifOn = useStore(s => s.notifOn);
  const go = useStore(s => s.go);
  const setProfileSub = useStore(s => s.setProfileSub);
  const cycleFavFormat = useStore(s => s.cycleFavFormat);
  const toggleNotif = useStore(s => s.toggleNotif);
  const logout = useStore(s => s.logout);

  const loggedIn = !!user;
  const historyCount = orders.filter(o => o.mine).length;
  const favCount = Object.keys(favorites).filter(id => favorites[id] && ITEMS[id]).length;

  /* ---- push-уведомления (src/lib/push.ts) ----
     notifOn остаётся выключателем баннеров внутри приложения; push — дополнение к нему
     для свёрнутого приложения. Ошибки подписки на экран не выводим: показываем только
     то, что человек может исправить сам. */
  const pushOk = pushSupported();
  // Решение браузера об уведомлениях. Могли запретить раньше — тогда подсказка нужна сразу,
  // без нажатия. Сам вопрос задаёт стор (toggleNotif), здесь только следим за ответом:
  // второй такой же вопрос браузер не покажет и ответит на него пустым 'default'.
  const [perm, setPerm] = useState<NotificationPermission>(pushPermission);
  useEffect(() => watchPushPermission(setPerm), []);

  /* Подписка на push. Отправляем её серверу при каждом открытии профиля и при смене гостя:
     на сервере адрес браузера связан с конкретным человеком, и когда один гость вышел, а на
     том же устройстве вошёл другой, эту связку нужно переписать — иначе придут уведомления
     о чужих заказах, а свои не придут вовсе. Заодно так восстанавливается подписка, которую не приняли раньше
     (переключатель включили до входа) или которой нет вовсе (очистка данных сайта, новый
     ключ сервера). enablePush идемпотентна: готовую подписку она переиспользует. */
  useEffect(() => {
    if (!notifOn || !pushOk || perm !== 'granted') return;
    void enablePush();
  }, [notifOn, pushOk, perm, user?.phone]);

  const onNotif = () => {
    const on = !notifOn;
    toggleNotif();
    // Выключаем сразу; включение делает эффект выше — как только разрешение окажется
    // полученным (сейчас или после ответа на вопрос браузера, который показывает стор).
    if (!on) void disablePush();
  };

  // Выход из аккаунта: снимаем подписку, чтобы в промежутке до входа следующего гостя
  // на это устройство не приходили уведомления о заказах прежнего.
  const onLogout = () => {
    void disablePush();
    logout();
  };

  // Подсказка под строкой: сначала про запрет, затем про установку на главный экран
  // (на iPhone web-push работает только у приложения с домашнего экрана).
  const notifHint = !notifOn ? ''
    : !pushOk ? 'Чтобы получать уведомления, добавьте приложение на главный экран'
      : perm === 'denied' ? 'Уведомления запрещены в настройках браузера' : '';

  return (
    <div className="screen screen--gutter">
      {/* шапка: аватар с инициалом, имя, телефон, «ВОЙТИ» для гостя */}
      <div className="row gap-14">
        <div className="profile__avatar" aria-hidden="true">{initial}</div>
        <div className="grow">
          <div style={{ font: '700 22px/1.1 var(--f-head)' }}>{loggedIn ? user.name : 'Гость'}</div>
          <div className="t-sec" style={{ marginTop: 2 }}>{loggedIn ? user.phone : 'Войдите, чтобы видеть заказы по звонку'}</div>
        </div>
        {!loggedIn && (
          <button type="button" className="btn btn--secondary btn--sm" style={{ height: 38 }} onClick={() => go('splash')}>
            ВОЙТИ
          </button>
        )}
      </div>

      <div className="list mt-20">
        <button type="button" className="list__row profile__btn" onClick={() => setProfileSub('orders')}>
          <Icon name="receipt" size={22} />
          <span className="list__grow">Мои заказы</span>
          <span className="list__hint">{historyCount}</span>
          <Icon name="chevron" size={18} strokeWidth={1.8} />
        </button>

        <button type="button" className="list__row profile__btn" onClick={() => setProfileSub('favs')}>
          <Icon name="heart" size={22} />
          <span className="list__grow">Избранное</span>
          <span className="list__hint">{favCount}</span>
          <Icon name="chevron" size={18} strokeWidth={1.8} />
        </button>

        <button type="button" className="list__row profile__btn" onClick={cycleFavFormat} aria-label={`Любимый формат: ${FORMAT_NAME[favFormat]}. Сменить`}>
          <Icon name="chair" size={22} />
          <span className="list__grow">
            <span style={{ display: 'block' }}>Любимый формат</span>
            <span className="list__sub" style={{ display: 'block' }}>для быстрого оформления</span>
          </span>
          <span className="chip chip--sm">{FORMAT_NAME[favFormat]}</span>
        </button>

        <div className="list__row list__row--static">
          <Crown width={22} />
          <span className="list__grow">Бонусы</span>
          <span className="badge badge--new">Скоро</span>
        </div>

        <button
          type="button"
          className="list__row profile__btn"
          role="switch"
          aria-checked={notifOn}
          aria-describedby={notifHint ? 'notif-hint' : undefined}
          // подсказка идёт отдельной строкой ниже — черту между ними убираем
          style={notifHint ? { borderBottom: 0, paddingBottom: 8 } : undefined}
          onClick={onNotif}
        >
          <Icon name="bell" size={22} />
          <span className="list__grow">
            <span style={{ display: 'block' }}>Уведомления</span>
            <span className="list__sub" style={{ display: 'block' }}>«Ваш заказ готов!» и изменение времени</span>
          </span>
          <span className={`toggle${notifOn ? ' toggle--on' : ''}`} aria-hidden="true">
            <span className="toggle__knob" />
          </span>
        </button>

        {notifHint && (
          <div className="list__row list__row--static" style={{ paddingTop: 0 }}>
            <span id="notif-hint" className="list__sub">{notifHint}</span>
          </div>
        )}

        {/* Рекламные рассылки — отдельное согласие, ФЗ «О рекламе», ст. 18 */}
        <button type="button" className="list__row profile__btn" role="switch" aria-checked={marketingConsent} onClick={() => setMarketing(!marketingConsent)}>
          <Icon name="star" size={22} />
          <span className="list__grow">
            <span style={{ display: 'block' }}>Акции и новинки</span>
            <span className="list__sub" style={{ display: 'block' }}>рекламные SMS и push от кафе; сообщения о статусе заказа приходят всегда</span>
          </span>
          <span className={`toggle${marketingConsent ? ' toggle--on' : ''}`} aria-hidden="true">
            <span className="toggle__knob" />
          </span>
        </button>

        <button type="button" className="list__row profile__btn" onClick={() => go('about')}>
          <Icon name="pin" size={22} />
          <span className="list__grow">О нас и контакты</span>
          <Icon name="chevron" size={18} strokeWidth={1.8} />
        </button>

        <button type="button" className="list__row profile__btn" onClick={() => openLegal(null)}>
          <Icon name="receipt" size={22} />
          <span className="list__grow">
            <span style={{ display: 'block' }}>Правовая информация</span>
            <span className="list__sub" style={{ display: 'block' }}>политика, оферта, реквизиты</span>
          </span>
          <Icon name="chevron" size={18} strokeWidth={1.8} />
        </button>
      </div>

      {loggedIn && (
        <button type="button" className="btn btn--ghost btn--block" style={{ marginTop: 14, color: 'var(--sec)', padding: 8 }} onClick={onLogout}>
          Выйти
        </button>
      )}

      {/* Отзыв согласия и удаление данных — право по 152-ФЗ и требование Google Play и App Store */}
      <button
        type="button"
        className="btn btn--ghost btn--block profile__delete"
        onClick={() => {
          const ok = window.confirm(
            'Удалить аккаунт и все данные? Будут удалены профиль, история заказов и избранное на этом устройстве, '
            + 'а согласие на обработку персональных данных — отозвано. Отменить действие нельзя.',
          );
          // Подписку снимаем первой: она отписывает браузер и убирает с сервера адрес
          // вместе с номером телефона — иначе после «удаления всех данных» уведомления
          // о заказе на этот номер продолжали бы приходить на удалённый профиль.
          if (ok) { void disablePush(); deleteAccount(); }
        }}
      >
        Удалить аккаунт и данные
      </button>

      <button
        type="button"
        className="profile__btn"
        style={{ marginTop: 28, textAlign: 'center', fontSize: 12, color: 'var(--sec)', letterSpacing: '.04em' }}
        onClick={() => go('staff')}
      >
        Режим персонала →
      </button>
    </div>
  );
}

/* ---------- «Мои заказы»: история заказов этого устройства ---------- */
function OrdersSub() {
  const orders = useStore(s => s.orders);
  const setProfileSub = useStore(s => s.setProfileSub);
  const go = useStore(s => s.go);
  const viewOrderNo = useStore(s => s.viewOrderNo);
  const repeatOrder = useStore(s => s.repeatOrder);

  const history: Order[] = orders.filter(o => o.mine).sort((a, b) => b.createdAt - a.createdAt);
  const openOrder = (no: number) => { viewOrderNo(no); go('status'); };

  return (
    <div className="screen screen--gutter">
      <div className="row gap-10">
        <BackButton onClick={() => appBack(() => setProfileSub(null))} />
        <h1 className="profile__sub-title">МОИ ЗАКАЗЫ</h1>
      </div>

      {history.length === 0 ? (
        <div className="empty" style={{ marginTop: 90 }}>
          <Crown width={64} strokeWidth={1} />
          <div className="empty__title" style={{ fontSize: 24 }}>Заказов пока нет</div>
        </div>
      ) : (
        history.map(o => (
          <div key={o.no} className="card card--pad mt-12 profile__hist">
            {/* внутри <button> — только span'ы (phrasing content); раскладка через классы/inline display */}
            <button type="button" className="profile__btn" onClick={() => openOrder(o.no)}>
              <span className="row between">
                <span style={{ font: '700 18px var(--f-head)' }}>№{o.no}</span>
                <span className={`badge badge--${o.status}`}>{STATUS_TEXT[o.status]}</span>
              </span>
              <span className="t-small" style={{ display: 'block', marginTop: 2 }}>
                {fmtDate(o.createdAt)}, {fmtTime(o.createdAt)} · {formatText(o)}
              </span>
              <span style={{ display: 'block', marginTop: 8, fontSize: 14, lineHeight: 1.4 }}>{itemsText(o)}</span>
            </button>
            <div className="row between" style={{ marginTop: 10 }}>
              <span style={{ font: '500 16px var(--f-body)', color: 'var(--price)' }}>{rub(o.total)}</span>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => repeatOrder(o.no)}>
                ПОВТОРИТЬ
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ---------- «Избранное»: блюда, отмеченные ♥ ---------- */
function FavsSub() {
  const favorites = useStore(s => s.favorites);
  const setProfileSub = useStore(s => s.setProfileSub);
  const openDish = useStore(s => s.openDish);

  const favList = Object.keys(favorites).filter(id => favorites[id]).map(id => ITEMS[id]).filter(Boolean);

  return (
    <div className="screen screen--gutter">
      <div className="row gap-10">
        <BackButton onClick={() => appBack(() => setProfileSub(null))} />
        <h1 className="profile__sub-title">ИЗБРАННОЕ</h1>
      </div>

      {favList.length === 0 ? (
        <div className="empty" style={{ marginTop: 90, gap: 12 }}>
          <Icon name="heart" size={56} strokeWidth={1} />
          <div className="empty__title" style={{ fontSize: 24 }}>Нажмите ♥ на блюде — оно появится здесь</div>
        </div>
      ) : (
        <div className="mt-12">
          {favList.map(it => (
            <button key={it.id} type="button" className="leader-row profile__btn" onClick={() => openDish(it.id, 0, 'profile')}>
              <span style={{ fontSize: 15 }}>{it.name}</span>
              <span className="leader" />
              <span className="t-price">{it.priceLabel}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
