/**
 * Свои фотографии, выбранные владельцем прямо в приложении.
 *
 * Обычный путь — положить файл в public/photos (см. README там же): тогда снимок увидят все
 * гости на всех устройствах. Но снимать блюда удобнее телефоном, поэтому фото можно выбрать
 * прямо в панели персонала. Такой снимок хранится в этом браузере и виден только здесь —
 * этого хватает, чтобы показать приложение с настоящими фотографиями кафе.
 *
 * Хранилище — IndexedDB, а не localStorage: в приложении под сотню слотов (каждое блюдо,
 * каждый раздел), а localStorage вмещает всего несколько мегабайт и переполнился бы
 * на трёх десятках снимков. Снимки лежат файлами (Blob), а не строками base64,
 * которые занимают на треть больше.
 *
 * Каждый кадр уменьшается до 900 px и пережимается в JPEG: исходный снимок с телефона
 * весит несколько мегабайт, а в карточке всё равно показывается маленьким.
 */
import { useEffect, useSyncExternalStore } from 'react';

const DB_NAME = 'graff-photos';
const STORE = 'photos';
/** Ключ старого хранилища: снимки оттуда переносятся при первом запуске. */
const OLD_KEY = 'graff-photos';
/**
 * Список слотов со своим снимком — в localStorage, потому что он читается сразу,
 * без ожидания. Благодаря этому карточка с самого первого кадра знает, что снимок
 * будет заменён, и не показывает на миг старый файл из public/photos.
 */
const INDEX_KEY = 'graff-photo-slots';
const MAX_SIDE = 900;
const QUALITY = 0.82;

const NO_STORAGE = 'Браузер не разрешает хранить файлы. Проверьте настройки приватности';
const BAD_STORAGE = 'Хранилище браузера недоступно';

/** Слоты, для которых снимок есть. */
const keys = new Set<string>(readIndex());
/** Готовые адреса картинок по слотам. Заполняется по мере показа. */
const urls = new Map<string, string>();
/** Слоты, снимок которых уже запрошен: без этого один слот грузился бы много раз. */
const loading = new Set<string>();
/**
 * Слоты, снимок которых в этот раз достать не удалось. Такой слот показывает файл из
 * public/photos — лучше снимок из каталога, чем пустое место. Из списка keys он при этом
 * не пропадает: если хранилище просто не ответило, снимок цел и вернётся после перезагрузки.
 */
const missing = new Set<string>();

const listeners = new Set<() => void>();
const notify = () => listeners.forEach(fn => fn());

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const list: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) ? list.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveIndex() {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify([...keys]));
  } catch { /* приватный режим — список восстановится из самого хранилища */ }
}

/* ---------- IndexedDB ---------- */

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  // Соединение может закрыться под нами: другая вкладка обновила базу, браузер освободил место.
  // Тогда забываем его, чтобы следующий запрос открыл базу заново, а не падал до перезагрузки.
  const opened: Promise<IDBDatabase | null> = new Promise(resolve => {
    const drop = () => { if (dbPromise === opened) dbPromise = null; };
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      // приватный режим или запрет на хранение — работаем без своих снимков
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); drop(); };
      db.onclose = drop;
      resolve(db);
    };
    req.onerror = () => { drop(); resolve(null); };
    req.onblocked = () => { drop(); resolve(null); };
  });
  dbPromise = opened;
  return opened;
}

/** Чтение. Отказ означает «хранилище не ответило» — это не то же самое, что «снимка нет». */
function read<T>(fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => {
    if (!db) throw new Error(NO_STORAGE);
    return new Promise<T>((resolve, reject) => {
      let req: IDBRequest<T>;
      try {
        req = fn(db.transaction(STORE, 'readonly').objectStore(STORE));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(BAD_STORAGE));
        return;
      }
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error(BAD_STORAGE));
    });
  });
}

/**
 * Запись. Успехом считается завершённая транзакция, а не выполненный запрос:
 * место может кончиться уже при сохранении на диск, и тогда запрос успеет отчитаться об успехе,
 * а транзакция всё равно откатится. Без ожидания завершения приложение сказало бы «готово»
 * там, где снимок не сохранился.
 */
function write(fn: (store: IDBObjectStore) => void): Promise<void> {
  return openDb().then(db => {
    if (!db) throw new Error(NO_STORAGE);
    return new Promise<void>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE, 'readwrite');
        fn(tx.objectStore(STORE));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(BAD_STORAGE));
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error(BAD_STORAGE));
      tx.onerror = () => reject(tx.error ?? new Error(BAD_STORAGE));
    });
  });
}

/* ---------- перенос из старого хранилища ---------- */

/**
 * Раньше снимки лежали в localStorage строками base64. Переносим их и освобождаем место:
 * иначе они остались бы висеть мёртвым грузом в хранилище, которого и так мало.
 * Старую запись стираем только когда перенеслось всё: если база не открылась,
 * единственная копия снимков — как раз эта запись.
 */
async function migrateFromLocalStorage() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(OLD_KEY);
  } catch {
    return;
  }
  if (!raw) return;

  let old: Record<string, string>;
  try {
    old = JSON.parse(raw) as Record<string, string>;
  } catch {
    // испорченная запись: переносить нечего, но и держать её незачем
    try { localStorage.removeItem(OLD_KEY); } catch { /* нечего чистить */ }
    return;
  }

  let moved = 0;
  const all = Object.entries(old);
  for (const [slot, dataUrl] of all) {
    const blob = await fetch(dataUrl).then(r => r.blob()).catch(() => null);
    if (!blob) { moved++; continue; } // мусорная строка: переносить нечего, и держать её незачем
    const ok = await write(s => { s.put(blob, slot); }).then(() => true, () => false);
    if (ok) moved++;
  }
  if (moved < all.length) return;
  try { localStorage.removeItem(OLD_KEY); } catch { /* нечего чистить */ }
}

/* ---------- загрузка ---------- */

let ready: Promise<void> | null = null;

/**
 * Сверяет быстрый список слотов с самим хранилищем. Тела снимков подгружаются позже, по одному.
 * Правда — в хранилище: браузер мог очистить его сам (нехватка места, настройки приватности),
 * и тогда список нужно сократить, иначе карточка будет вечно ждать снимок, которого нет.
 * Если хранилище не ответило, список оставляем как есть: пустой ответ и молчание — разные вещи.
 */
function loadKeys(): Promise<void> {
  if (ready) return ready;
  ready = migrateFromLocalStorage()
    .then(() => read<IDBValidKey[]>(s => s.getAllKeys()))
    .then(list => {
      const real = new Set(list.filter((k): k is string => typeof k === 'string'));
      if (real.size === keys.size && [...real].every(k => keys.has(k))) return;
      for (const slot of [...keys]) if (!real.has(slot)) { forget(slot); missing.delete(slot); }
      keys.clear();
      real.forEach(k => keys.add(k));
      saveIndex();
      notify();
    })
    .catch(() => undefined);
  return ready;
}
void loadKeys();

/**
 * Достаёт снимок слота и превращает его в адрес для src. Повторные вызовы бесплатны.
 *
 * Если снимок не достался, слот помечается как недоступный и карточка показывает файл из
 * public/photos: пустое место на его месте выглядело бы поломкой. Из списка слот убираем только
 * когда хранилище прямо ответило «такого ключа нет» — молчание хранилища снимок не отменяет.
 */
async function ensureLoaded(slot: string) {
  if (!slot || urls.has(slot) || loading.has(slot)) return;
  await loadKeys();
  if (!keys.has(slot) || urls.has(slot) || loading.has(slot)) return;
  loading.add(slot);
  let blob: Blob | undefined;
  let answered = true;
  try {
    blob = await read<Blob | undefined>(s => s.get(slot));
  } catch {
    answered = false;
  }
  loading.delete(slot);
  if (blob) {
    // Пока читали, владелец мог поставить сюда новый снимок: он новее, наш ответ уже не нужен.
    if (!urls.has(slot)) {
      urls.set(slot, URL.createObjectURL(blob));
      missing.delete(slot);
      notify();
    }
    return;
  }
  missing.add(slot);
  // urls занят — значит, пока мы читали, владелец поставил сюда новый снимок: он и остаётся.
  if (answered && !urls.has(slot)) {
    keys.delete(slot);
    saveIndex();
  }
  notify();
}

function forget(slot: string) {
  const url = urls.get(slot);
  if (url) {
    URL.revokeObjectURL(url);
    urls.delete(slot);
  }
}

/* ---------- изменение ---------- */

/** Уменьшает кадр и пережимает в JPEG. */
async function shrink(file: File): Promise<Blob> {
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
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  if (!blob) throw new Error('Браузер не смог обработать изображение');
  return blob;
}

/** Ставит свой снимок в слот. Бросает с понятным текстом, если файл не подошёл или нет места. */
export async function setOwnPhoto(slot: string, file: File): Promise<void> {
  if (!/^image\//.test(file.type)) throw new Error('Это не изображение');
  let blob: Blob;
  try {
    blob = await shrink(file);
  } catch {
    throw new Error('Не удалось прочитать изображение');
  }
  try {
    await write(s => { s.put(blob, slot); });
  } catch (e) {
    // Чаще всего это переполнение: у браузера на сайт свой предел, и он не всегда большой.
    const quota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'ConstraintError');
    throw new Error(quota
      ? 'В браузере не хватило места. Уберите несколько своих фото и попробуйте снова'
      : e instanceof Error ? e.message : 'Не удалось сохранить фото');
  }
  forget(slot);
  keys.add(slot);
  missing.delete(slot);
  saveIndex();
  urls.set(slot, URL.createObjectURL(blob));
  notify();
}

export async function clearOwnPhoto(slot: string): Promise<void> {
  await write(s => { s.delete(slot); });
  forget(slot);
  keys.delete(slot);
  missing.delete(slot);
  saveIndex();
  notify();
}

/** Убирает все свои снимки разом: слотов под сотню, по одному это долго. */
export async function clearAllOwnPhotos(): Promise<void> {
  await write(s => { s.clear(); });
  // Старая запись переживает очистку базы и при следующем запуске вернула бы снимки обратно.
  try { localStorage.removeItem(OLD_KEY); } catch { /* нечего чистить */ }
  for (const slot of [...keys]) forget(slot);
  keys.clear();
  missing.clear();
  saveIndex();
  notify();
}

/* ---------- чтение из экранов ---------- */

/** Адрес своего снимка для слота; undefined — своего снимка нет или он ещё читается. */
export function useOwnPhoto(slot: string): string | undefined {
  const url = useSyncExternalStore(subscribe, () => urls.get(slot), () => undefined);
  // Читаем в эффекте, а не в getSnapshot: тот обязан быть чистым и быстрым.
  useEffect(() => { void ensureLoaded(slot); }, [slot]);
  return url;
}

/**
 * Ждать ли для слота свой снимок. Сам файл не читает — годится для длинных списков.
 * Недоступный снимок считается отсутствующим: карточка покажет файл из public/photos.
 */
export function useHasOwnPhoto(slot: string): boolean {
  return useSyncExternalStore(subscribe, () => keys.has(slot) && !missing.has(slot), () => false);
}

/** Сколько всего своих снимков поставлено. */
export function useOwnPhotoCount(): number {
  return useSyncExternalStore(subscribe, () => keys.size, () => 0);
}
