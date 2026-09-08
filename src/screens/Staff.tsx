/**
 * Панель персонала (кухня): заказы и столики + настройки демо.
 * Прототип: design/GRAFF App.dc.html, секция isStaff (строки 528–596), логика staffOrders/staffZones.
 */
import type { ReactNode } from 'react';
import { useStore, selSpeed, type Settings } from '../state/store';
import { FORMATS, ZONES, STATUS_TEXT, ETA_CHOICES } from '../data/menu';
import { rub, fmtTime } from '../lib/format';
import { formatText, itemsText, minutesLeft, type Order } from '../lib/orders';
import { Monogram } from '../components/Logo';
import { Icon } from '../components/Icon';
import './Staff.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/** Телефон в поле хранится уже в маске «+7 …»; перед форматированием убираем префикс, иначе «7» дублируется. */
const stripPrefix = (v: string) => (v.startsWith('+7') ? v.slice(2) : v);

function etaText(o: Order, now: number, speed: number): string {
  switch (o.status) {
    case 'accepted':
    case 'cooking': return `Готов через ~${minutesLeft(o, now, speed)} мин`;
    case 'ready': return 'Ждёт выдачи';
    case 'done': return 'Выдан ' + fmtTime(o.doneAt || o.createdAt);
    default: return 'Ожидает подтверждения';
  }
}

function whoText(o: Order): string {
  return (o.byPhone ? 'по звонку · ' : '') + (o.name || 'Гость') + (o.phone ? ' · ' + o.phone : '');
}

export function Staff() {
  const now = useStore(s => s.now);
  const speed = useStore(selSpeed);
  const orders = useStore(s => s.orders);
  const occupied = useStore(s => s.occupied);
  const staffTab = useStore(s => s.staffTab);
  const staffForm = useStore(s => s.staffForm);
  const settings = useStore(s => s.settings);

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

  const openCount = orders.filter(o => o.status !== 'done').length;
  const sorted = orders.slice().sort((a, b) => (Number(a.status === 'done') - Number(b.status === 'done')) || (b.createdAt - a.createdAt));

  const actionFor = (o: Order): { label: string; onClick: () => void } | null => {
    switch (o.status) {
      case 'new': return { label: `ПРИНЯТЬ · ${o.pendingEta || 15} МИН`, onClick: () => staffAccept(o.no) };
      case 'accepted': return { label: 'ГОТОВИТСЯ', onClick: () => setStatus(o.no, 'cooking') };
      case 'cooking': return { label: 'ГОТОВ', onClick: () => setStatus(o.no, 'ready') };
      case 'ready': return { label: 'ВЫДАН', onClick: () => setStatus(o.no, 'done') };
      default: return null;
    }
  };

  const onReset = () => { if (window.confirm('Сбросить заказы и столики к демо-данным?')) resetDemo(); };
  const flip = (key: 'autoKitchen' | 'fastTimer' | 'pushBanners') => () => setSetting(key, !settings[key]);

  return (
    <div className="screen screen--gutter screen--nonav" style={{ paddingBottom: 60 }}>
      {/* шапка */}
      <div className="row between">
        <div className="row gap-8">
          <Monogram size={30} gradient={false} />
          <div>
            <div style={{ font: '900 17px/1 var(--f-logo)', color: 'var(--copper)' }}>GRAFF</div>
            <div style={{ font: '600 8px var(--f-caps)', letterSpacing: '.28em', color: 'var(--sec)', marginTop: 3 }}>КУХНЯ · ПЕРСОНАЛ</div>
          </div>
        </div>
        <button type="button" className="btn btn--ghost" style={{ fontSize: 13, fontWeight: 500, padding: 0 }} onClick={() => go('home')}>← Клиент</button>
      </div>

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
                <button type="button" className="btn btn--primary btn--md" style={{ flex: 1 }} onClick={submitStaffForm}>ДОБАВИТЬ</button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--sec)' }}>Если у клиента есть профиль с этим номером — он увидит статус и время в приложении.</div>
            </div>
          )}

          {sorted.map(o => {
            const action = actionFor(o);
            const canBump = o.status === 'accepted' || o.status === 'cooking';
            return (
              <div key={o.no} className="card card--pad mt-12" style={{ opacity: o.status === 'done' ? .55 : 1 }}>
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
                    <button type="button" className={cx('btn', 'btn--md', o.status === 'cooking' ? 'btn--green' : 'btn--primary')} style={{ flex: 1 }} onClick={action.onClick}>
                      {action.label}
                    </button>
                    {canBump && (
                      <button type="button" className="btn btn--secondary btn--md staff-bump" onClick={() => bumpEta(o.no)} aria-label={`Заказ №${o.no}: добавить 5 минут`}>+5 мин</button>
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
                    const ord = orders.find(o => o.table === n && o.status !== 'done');
                    const sub = ord ? '№' + ord.no : (occ ? 'занят' : 'свободен');
                    return (
                      <button
                        key={n}
                        type="button"
                        className={cx('table-cell', 'table-cell--lg', 'staff-table', occ && 'table-cell--busy')}
                        aria-pressed={occ}
                        aria-label={`Столик ${n}: ${sub}`}
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

      {/* ---------- НАСТРОЙКИ ДЕМО ---------- */}
      <div className="t-caps" style={{ marginTop: 24 }}>НАСТРОЙКИ ДЕМО</div>
      <div className="list mt-8">
        <SwitchRow title="Кухня-автопилот" sub="заказы сами проходят статусы" on={settings.autoKitchen} onToggle={flip('autoKitchen')} />
        <SwitchRow title="Ускоренное время" sub="1 мин = 5 с" on={settings.fastTimer} onToggle={flip('fastTimer')} />
        <SwitchRow title="Push-баннеры" on={settings.pushBanners} onToggle={flip('pushBanners')} />
        <div className="list__row list__row--static">
          <div className="list__grow">Заголовки экранов</div>
          <HeaderChip value="plate" current={settings.headerStyle} onPick={v => setSetting('headerStyle', v)}>Плашка</HeaderChip>
          <HeaderChip value="script" current={settings.headerStyle} onPick={v => setSetting('headerStyle', v)}>Рукописный</HeaderChip>
        </div>
      </div>
      <button type="button" className="btn btn--ghost btn--block mt-10" style={{ color: 'var(--sec)' }} onClick={onReset}>Сбросить демо-данные</button>
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
