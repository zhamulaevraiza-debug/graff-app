/**
 * Сведения об авторстве фотографий меню.
 *
 * photo-credits.json заполняет scripts/photos.mjs, когда снимки берутся из открытых каталогов.
 * Если кафе поставило собственную съёмку, запись из этого файла удаляется — и подпись
 * «фото иллюстративное» под карточкой, и документ «Фотографии» пропадают сами.
 */
import raw from './photo-credits.json';

export interface PhotoCredit {
  /** Что на снимке — как в списке слотов (scripts/photo-slots.mjs) */
  what: string;
  /** Идентификатор снимка в каталоге */
  id: string;
  title: string;
  author: string;
  /** Например, «CC BY 2.0» */
  license: string;
  licenseUrl: string;
  /** Страница снимка в каталоге */
  source: string;
}

const CREDITS = raw as Record<string, PhotoCredit>;

/** Снимок взят из открытого каталога, а не снят кафе. */
export const photoCredit = (slot: string): PhotoCredit | undefined => CREDITS[slot];

/** Список для документа «Фотографии»: один и тот же снимок в разных слотах показывается один раз. */
export const PHOTO_CREDITS: PhotoCredit[] = Object.values(CREDITS)
  .filter((c, i, all) => all.findIndex(x => x.id === c.id) === i);
