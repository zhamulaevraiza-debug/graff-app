/**
 * Экран «Статус заказа» — ключевой экран приложения.
 * Источник: design/GRAFF App.dc.html, секция isStatus (строки 393–446) и orderView() прототипа.
 * Нижняя навигация рендерится в App.
 */
import { useEffect } from 'react';
import { COMPANY } from '../data/legal';
import { useStore, selSpeed, selViewedOrder, LIVE } from '../state/store';
import { orderView, canRepeat } from '../lib/orders';
import { fmtDate, fmtTime } from '../lib/format';
import { Icon, Crown } from '../components/Icon';
import { TimerRing } from '../components/TimerRing';
import { CallButton } from '../components/CallButton';
import './Status.css';

export function Status() {
  // now — для обратного отсчёта (обновляется раз в секунду)
  const now = useStore(s => s.now);
  const speed = useStore(selSpeed);
  const orders = useStore(s => s.orders);
  const viewed = useStore(selViewedOrder);
  const go = useStore(s => s.go);
  const viewOrderNo = useStore(s => s.viewOrderNo);
  const repeatOrder = useStore(s => s.repeatOrder);
  // отменять заказ можно только из своего профиля: у гостя без входа нет токена для сервера
  const user = useStore(s => s.user);
  // номер показываемого заказа берём из стора (а не из viewed) — хук объявлен выше раннего выхода
  const viewOrder = useStore(s => s.viewOrder);
  // связь с сервером: отмена заказа, занятость и текст ошибки (в демонстрации всегда пусто)
  const cancelOrder = useStore(s => s.cancelOrder);
  const busy = useStore(s => s.busy);
  const netError = useStore(s => s.netError);
  const setNetError = useStore(s => s.setNetError);

  // netError общий на всё приложение: чужую ошибку (вход, панель персонала) и ответ по прошлому заказу
  // сбрасываем при открытии экрана и при переключении на другой заказ
  useEffect(() => { setNetError(null); }, [viewOrder, setNetError]);

  if (!viewed) {
    return (
      <div className="screen screen--gutter">
        <div className="empty" style={{ marginTop: 110 }}>
          <Crown width={80} strokeWidth={1} />
          <div className="empty__title">Заказов пока нет</div>
          <div className="t-sec t-pretty" style={{ maxWidth: 260 }}>
            Оформите заказ в приложении или по телефону — статус и время готовности появятся здесь.
          </div>
          <button
            type="button"
            className="btn btn--secondary"
            style={{ height: 48, padding: '0 28px', fontSize: 15, letterSpacing: '.08em' }}
            onClick={() => go('menu')}
          >
            К МЕНЮ
          </button>
        </div>
      </div>
    );
  }

  // активные заказы этого устройства — чипы переключения, если их больше одного
  // (выданные и отменённые заказы активными не считаем: из 'cancelled' заказ уже никуда не перейдёт)
  const activeMine = orders.filter(o => o.mine && o.status !== 'done' && o.status !== 'cancelled');
  const v = orderView(viewed, now, speed);
  const cancelled = v.status === 'cancelled';
  // отменить можно только свой заказ, только пока кухня не начала готовить
  // и только из профиля: сервер принимает отмену лишь с токеном входа по телефону
  const canCancel = LIVE && !!user && viewed.mine && (v.status === 'new' || v.status === 'accepted');
  const repeatable = canRepeat(viewed);
  const askCancel = () => {
    if (!window.confirm(`Отменить заказ №${viewed.no}?`)) return;
    void cancelOrder(viewed.no);
  };

  return (
    <div className="screen screen--gutter">
      {activeMine.length > 1 && (
        <div className="row" style={{ gap: 8, justifyContent: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          {activeMine.map(o => (
            <button
              key={o.no}
              type="button"
              className={`chip chip--sm${viewed.no === o.no ? ' chip--on' : ''}`}
              style={{ font: '700 13px var(--f-head)', padding: '5px 12px' }}
              onClick={() => viewOrderNo(o.no)}
              aria-pressed={viewed.no === o.no}
            >
              №{o.no}
            </button>
          ))}
        </div>
      )}

      <div className="t-center">
        <div className="t-caps" style={{ letterSpacing: '.16em' }}>{v.formatLabel}</div>
        <div style={{ font: '700 34px/1.1 var(--f-head)' }}>Заказ №{v.no}</div>
      </div>

      {cancelled ? (
        /* отменённому заказу таймер и шаги приготовления не нужны */
        <div className="status-cancelled">
          <div className="status-cancelled__title">Заказ отменён</div>
          <div className="status-cancelled__note">Если это ошибка, позвоните нам</div>
        </div>
      ) : (
        <>
          <TimerRing offset={v.ringOffset} color={v.ringColor} top={v.ringTop} main={v.ringMain} sub={v.ringSub} />

          <div className="t-center" style={{ marginTop: 12, font: '600 24px var(--f-hand)', color: 'var(--copper)' }}>
            {v.headline}
          </div>

          {/* пошаговый статус: Принят → Готовится → Готов → Выдан */}
          <div className="grid-4" style={{ gap: 0, marginTop: 16, position: 'relative' }} role="list" aria-label="Этапы заказа">
            <div aria-hidden="true" style={{ position: 'absolute', left: '13%', right: '13%', top: 19, borderTop: '2px dotted var(--line)' }} />
            {v.steps.map(st => (
              <div key={st.name} role="listitem" aria-current={st.current ? 'step' : undefined} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, position: 'relative' }}>
                <div
                  style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: st.bg, border: `1.5px solid ${st.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    animation: st.anim,
                  }}
                >
                  <Icon d={st.icon} size={20} color={st.fg} strokeWidth={1.8} />
                </div>
                <div style={{ fontSize: 12, color: st.textColor, fontWeight: st.weight }}>{st.name}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* состав заказа */}
      <div className="card card--beige card--pad stack gap-6" style={{ marginTop: 20 }}>
        {v.lines.map((l, i) => (
          <div key={i} className="leader-row" style={{ fontSize: 14 }}>
            <span>{l.qtyName}</span>
            <span className="leader" />
            <span style={{ color: 'var(--price)', fontWeight: 500 }}>{l.sumLabel}</span>
          </div>
        ))}
        <div className="leader-row" style={{ fontSize: 14, color: 'var(--sec)', marginTop: 4 }}>
          <span>{v.formatText}</span>
          <span className="leader" />
          <span>{v.payText}</span>
        </div>
        <div className="leader-row" style={{ font: '700 18px var(--f-head)', marginTop: 2 }}>
          <span>ИТОГО</span>
          <span className="leader" style={{ transform: 'translateY(-5px)' }} />
          <span style={{ color: 'var(--price)' }}>{v.totalLabel}</span>
        </div>
      </div>

      {/* кнопки без внутренних отступов, как в прототипе — иначе «ПОВТОРИТЬ ЗАКАЗ» переносится на 360–390px.
          У заказа по звонку строки рукописные: повторять нечего, остаётся один «Позвонить». */}
      <div className={repeatable ? 'grid-2 status-actions' : 'status-actions'} style={{ marginTop: 14 }}>
        <CallButton variant="secondary">ПОЗВОНИТЬ</CallButton>
        {repeatable && (
          <button
            type="button"
            className="btn btn--primary"
            style={{ height: 48, padding: '0 6px', fontSize: 15, letterSpacing: '.06em' }}
            onClick={() => repeatOrder(viewed.no)}
          >
            ПОВТОРИТЬ ЗАКАЗ
          </button>
        )}
      </div>

      {canCancel && (
        <button
          type="button"
          className="btn btn--ghost btn--block status-cancel"
          disabled={busy}
          onClick={askCancel}
        >
          Отменить заказ
        </button>
      )}

      {netError && <div className="field-err status-net-err" role="alert">{netError}</div>}

      {/* Подтверждение предварительного заказа: п. 14 Правил оказания услуг общественного питания */}
      <section className="status-doc" aria-label="Подтверждение предварительного заказа">
        <h2 className="t-caps">Подтверждение заказа</h2>
        <p className="status-doc__line">
          Предварительный заказ №{viewed.no} от {fmtDate(viewed.createdAt)}, {fmtTime(viewed.createdAt)}
        </p>
        <p className="status-doc__line">Исполнитель: {COMPANY.legalName}, ИНН {COMPANY.inn}</p>
        <p className="status-doc__line">Адрес: {COMPANY.address}</p>
        <p className="status-doc__line">Оплата и кассовый чек — при получении заказа в кафе.</p>
      </section>
    </div>
  );
}
