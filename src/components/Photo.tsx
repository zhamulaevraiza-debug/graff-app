import { useState, type CSSProperties } from 'react';
import { Icon } from './Icon';
import { type IconName } from '../data/menu';
import { useHasOwnPhoto, useOwnPhoto } from '../lib/photoStore';

interface PhotoProps {
  /** id слота: файл public/photos/<id>.jpg (или .png/.webp) подхватывается автоматически */
  id: string;
  /** Слот своего снимка, если он отличается от id: на главной новинки берут фото карточки блюда. */
  own?: string;
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
export function Photo({ id, own: ownId = id, placeholder = 'Фото', icon = 'burger', shape = 'rect', radius = 14, width = '100%', height = 120, style, className }: PhotoProps) {
  const [ext, setExt] = useState(0);
  // Свой снимок может не открыться (файл в хранилище повреждён) — тогда возвращаемся к public/photos.
  const [broken, setBroken] = useState<string | null>(null);
  // Снимок, выбранный владельцем на этом устройстве, важнее файла из public/photos.
  const own = useOwnPhoto(ownId);
  const ownSrc = own && own !== broken ? own : '';
  // Свой снимок читается из хранилища не мгновенно. Пока он в пути, файл из public не показываем:
  // иначе на долю секунды мелькнул бы снимок из каталога, который владелец как раз заменил.
  const waiting = useHasOwnPhoto(ownId) && !own;
  // Приложение может стоять в подпапке (GitHub Pages: /graff-app/), поэтому путь строится от базы сборки.
  const stock = ext < EXT.length ? `${import.meta.env.BASE_URL}photos/${id}.${EXT[ext]}` : '';
  const src = ownSrc || (waiting ? '' : stock);
  // Показывать нечего и ждать нечего: остаётся плейсхолдер.
  const failed = !src && !waiting;
  const iconSize = typeof height === 'number' ? Math.max(22, Math.min(44, Math.round(height * 0.3))) : 32;
  // В маленьком слоте (превью в панели персонала) подпись не помещается и обрезается — оставляем иконку.
  const showCaption = !!placeholder && (typeof height !== 'number' || height >= 80);
  return (
    <div
      className={['photo', shape === 'circle' ? 'photo--circle' : '', className || ''].join(' ').trim()}
      style={{ width, height, borderRadius: shape === 'circle' ? '50%' : radius, ...style }}
      role="img"
      aria-label={placeholder}
      data-photo-id={id}
    >
      {!!src && (
        <img
          className="photo__img"
          src={src}
          alt=""
          loading="lazy"
          // Расширение файла заранее не известно — перебираем jpg, png, webp.
          // Не открылся свой снимок — запоминаем это и уходим на файл из public/photos.
          onError={() => { if (ownSrc) setBroken(ownSrc); else setExt(e => e + 1); }}
          onLoad={e => { (e.currentTarget.parentElement as HTMLElement).dataset.loaded = '1'; }}
        />
      )}
      {failed && (
        <>
          <Icon name={icon} size={iconSize} strokeWidth={1.2} className="photo__icon" />
          {showCaption && <div className="photo__caption">{placeholder}</div>}
        </>
      )}
    </div>
  );
}
