import type { CSSProperties } from 'react';
import { ICON, type IconName } from '../data/menu';

interface IconProps {
  /** имя иконки из ICON или готовый path d */
  name?: IconName;
  d?: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  fill?: string;
  style?: CSSProperties;
  className?: string;
}

/** Контурная иконка 24×24 в стиле печатного меню (тонкий медный контур). */
export function Icon({ name, d, size = 22, color = 'var(--copper)', strokeWidth = 1.6, fill = 'none', style, className }: IconProps) {
  const path = d ?? (name ? ICON[name] : '');
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={fill} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style} className={className} aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/** Корона — тонкий медный контур (viewBox 24×14). */
export function Crown({ width = 24, color = 'var(--copper)', strokeWidth = 1.5, style, className }: { width?: number; color?: string; strokeWidth?: number; style?: CSSProperties; className?: string }) {
  const height = Math.round((width * 14) / 24);
  return (
    <svg viewBox="0 0 24 14" width={width} height={height} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" style={style} className={className} aria-hidden="true">
      <path d="M3 11L2 4l5 3.5L12 2l5 5.5L22 4l-1 7z" />
      <path d="M4 13.2h16" />
    </svg>
  );
}

/** «Скоростные» штрихи // около заголовков (viewBox 24×16). mirror — зеркально. */
export function SpeedStrokes({ width = 20, mirror = false, color = 'var(--copper)', style }: { width?: number; mirror?: boolean; color?: string; style?: CSSProperties }) {
  const height = Math.round((width * 16) / 24);
  return (
    <svg viewBox="0 0 24 16" width={width} height={height} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" style={{ transform: mirror ? 'scaleX(-1)' : undefined, ...style }} aria-hidden="true">
      <path d="M3 13L9 3M9 13l6-10M15 13l6-10" />
    </svg>
  );
}

/** Веточка с листиками для углов (viewBox 40×40). mirror — зеркально. */
export function Branch({ size = 46, mirror = false, style }: { size?: number; mirror?: boolean; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} fill="none" stroke="var(--copper)" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: .7, transform: mirror ? 'scaleX(-1)' : undefined, ...style }} aria-hidden="true">
      <path d="M4 36C8 20 18 10 36 4" />
      <path d="M12 24c-1-6 2-9 6-10 0 5-2 8-6 10zM20 15c-1-5 1-8 5-9 0 4-1 7-5 9zM9 31c-4 1-7-1-8-4 4-1 7 1 8 4zM15 22c-4 1-7-1-8-4 4-1 7 1 8 4z" />
    </svg>
  );
}
