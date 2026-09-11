import type { CSSProperties } from 'react';
import { Icon } from './Icon';
import { PROMISES } from '../data/menu';

/**
 * Полоса «три обещания бренда» из футера печатного меню.
 * variant: 'framed' — линии сверху и снизу (главная), 'footer' — линия сверху (низ меню / «О нас»).
 * full — полный текст третьего обещания («…Спасибо, что выбираете нас!»).
 */
export function Promises({ variant = 'framed', full = false, style }: { variant?: 'framed' | 'footer'; full?: boolean; style?: CSSProperties }) {
  return (
    <div className={['promises', variant === 'framed' ? 'promises--framed' : 'promises--footer'].join(' ')} style={style}>
      {PROMISES.map(p => (
        <div key={p.icon} className="promises__item">
          <Icon name={p.icon} size={22} color={p.color || 'var(--copper)'} />
          {full ? p.text : p.short}
        </div>
      ))}
    </div>
  );
}
