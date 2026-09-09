import { useState, type CSSProperties } from 'react';
import { Icon } from './Icon';
import { type IconName } from '../data/menu';

interface PhotoProps {
  /** id слота: файл public/photos/<id>.jpg (или .png/.webp) подхватывается автоматически */
  id: string;
  placeholder?: string;
  icon?: IconName;
  shape?: 'rect' | 'circle';
  radius?: number;
  width?: number | string;
  height?: number | string;
  style?: CSSProperties;
  className?: string;
}

const EXT = ['jpg', 'png', 'webp', 'jpeg'];

/**
 * Слот фотографии. В прототипе это был drag-and-drop слот; в приложении фото — статические файлы:
 * положите `public/photos/<id>.jpg` и оно появится вместо плейсхолдера (см. README).
 */
export function Photo({ id, placeholder = 'Фото', icon = 'burger', shape = 'rect', radius = 14, width = '100%', height = 120, style, className }: PhotoProps) {
  const [ext, setExt] = useState(0);
  const failed = ext >= EXT.length;
  // Приложение может стоять в подпапке (GitHub Pages: /graff-app/), поэтому путь строится от базы сборки.
  const src = failed ? '' : `${import.meta.env.BASE_URL}photos/${id}.${EXT[ext]}`;
  const iconSize = typeof height === 'number' ? Math.max(22, Math.min(44, Math.round(height * 0.3))) : 32;
  return (
    <div
      className={['photo', shape === 'circle' ? 'photo--circle' : '', className || ''].join(' ').trim()}
      style={{ width, height, borderRadius: shape === 'circle' ? '50%' : radius, ...style }}
      role="img"
      aria-label={placeholder}
      data-photo-id={id}
    >
      {!failed && (
        <img className="photo__img" src={src} alt="" loading="lazy" onError={() => setExt(e => e + 1)} onLoad={e => { (e.currentTarget.parentElement as HTMLElement).dataset.loaded = '1'; }} />
      )}
      {failed && (
        <>
          <Icon name={icon} size={iconSize} strokeWidth={1.2} className="photo__icon" />
          {placeholder && <div className="photo__caption">{placeholder}</div>}
        </>
      )}
    </div>
  );
}
