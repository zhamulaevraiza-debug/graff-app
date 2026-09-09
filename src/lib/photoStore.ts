/**
 * Свои фотографии, выбранные владельцем прямо в приложении.
 *
 * Обычный путь — положить файл в public/photos (см. README там же): тогда снимок увидят все.
 * Но чтобы поставить своё фото было можно и без пересборки сайта, приложение разрешает выбрать
 * файл с устройства. Такой снимок хранится в этом браузере и виден только на этом устройстве —
 * этого хватает, чтобы показать приложение с настоящими фотографиями кафе.
 *
 * Снимок уменьшается до 900 px и пережимается в JPEG: в хранилище браузера всего несколько мегабайт,
 * а исходный кадр с телефона занял бы их целиком.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'graff-photos';
const MAX_SIDE = 900;
const QUALITY = 0.82;

type Photos = Record<string, string>;

let cache: Photos | null = null;
const listeners = new Set<() => void>();

function read(): Photos {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Photos) : {};
  } catch {
    // приватный режим или запрет на хранение — работаем без своих снимков
    cache = {};
  }
  return cache;
}

/** Бросает, если в хранилище браузера нет места: вызывающий показывает это пользователю. */
function write(next: Photos) {
  localStorage.setItem(KEY, JSON.stringify(next));
  cache = next;
  listeners.forEach(fn => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Уменьшает кадр и переводит его в JPEG-строку, которую можно подставить в src. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Браузер не смог обработать изображение');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', QUALITY);
}

/** Ставит свой снимок в слот. Бросает с понятным текстом, если файл не подошёл. */
export async function setOwnPhoto(slot: string, file: File): Promise<void> {
  if (!/^image\//.test(file.type)) throw new Error('Это не изображение');
  let dataUrl: string;
  try {
    dataUrl = await shrink(file);
  } catch {
    throw new Error('Не удалось прочитать изображение');
  }
  try {
    write({ ...read(), [slot]: dataUrl });
  } catch {
    throw new Error('В браузере не хватило места. Уберите одно из своих фото и попробуйте снова');
  }
}

export function clearOwnPhoto(slot: string): void {
  const next = { ...read() };
  delete next[slot];
  try {
    write(next);
  } catch {
    // удаление место только освобождает; если хранилище недоступно, показывать нечего
  }
}

export const ownPhoto = (slot: string): string | undefined => read()[slot];

/** Слоты, для которых владелец поставил свой снимок. */
export const ownPhotoSlots = (): string[] => Object.keys(read());

export function useOwnPhoto(slot: string): string | undefined {
  return useSyncExternalStore(subscribe, () => read()[slot], () => undefined);
}
