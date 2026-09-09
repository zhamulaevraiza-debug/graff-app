/**
 * Логотип GRAFF — обводка с фотографии вывески кафе (design/logo.jpg).
 *
 * Части лежат в одной системе координат снимка, поэтому их взаимное положение
 * (корона над «R», подпись под словом, отступ от знака) точно такое же, как на вывеске.
 * Сами контуры — в src/data/logo-paths.ts, они собираются скриптом, а не правятся руками.
 */
import { type CSSProperties } from 'react';
import {
  LOGO_MARK, LOGO_CROWN, LOGO_WORD, LOGO_TAGLINE, LOGO_RED, LOGO_BLACK, type LogoPart,
} from '../data/logo-paths';

/** Рамка, охватывающая весь знак: логотип целиком, как на вывеске. */
const FULL_BOX = '64 22 1163 395';
/** Корона, «GRAFF» и подпись без знака слева. */
const TEXT_BOX = '377 22 850 383';

const size = (box: string, height: number) => {
  const [, , w, h] = box.split(' ').map(Number);
  return { width: Math.round((height * w) / h), height };
};

const ALT = 'GRAFF — Fast & Delicious';

/** Знак — спиральная «G». Ширина считается от высоты, пропорции вывески сохраняются. */
export function Monogram({ size: h = 42, color = LOGO_RED, style }: { size?: number; color?: string; style?: CSSProperties }) {
  const box = size(LOGO_MARK.box, h);
  return (
    <svg viewBox={LOGO_MARK.box} {...box} role="img" aria-label="GRAFF" style={style}>
      <path d={LOGO_MARK.d} fill={color} fillRule="evenodd" />
    </svg>
  );
}

/** Корона, «GRAFF» и «FAST & DELICIOUS» — без знака. */
export function Wordmark({ height = 44, red = LOGO_RED, black = LOGO_BLACK, style }: { height?: number; red?: string; black?: string; style?: CSSProperties }) {
  return (
    <svg viewBox={TEXT_BOX} {...size(TEXT_BOX, height)} role="img" aria-label={ALT} style={style}>
      <Part part={LOGO_CROWN} fill={red} />
      <Part part={LOGO_WORD} fill={black} />
      <Part part={LOGO_TAGLINE} fill={black} />
    </svg>
  );
}

/** Одно слово «GRAFF» — для узких мест вроде шапки панели персонала. */
export function LogoWord({ height = 17, color = LOGO_BLACK, style }: { height?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg viewBox={LOGO_WORD.box} {...size(LOGO_WORD.box, height)} role="img" aria-label="GRAFF" style={style}>
      <path d={LOGO_WORD.d} fill={color} fillRule="evenodd" />
    </svg>
  );
}

/** Логотип целиком: знак, корона, «GRAFF» и подпись — как на вывеске. */
export function HeaderLogo({ height = 46, style }: { height?: number; style?: CSSProperties }) {
  return (
    <svg viewBox={FULL_BOX} {...size(FULL_BOX, height)} role="img" aria-label={ALT} style={style}>
      <Part part={LOGO_MARK} fill={LOGO_RED} />
      <Part part={LOGO_CROWN} fill={LOGO_RED} />
      <Part part={LOGO_WORD} fill={LOGO_BLACK} />
      <Part part={LOGO_TAGLINE} fill={LOGO_BLACK} />
    </svg>
  );
}

const Part = ({ part, fill }: { part: LogoPart; fill: string }) => (
  <path d={part.d} fill={fill} fillRule="evenodd" />
);
