import { RING_LEN } from '../lib/orders';

/**
 * Таймер-кольцо статуса заказа: 220×220, r=96, длина окружности 603.2.
 * offset — из orderView().ringOffset; color — orderView().ringColor.
 */
export function TimerRing({ offset, color, top, main, sub }: { offset: string | number; color: string; top: string; main: string; sub: string }) {
  return (
    <div style={{ position: 'relative', width: 220, height: 220, margin: '16px auto 0' }}>
      <svg viewBox="0 0 220 220" width={220} height={220} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx="110" cy="110" r="96" fill="none" stroke="var(--card)" strokeWidth="14" />
        <circle cx="110" cy="110" r="96" fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" strokeDasharray={RING_LEN} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset .8s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 30 }}>
        <div style={{ fontSize: 13, color: 'var(--sec)' }}>{top}</div>
        <div style={{ font: '700 42px/1.05 var(--f-head)', color }}>{main}</div>
        <div style={{ fontSize: 13, color: 'var(--sec)', marginTop: 4 }}>{sub}</div>
      </div>
    </div>
  );
}
