/**
 * Панель персонала (кухня): заказы и столики + настройки.
 * Прототип: design/GRAFF App.dc.html, секция isStaff (строки 528–596), логика staffOrders/staffZones.
 *
 * В боевом режиме панель открывается только после входа сотрудника (логин + PIN),
 * а блок настроек демонстрации не показывается: статусы ведёт кухня, время идёт по-настоящему.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useStore, selSpeed, LIVE, type Settings } from '../state/store';
import { hasStaffToken } from '../lib/api';
import { FORMATS, ZONES, STATUS_TEXT, ETA_CHOICES, type IconName } from '../data/menu';
import { MISSING_REQUISITES } from '../data/legal';
import { rub, fmtTime } from '../lib/format';
import { formatText, itemsText, minutesLeft, type Order } from '../lib/orders';
import { Monogram, LogoWord } from '../components/Logo';
import { Photo } from '../components/Photo';
import { setOwnPhoto, clearOwnPhoto, useOwnPhoto } from '../lib/photoStore';
import { photoCredit } from '../data/photos';
import { Icon } from '../components/Icon';
import './Staff.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/** Телефон в поле хранится уже в маске «+7 …»; перед форматированием убираем префикс, иначе «7» дублируется. */
const stripPrefix = (v: string) => (v.startsWith('+7') ? v.slice(2) : v);

/** Заказ закрыт: выдан или отменён — такие уходят вниз списка и показываются бледнее. */
const isClosed = (o: Order) => o.status === 'done' || o.status === 'cancelled';

function etaText(o: Order, now: number, speed: number): string {
  switch (o.status) {
    case 'accepted':
    case 'cooking': return `Готов через ~${minutesLeft(o, now, speed)} мин`;
    case 'ready': return 'Ждёт выдачи';
    case 'done': return 'Выдан ' + fmtTime(o.doneAt || o.createdAt);
    case 'cancelled': return 'Отменён';
    default: return 'Ожидает подтверждения';
  }
}

function whoText(o: Order): string {
  return (o.byPhone ? 'по звонку · ' : '') + (o.name || 'Гость') + (o.phone ? ' · ' + o.phone : '');
}

/** Шапка панели: логотип и место для кнопок справа. */
function StaffHead({ children }: { children?: ReactNode }) {
  return (
    <div className="row between">
      <div className="row gap-8">
        <Monogram size={30} />
        <div>
          <LogoWord height={16} style={{ display: 'block' }} />
          <div style={{ font: '600 8px var(--f-caps)', letterSpacing: '.28em', color: 'var(--sec)', marginTop: 3 }}>КУХНЯ · ПЕРСОНАЛ</div>
        </div>
      </div>
      {children}
    </div>
  );
}

/** Вход для персонала: показывается вместо панели, пока сотрудник не вошёл (только в боевом режиме). */
function StaffLogin() {
  const netError = useStore(s => s.netError);
  const staffLogin = useStore(s => s.staffLogin);
  const setNetError = useStore(s => s.setNetError);
  const go = useStore(s => s.go);

  const [login, setLogin] = useState('');
  const [pin, setPin] = useState('');
  // занятость только своя: чужой запрос не должен гасить кнопку входа
  const [sending, setSending] = useState(false);

  // netError общий на всё приложение: чужую ошибку (например, «Слишком часто» с экрана гостя)
  // гасим при открытии формы, иначе она читается как «не подошёл PIN»
  useEffect(() => { setNetError(null); }, [setNetError]);

  const ready = !sending && login.trim() !== '' && pin !== '';

  // ошибку прошлой попытки убираем, как только сотрудник начал править поля
  const clearErr = () => { if (netError) setNetError(null); };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ready) return;
    setSending(true);
    void staffLogin(login.trim(), pin)
      .then(ok => { if (!ok) setPin(''); })
      .finally(() => setSending(false));
  };

  return (
    <div className="screen screen--gutter screen--nonav">
      <StaffHead />

      <form className="card card--pad stack gap-10 mt-16" onSubmit={onSubmit} noValidate>
        <h2 className="t-head">ВХОД ДЛЯ ПЕРСОНАЛА</h2>
        <div className="t-sec">Панель кухни доступна сотрудникам кафе.</div>

        <input
          className="input input--white"
          placeholder="Логин"
          aria-label="Логин"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          enterKeyHint="next"
          value={login}
          onChange={e => { setLogin(e.target.value); clearErr(); }}
        />
        <input
          className={cx('input', 'input--white', netError && 'input--err')}
          type="password"
          placeholder="PIN"
          aria-label="PIN"
          inputMode="numeric"
          autoComplete="current-password"
          enterKeyHint="go"
          aria-invalid={netError ? true : undefined}
          value={pin}
          onChange={e => { setPin(e.target.value); clearErr(); }}
        />
        {netError && <div className="field-err" role="alert">{netError}</div>}

        <button type="submit" className="btn btn--primary btn--block" disabled={!ready}>{sending ? 'ВХОДИМ…' : 'ВОЙТИ'}</button>
        <button type="button" className="btn btn--ghost" onClick={() => go('home')}>← Клиент</button>
      </form>
    </div>
  );
}

export function Staff() {
  const now = useStore(s => s.now);
  const speed = useStore(selSpeed);
  const orders = useStore(s => s.orders);
  const occupied = useStore(s => s.occupied);
  const staffTab = useStore(s => s.staffTab);
  const staffForm = useStore(s => s.staffForm);
  const settings = useStore(s => s.settings);
  const busy = useStore(s => s.busy);
  const netError = useStore(s => s.netError);
  const online = useStore(s => s.online);
  const staffAuthed = useStore(s => s.staffAuthed);

  const go = useStore(s => s.go);
  const setStaffTab = useStore(s => s.setStaffTab);
  const toggleStaffForm = useStore(s => s.toggleStaffForm);
  const setStaffForm = useStore(s => s.setStaffForm);
  const submitStaffForm = useStore(s => s.submitStaffForm);
  const staffAccept = useStore(s => s.staffAccept);
  const setPending = useStore(s => s.setPending);
  const setStatus = useStore(s => s.setStatus);
  const bumpEta = useStore(s => s.bumpEta);
  const toggleOccupied = useStore(s => s.toggleOccupied);
  const setSetting = useStore(s => s.setSetting);
  const resetDemo = useStore(s => s.resetDemo);
  const staffLogout = useStore(s => s.staffLogout);

  const openCount = orders.filter(o => !isClosed(o)).length;
  const sorted = orders.slice().sort((a, b) => (Number(isClosed(a)) - Number(isClosed(b))) || (b.createdAt - a.createdAt));

  const actionFor = (o: Order): { label: string; onClick: () => void } | null => {
    switch (o.status) {
      case 'new': return { label: `ПРИНЯТЬ · ${o.pendingEta || 15} МИН`, onClick: () => staffAccept(o.no) };
      case 'accepted': return { label: 'ГОТОВИТСЯ', onClick: () => setStatus(o.no, 'cooking') };
      case 'cooking': return { label: 'ГОТОВ', onClick: () => setStatus(o.no, 'ready') };
      case 'ready': return { label: 'ВЫДАН', onClick: () => setStatus(o.no, 'done') };
      default: return null;
    }
  };

  const onReset = () => { if (window.confirm('Сбросить заказы, столики и корзину к демо-данным? Избранное останется.')) resetDemo(); };
  const flip = (key: 'autoKitchen' | 'fastTimer' | 'pushBanners' | 'heroPhotos') => () => setSetting(key, !settings[key]);

  // В боевом режиме кухня открыта только сотруднику. Одного staffAuthed мало: он переживает перезагрузку,
  // а токен смены стирается сам при ответе 401 — без проверки токена панель осталась бы открытой и нерабочей.
  if (LIVE && !(staffAuthed && hasStaffToken())) return <StaffLogin />;

  return (
    <div className="screen screen--gutter screen--nonav" style={{ paddingBottom: 60 }}>
      {/* шапка */}
      <StaffHead>
        <div className="row gap-12">
          <button type="button" className="btn btn--ghost" style={{ fontSize: 13, fontWeight: 500, padding: 0 }} onClick={() => go('home')}>← Клиент</button>
          {LIVE && (
            <button type="button" className="btn btn--ghost" style={{ fontSize: 13, fontWeight: 500, padding: 0 }} onClick={staffLogout}>Выйти</button>
          )}
        </div>
      </StaffHead>

      {/* связь с сервером: молча пропадать нельзя — статусы могут отставать */}
      {LIVE && !online && (
        <div className="card card--beige card--pad-sm mt-10 staff-offline" role="status">Нет связи с сервером, статусы могут отставать</div>
      )}

      {/* отказ сервера по последнему действию: иначе кнопка просто разблокируется и сотрудник жмёт снова */}
      {LIVE && netError && (
        <div className="card card--pad-sm mt-10 field-err staff-err" role="alert">{netError}</div>
      )}

      {/* вкладки */}
      <div className="row gap-8 mt-14" role="tablist">
        <button type="button" role="tab" aria-selected={staffTab === 'orders'} className={cx('staff-tab', staffTab === 'orders' && 'staff-tab--on')} onClick={() => setStaffTab('orders')}>
          ЗАКАЗЫ <span style={{ opacity: .8 }}>· {openCount}</span>
        </button>
        <button type="button" role="tab" aria-selected={staffTab === 'tables'} className={cx('staff-tab', staffTab === 'tables' && 'staff-tab--on')} onClick={() => setStaffTab('tables')}>
          СТОЛИКИ
        </button>
      </div>

      {/* ---------- ЗАКАЗЫ ---------- */}
      {staffTab === 'orders' && (
        <>
          <button type="button" className="btn btn--dashed btn--md btn--block mt-12" onClick={toggleStaffForm} aria-expanded={!!staffForm}>+ ЗАКАЗ ПО ЗВОНКУ</button>

          {staffForm && (
            <div className="card card--beige card--pad-sm stack gap-8 mt-10">
              <input
                className="input input--sm"
                placeholder="Телефон клиента"
                inputMode="tel"
                autoComplete="off"
                value={staffForm.phone}
                onChange={e => setStaffForm({ phone: stripPrefix(e.target.value) })}
              />
              <input
                className="input input--sm"
                placeholder="Что заказали (например: 2 бургера классических, фри)"
                autoComplete="off"
                value={staffForm.text}
                onChange={e => setStaffForm({ text: e.target.value })}
              />
              <div className="row gap-8">
                {FORMATS.map(f => (
                  <button
                    key={f.id}
                    type="button"
                    className={cx('chip', 'chip--sm', staffForm.format === f.id && 'chip--on')}
                    style={{ flex: 1 }}
                    aria-pressed={staffForm.format === f.id}
                    onClick={() => setStaffForm({ format: f.id })}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
              <div className="row gap-8">
                <input
                  className="input input--sm"
                  placeholder="Сумма, ₽"
                  inputMode="numeric"
                  autoComplete="off"
                  style={{ flex: 1, minWidth: 0 }}
                  value={staffForm.sum}
                  onChange={e => setStaffForm({ sum: e.target.value })}
                />
                {/* форма закрывается только после ответа сервера — без блокировки второй тап создаст дубль заказа */}
                <button type="button" className="btn btn--primary btn--md" style={{ flex: 1 }} disabled={busy} onClick={submitStaffForm}>ДОБАВИТЬ</button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--sec)' }}>Если у клиента есть профиль с этим номером — он увидит статус и время в приложении.</div>
            </div>
          )}

          {sorted.map(o => {
            const action = actionFor(o);
            const canBump = o.status === 'accepted' || o.status === 'cooking';
            return (
              <div key={o.no} className="card card--pad mt-12" style={{ opacity: isClosed(o) ? .55 : 1 }}>
                <div className="row between">
                  <div style={{ font: '700 20px var(--f-head)' }}>№{o.no}</div>
                  <span className={`badge badge--${o.status}`}>{STATUS_TEXT[o.status]}</span>
                </div>
                <div className="t-small" style={{ marginTop: 2 }}>{fmtTime(o.createdAt)} · {formatText(o)} · {whoText(o)}</div>
                <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.4 }}>{itemsText(o, true)}</div>
                {o.comment && <div style={{ marginTop: 4, fontSize: 13, color: 'var(--sec)', fontStyle: 'italic' }}>«{o.comment}»</div>}
                <div className="row between" style={{ marginTop: 6, fontSize: 14 }}>
                  <span style={{ color: 'var(--sec)' }}>{etaText(o, now, speed)}</span>
                  <span style={{ color: 'var(--price)', fontWeight: 500 }}>{rub(o.total)}</span>
                </div>

                {o.status === 'new' && (
                  <div className="row gap-6 mt-10">
                    {ETA_CHOICES.map(m => {
                      const on = (o.pendingEta || 15) === m;
                      return (
                        <button key={m} type="button" className={cx('chip', 'chip--sm', on && 'chip--on')} style={{ flex: 1 }} aria-pressed={on} onClick={() => setPending(o.no, m)}>
                          {m} мин
                        </button>
                      );
                    })}
                  </div>
                )}

                {action && (
                  <div className="row gap-8 mt-10">
                    <button type="button" className={cx('btn', 'btn--md', o.status === 'cooking' ? 'btn--green' : 'btn--primary')} style={{ flex: 1 }} disabled={busy} onClick={action.onClick}>
                      {action.label}
                    </button>
                    {canBump && (
                      <button type="button" className="btn btn--secondary btn--md staff-bump" disabled={busy} onClick={() => bumpEta(o.no)} aria-label={`Заказ №${o.no}: добавить 5 минут`}>+5 мин</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* ---------- СТОЛИКИ ---------- */}
      {staffTab === 'tables' && (
        <>
          <div style={{ marginTop: 14, fontSize: 13, color: 'var(--sec)' }}>Нажмите на столик, чтобы отметить занятость. Столики заказов освобождаются автоматически при выдаче.</div>
          {ZONES.map(zn => {
            const free = zn.tables.filter(n => !occupied[n]).length;
            return (
              <div key={zn.id} className="card card--beige card--pad-sm mt-14">
                <div className="row gap-6" style={{ font: '700 15px var(--f-body)', marginBottom: 8 }}>
                  <Icon d={zn.icon} size={18} />
                  {zn.name}
                  <span style={{ flex: 1 }} />
                  <span style={{ font: '400 13px var(--f-body)', color: 'var(--sec)' }}>свободно {free} из {zn.tables.length}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  {zn.tables.map(n => {
                    const occ = !!occupied[n];
                    const ord = orders.find(o => o.table === n && !isClosed(o));
                    const sub = ord ? '№' + ord.no : (occ ? 'занят' : 'свободен');
                    // занятость именно переключается: два быстрых тапа вернули бы столик в исходное состояние
                    return (
                      <button
                        key={n}
                        type="button"
                        className={cx('table-cell', 'table-cell--lg', 'staff-table', occ && 'table-cell--busy')}
                        aria-pressed={occ}
                        aria-label={`Столик ${n}: ${sub}`}
                        disabled={LIVE && busy}
                        onClick={() => toggleOccupied(n)}
                      >
                        {n}
                        <span className="table-cell__sub">{sub}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* ---------- ЧЕГО НЕ ХВАТАЕТ ПЕРЕД ПОКАЗОМ ---------- */}
      {/* Список пропадает сам, как только реквизиты заполнены в src/data/legal.ts. */}
      {MISSING_REQUISITES.length > 0 && (
        <>
          <div className="t-caps" style={{ marginTop: 24 }}>ЗАПОЛНИТЬ ПЕРЕД ПОКАЗОМ</div>
          <div className="staff-todo mt-8">
            <p className="staff-todo__text">
              Пока эти данные не внесены, гость видит вместо них квадратные скобки — в подтверждении
              заказа, в разделе «О нас» и в документах. Заполните их в файле <code>src/data/legal.ts</code>.
            </p>
            <ul className="staff-todo__list">
              {MISSING_REQUISITES.map(t => <li key={t}>{t}</li>)}
            </ul>
          </div>
        </>
      )}

      {/* ---------- ФОТОГРАФИИ КАФЕ ---------- */}
      {/* Эти снимки может дать только само кафе: витрина на главной и зал в разделе «О нас». */}
      <div className="t-caps" style={{ marginTop: 24 }}>ФОТОГРАФИИ КАФЕ</div>
      <div className="list mt-8">
        <SwitchRow
          title="Круглые фото в шапке"
          sub="два снимка по краям заголовка «Меню» на главной"
          on={settings.heroPhotos}
          onToggle={flip('heroPhotos')}
        />
        <OwnPhotoRow slot="hero-burger" title="Главная, слева" icon="burger" />
        <OwnPhotoRow slot="hero-fries" title="Главная, справа" icon="fries" />
        <OwnPhotoRow slot="about-hall" title="«О нас»: зал" icon="chair" />
        <OwnPhotoRow slot="about-terrace" title="«О нас»: терраса" icon="sun" />
        <OwnPhotoRow slot="about-map" title="«О нас»: карта" icon="pin" />
      </div>
      <p className="t-small mt-8">
        Выбранный здесь снимок хранится в этом браузере и виден только на этом устройстве. Чтобы фото
        увидели все гости, положите файл с тем же именем (например, <code>hero-burger.jpg</code>) в папку
        <code> public/photos</code> и соберите приложение заново — список имён лежит в README этой папки.
      </p>

      {/* ---------- НАСТРОЙКИ ---------- */}
      {/* кухня-автопилот, ускоренное время и сброс — только для демонстрации без сервера */}
      <div className="t-caps" style={{ marginTop: 24 }}>{LIVE ? 'НАСТРОЙКИ' : 'НАСТРОЙКИ ДЕМО'}</div>
      <div className="list mt-8">
        {!LIVE && <SwitchRow title="Кухня-автопилот" sub="заказы сами проходят статусы" on={settings.autoKitchen} onToggle={flip('autoKitchen')} />}
        {!LIVE && <SwitchRow title="Ускоренное время" sub="только для показа: минута проходит за 5 секунд" on={settings.fastTimer} onToggle={flip('fastTimer')} />}
        <SwitchRow title="Push-баннеры" on={settings.pushBanners} onToggle={flip('pushBanners')} />
        <div className="list__row list__row--static">
          <div className="list__grow">Заголовки экранов</div>
          <HeaderChip value="plate" current={settings.headerStyle} onPick={v => setSetting('headerStyle', v)}>Плашка</HeaderChip>
          <HeaderChip value="script" current={settings.headerStyle} onPick={v => setSetting('headerStyle', v)}>Рукописный</HeaderChip>
        </div>
      </div>
      {!LIVE && (
        <button type="button" className="btn btn--ghost btn--block mt-10" style={{ color: 'var(--sec)' }} onClick={onReset}>Сбросить демо-данные</button>
      )}
    </div>
  );
}

/** Строка выбора своего снимка для одного слота фотографии. */
function OwnPhotoRow({ slot, title, icon }: { slot: string; title: string; icon: IconName }) {
  const own = useOwnPhoto(slot);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setErr('');
    try {
      await setOwnPhoto(slot, file);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось поставить фото');
    }
  };

  return (
    <div className="list__row list__row--static">
      <Photo id={slot} shape="circle" width={40} height={40} placeholder={title} icon={icon} />
      <div className="list__grow">
        <div>{title}</div>
        <div className="list__sub">
          {own ? 'своё фото' : photoCredit(slot) ? 'снимок из каталога' : 'фото пока нет'}
        </div>
        {err && <div className="t-small" style={{ color: 'var(--price)' }}>{err}</div>}
      </div>
      <button type="button" className="chip chip--sm" onClick={() => input.current?.click()}>
        {own ? 'Заменить' : 'Выбрать'}
      </button>
      {own && (
        <button type="button" className="chip chip--sm" onClick={() => { setErr(''); clearOwnPhoto(slot); }}>Убрать</button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        aria-label={`Выбрать фото: ${title}`}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f); }}
      />
    </div>
  );
}

function SwitchRow({ title, sub, on, onToggle }: { title: string; sub?: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="list__row staff-switch" onClick={onToggle}>
      <div className="list__grow">
        <div>{title}</div>
        {sub && <div className="list__sub">{sub}</div>}
      </div>
      <span className={cx('toggle', on && 'toggle--on')} aria-hidden="true"><span className="toggle__knob" /></span>
    </button>
  );
}

function HeaderChip({ value, current, onPick, children }: { value: Settings['headerStyle']; current: Settings['headerStyle']; onPick: (v: Settings['headerStyle']) => void; children: ReactNode }) {
  const on = current === value;
  return (
    <button type="button" className={cx('chip', 'chip--sm', on && 'chip--on')} aria-pressed={on} onClick={() => onPick(value)}>{children}</button>
  );
}
