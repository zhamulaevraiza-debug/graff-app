import { useId, type CSSProperties } from 'react';
import { Crown } from './Icon';

/** Медная монограмма «G» — спираль с тонкой горизонтальной линией (viewBox 48×48). */
export function Monogram({ size = 42, gradient = true, color = 'var(--copper)', strokeWidth = 3.6, style }: { size?: number; gradient?: boolean; color?: string; strokeWidth?: number; style?: CSSProperties }) {
  const id = useId();
  const stroke = gradient ? `url(#${id})` : color;
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} fill="none" strokeLinecap="round" style={style} aria-label="GRAFF">
      {gradient && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#B8622B" />
            <stop offset="1" stopColor="#D08A4E" />
          </linearGradient>
        </defs>
      )}
      <path d="M34.5 11.5A16 16 0 1 0 40 27" stroke={stroke} strokeWidth={strokeWidth} />
      <path d="M40 27a8 8 0 0 0-8-8" stroke={stroke} strokeWidth={strokeWidth} />
      <path d="M25 27h15" stroke={stroke} strokeWidth={strokeWidth * 0.44} />
    </svg>
  );
}

/** Словесный знак: корона над GRAFF и «FAST & DELICIOUS» под ним. */
export function Wordmark({ size = 22, crown = true, align = 'center', style }: { size?: number; crown?: boolean; align?: 'center' | 'flex-start'; style?: CSSProperties }) {
  const fd = Math.max(6, Math.round(size * 0.32));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, ...style }}>
      {crown && <Crown width={Math.round(size * 0.73)} strokeWidth={1.6} />}
      <div style={{ font: `900 ${size}px var(--f-logo)`, color: 'var(--copper)', letterSpacing: '.02em', lineHeight: 1 }}>GRAFF</div>
      <div style={{ font: `600 ${fd}px var(--f-caps)`, letterSpacing: '.3em', color: 'var(--sec)', marginTop: Math.round(size * 0.14), whiteSpace: 'nowrap' }}>FAST &amp; DELICIOUS</div>
    </div>
  );
}

/** Логотип шапки: монограмма + словесный знак в ряд (как на главной). */
export function HeaderLogo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Monogram size={42} />
      <Wordmark size={22} />
    </div>
  );
}
