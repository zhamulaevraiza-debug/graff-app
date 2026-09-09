/**
 * Подбор фотографий блюд через Openverse — поиск по каталогам свободных снимков
 * (Flickr, StockSnap, Rawpixel, Nappy и другие).
 *
 * Зачем скрипт, а не просто папка с картинками: у каждого снимка есть автор и лицензия,
 * и это нужно хранить рядом с файлом. Берутся только лицензии CC0, «общественное достояние»
 * и CC BY — их можно использовать в коммерческом приложении и обрезать под карточку,
 * достаточно указать автора. Лицензии с «некоммерческим» и «без переработки» условиями,
 * а также CC BY-SA (требует распространять переработку на тех же условиях) не берём.
 * Сведения об авторстве попадают в src/data/photo-credits.json — из него собирается
 * документ «Фотографии» в разделе «Документы».
 *
 * Два режима:
 *   node scripts/photos.mjs --scan     собрать кандидатов и превью для отсмотра
 *   node scripts/photos.mjs            скачать выбранное в public/photos
 *
 * Выбор человека хранится в scripts/photo-picks.json: слот -> id снимка в Openverse.
 * Для слота без выбора берётся первый кандидат по оценке ниже.
 *
 * Когда у кафе появятся собственные снимки блюд, их достаточно положить в public/photos
 * с тем же именем файла; строку из photo-credits.json тогда надо удалить.
 *
 * У Openverse без ключа 20 запросов в минуту и 200 в сутки, поэтому ответы поиска
 * складываются в .photo-scan/api и повторный запуск их не тратит.
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SLOTS, NEW_COPIES } from './photo-slots.mjs';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('public/photos/', ROOT);
const CREDITS = new URL('src/data/photo-credits.json', ROOT);
const PICKS = new URL('photo-picks.json', import.meta.url);
const CACHE = new URL('.photo-scan/', ROOT);
const API_CACHE = new URL('.photo-scan/api/', ROOT);

const API = 'https://api.openverse.org/v1/images/';
const UA = 'GRAFF-cafe-app/1.0 (https://github.com/zhamulaevraiza-debug/graff-app; menu photos)';
/** Лицензии, при которых снимок можно поставить в приложение кафе и обрезать под карточку. */
const LICENSES = 'cc0,pdm,by';
/** Пауза между запросами: у Openverse без ключа 20 запросов в минуту. */
const PAUSE = 3300;

/* Чужие вывески и рисунки в карточке блюда не нужны. */
const BAD = new RegExp([
  'mcdonald', 'burger king', 'whopper', 'big mac', '\\bkfc\\b', 'wendy', 'subway', 'tim horton',
  'starbucks', 'domino', 'pizza hut', 'hardee', 'five guys', 'shake shack', 'jollibee', 'popeyes',
  'dunkin', 'chipotle', 'taco bell', 'coca.cola', 'pepsi',
  'illustration', 'sticker', 'clipart', 'clip art', 'vector', 'drawing', 'cartoon', 'psd',
  'collage', 'ripped paper', 'png\\b', 'logo', 'signage', 'storefront', 'billboard',
  'menu board', 'price list', 'advertisement', 'diagram', 'screenshot', 'meme',
  'raspberry pi', 'bottles', '\bbeer\b', 'vodka', '\bgin\b', '\brum\b', 'whisky', 'whiskey',
  '\bwine\b', 'liqueur', 'bourbon', 'champagne', 'brewery',
].join('|'), 'i');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

let requests = 0;

/** Поиск в Openverse с кэшем на диске: повторный запуск не тратит суточный лимит. */
async function search(query) {
  await mkdir(API_CACHE, { recursive: true });
  const file = new URL(`${hash(query)}.json`, API_CACHE);
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));

  const url = `${API}?${new URLSearchParams({
    q: query, license: LICENSES, page_size: '20', mature: 'false',
  })}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (requests++) await sleep(PAUSE);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) {
        const data = await res.json();
        await writeFile(file, JSON.stringify(data), 'utf8');
        return data;
      }
      if (res.status === 429) { await sleep(20000 * attempt); continue; }
      throw new Error(`Openverse: HTTP ${res.status}`);
    } catch (e) {
      // Обрыв связи — не повод терять всю выборку: ждём и пробуем ещё раз.
      if (attempt === 4) throw e;
      await sleep(5000 * attempt);
    }
  }
  throw new Error('Openverse не отвечает');
}

/** Годен ли снимок и насколько он похож на карточку меню. */
function rate(r, words) {
  if (!r?.url || !r.width || !r.height) return null;
  if (r.width < 500 || r.height < 380) return null;
  const ratio = r.width / r.height;
  if (ratio < 0.6 || ratio > 2.3) return null;

  const title = (r.title || '').trim();
  const tags = (r.tags || []).map(t => String(t.name || '').toLowerCase());
  if (BAD.test(title) || tags.some(t => BAD.test(t))) return null;

  /* Снимок должен быть про то, что ищем: слово из запроса в названии или в метках. */
  const t = title.toLowerCase();
  const inTitle = words.filter(w => t.includes(w)).length;
  const inTags = words.filter(w => tags.some(tag => tag.includes(w))).length;
  if (!inTitle && !inTags) return null;

  let score = 0;
  if (r.license === 'cc0' || r.license === 'pdm') score += 6;
  else score += 4;
  if (['stocksnap', 'nappy', 'rawpixel'].includes(r.source)) score += 3;
  if (ratio > 1.05 && ratio < 1.7) score += 4;      // близко к формату карточки
  else if (ratio >= 0.9 && ratio <= 1.05) score += 2;
  if (r.width >= 1000) score += 2;
  score += inTitle * 3 + inTags;

  /* Человекочитаемое название лицензии: «by» — это CC BY, «pdm» — знак общественного достояния. */
  const version = r.license_version ? ` ${r.license_version}` : '';
  const licenseName = r.license === 'cc0' ? `CC0${version}`
    : r.license === 'pdm' ? `Public Domain Mark${version}`
    : `CC ${r.license.toUpperCase()}${version}`;
  return {
    score, id: r.id, title: title || 'без названия', url: r.url,
    author: (r.creator || '').trim() || 'автор не указан',
    license: licenseName,
    licenseUrl: r.license_url || '',
    source: r.foreign_landing_url || '',
    provider: r.source || '',
    size: `${r.width}x${r.height}`,
  };
}

async function candidatesFor(slot) {
  const seen = new Set();
  const out = [];
  for (const q of slot.q) {
    const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const data = await search(q);
    for (const r of data.results || []) {
      if (seen.has(r.id)) continue;
      const c = rate(r, words);
      if (!c) continue;
      seen.add(r.id);
      out.push(c);
    }
    if (out.length >= 3) break;   // хватило по первому запросу — второй не тратим (лимит запросов)
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`скачивание: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 3000) throw new Error('файл подозрительно маленький');
  await writeFile(dest, buf);
  return buf.length;
}

const argv = process.argv.slice(2);
const only = argv.filter(a => !a.startsWith('--'));
const chosen = SLOTS.filter(s => (only.length ? only.includes(s.slot) : true));

/* --- режим отсмотра --- */
if (argv.includes('--scan')) {
  await mkdir(CACHE, { recursive: true });
  const indexFile = new URL('candidates.json', CACHE);
  const index = existsSync(indexFile) ? JSON.parse(await readFile(indexFile, 'utf8')) : {};
  const rescan = argv.includes('--force');
  for (const slot of chosen) {
    if (!rescan && index[slot.slot]?.candidates?.length) continue;   // уже собрано в прошлый заход
    try {
      const list = await candidatesFor(slot);
      index[slot.slot] = { what: slot.what, candidates: list };
      for (let i = 0; i < list.length; i++) {
        try { await download(list[i].url, new URL(`${slot.slot}--${i}.jpg`, CACHE)); }
        catch { list[i].broken = true; }
      }
      console.log(`  ${slot.slot}: ${list.length} — ${list.map(c => c.title).slice(0, 2).join(' | ')}`);
      await writeFile(indexFile, JSON.stringify(index, null, 2), 'utf8');
    } catch (e) {
      console.log(`  ! ${slot.slot} — ${e.message}`);
    }
  }
  console.log(`\nПревью в .photo-scan, список — .photo-scan/candidates.json (запросов к Openverse: ${requests})`);
  process.exit(0);
}

/* --- скачивание выбранного --- */
await mkdir(OUT, { recursive: true });
const force = argv.includes('--force');
let credits = existsSync(CREDITS) ? JSON.parse(await readFile(CREDITS, 'utf8')) : {};
const picks = existsSync(PICKS) ? JSON.parse(await readFile(PICKS, 'utf8')) : {};
const scanned = existsSync(new URL('candidates.json', CACHE))
  ? JSON.parse(await readFile(new URL('candidates.json', CACHE), 'utf8')) : {};

let done = 0, skipped = 0;
const failed = [];

for (const slot of chosen) {
  const dest = new URL(`${slot.slot}.jpg`, OUT);
  const wanted = picks[slot.slot];
  if (!force && existsSync(dest) && credits[slot.slot]?.id === wanted) { skipped++; continue; }

  const list = scanned[slot.slot]?.candidates?.length ? scanned[slot.slot].candidates : await candidatesFor(slot);
  const best = (wanted && list.find(c => c.id === wanted)) || list[0];
  if (!best) { failed.push(slot.slot); console.log(`  ? ${slot.slot} — снимок не найден`); continue; }

  try {
    const bytes = await download(best.url, dest);
    credits[slot.slot] = {
      what: slot.what, id: best.id, title: best.title, author: best.author,
      license: best.license, licenseUrl: best.licenseUrl, source: best.source,
    };
    done++;
    console.log(`  + ${slot.slot} <- ${best.title} (${best.license}, ${Math.round(bytes / 1024)} КБ)`);
  } catch (e) {
    failed.push(slot.slot);
    console.log(`  ! ${slot.slot} — ${e.message}`);
  }
}

/* Карусель новинок на главной показывает те же блюда — копируем файлы под её имена. */
for (const c of NEW_COPIES) {
  const from = new URL(`${c.from}.jpg`, OUT);
  if (!existsSync(from)) continue;
  await writeFile(new URL(`${c.to}.jpg`, OUT), await readFile(from));
  if (credits[c.from]) credits[c.to] = credits[c.from];
}

await writeFile(CREDITS, JSON.stringify(credits, null, 2) + '\n', 'utf8');
console.log(`\nСкачано ${done}, пропущено ${skipped}, без снимка ${failed.length}${failed.length ? ': ' + failed.join(', ') : ''}`);
