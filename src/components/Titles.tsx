import type { ReactNode, CSSProperties } from 'react';
import { Crown, Icon } from './Icon';
import { useStore } from '../state/store';
import { ICON, type IconName } from '../data/menu';

/** Заголовок-плашка как в печатном меню: иконка + ЗАГЛАВНЫЕ на бежевой плашке. icon — имя из ICON или path d. */
export function PlateTitle({ icon, children, peach = false, block = false, right }: { icon: IconName | string; children: ReactNode; peach?: boolean; block?: boolean; right?: ReactNode }) {
  const isName = icon in ICON;
  return (
    <div className={['plate', peach ? 'plate--peach' : '', block ? 'plate--block' : ''].join(' ').trim()}>
      {isName ? <Icon name={icon as IconName} size={block ? 22 : 20} /> : <Icon d={icon} size={block ? 22 : 20} />}
      <span className="plate__title">{children}</span>
      {right}
    </div>
  );
}

/** Рукописный медный заголовок с короной сверху (вариант «Рукописный»). */
export function ScriptTitle({ children, size = 34, crown = true }: { children: ReactNode; size?: number; crown?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1 }}>
      {crown && <Crown width={20} style={{ marginLeft: 8 }} />}
      <span style={{ font: `400 ${size}px var(--f-script)`, color: 'var(--copper)', lineHeight: 1 }}>{children}</span>
    </div>
  );
}

/**
 * Заголовок экрана: по настройке headerStyle — плашка (иконка + ЗАГЛАВНЫЕ) или рукописный.
 * plate — текст для плашки (обычно ЗАГЛАВНЫМИ), script — текст для рукописного варианта.
 */
export function ScreenTitle({ icon, plate, script, scriptSize = 36 }: { icon: IconName; plate: string; script: string; scriptSize?: number }) {
  const headerStyle = useStore(s => s.settings.headerStyle);
  return headerStyle === 'script' ? <ScriptTitle size={scriptSize}>{script}</ScriptTitle> : <PlateTitle icon={icon}>{plate}</PlateTitle>;
}

/** Круглая кнопка «назад» (бежевая) — для под-экранов профиля и «О нас». */
export function BackButton({ onClick, glass = false, label = 'Назад' }: { onClick: () => void; glass?: boolean; label?: string }) {
  return (
    <button type="button" className={['round-btn', glass ? 'round-btn--glass' : ''].join(' ').trim()} onClick={onClick} aria-label={label}>
      <Icon name="back" size={20} strokeWidth={1.8} />
    </button>
  );
}

/** Подзаголовок-«капс» (Oswald, разрядка) для секций формы. */
export function SectionLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="t-caps" style={{ margin: '20px 0 8px', ...style }}>{children}</div>;
}
