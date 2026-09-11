import type { ReactNode } from 'react';
import { PHONE_DISPLAY, PHONE_TEL } from '../data/menu';
import { Icon } from './Icon';

/** Кнопка «ПОЗВОНИТЬ» (secondary или primary) — ссылка tel:. */
export function CallButton({ variant = 'secondary', children = 'Позвонить', className = '' }: { variant?: 'secondary' | 'primary'; children?: ReactNode; className?: string }) {
  return (
    <a href={PHONE_TEL} className={`btn btn--${variant} ${className}`.trim()} style={{ height: 48, fontSize: 15, letterSpacing: '.06em', borderRadius: 14, padding: '0 6px', color: variant === 'primary' ? '#fff' : 'var(--copper)' }}>
      {variant === 'secondary' && <Icon name="phone" size={18} strokeWidth={1.7} />}
      {children}
    </a>
  );
}

/** Строка «Или позвоните нам: +7 …» */
export function CallLine() {
  return (
    <div className="t-center t-sec" style={{ marginTop: 12 }}>
      Или позвоните нам: <a href={PHONE_TEL} style={{ color: 'var(--copper)', fontWeight: 500 }}>{PHONE_DISPLAY}</a>
    </div>
  );
}
