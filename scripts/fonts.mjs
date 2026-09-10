/**
 * Складывает шрифты в приложение, чтобы оно не ходило за ними к Google.
 *
 * Зачем: при загрузке с fonts.googleapis.com адрес каждого гостя уходит за границу —
 * для России это трансграничная передача, которую надо отдельно указывать в уведомлении
 * Роскомнадзору. Плюс сервер Google может быть недоступен, и тогда меню открывается
 * системным шрифтом. Свои файлы снимают и то и другое.
 *
 *   node scripts/fonts.mjs
 *
 * Кладёт woff2 в public/fonts и пишет туда же fonts.css с правилами @font-face.
 * Шрифты открытые (SIL Open Font License), их разрешено размещать у себя;
 * тексты лицензий и ссылки на источник — в public/fonts/README.md.
 */
import { writeFile, mkdir, readdir, rm } from 'node:fs/promises';

const OUT = new URL('../public/fonts/', import.meta.url);

/** Браузерный User-Agent обязателен: иначе Google отдаёт устаревший формат вместо woff2. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Что и в каких начертаниях используется в приложении (см. переменные --f-* в global.css). */
const FAMILIES = [
  'Playfair+Display:wght@900',
  'Montserrat:wght@500;600',
  'Marck+Script',
  'Oswald:wght@500;700',
  'Roboto+Condensed:wght@400;500;700',
  'Caveat:wght@500;600',
];

/** Нужны только эти наборы символов: приложение русское, латиница — для «GRAFF» и подписей. */
const KEEP = ['cyrillic', 'latin'];

const cssUrl = `https://fonts.googleapis.com/css2?${FAMILIES.map(f => 'family=' + f).join('&')}&display=swap`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Google рвёт соединение после нескольких файлов подряд — повторяем с паузой. */
async function get(url, what) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return res;
      if (res.status < 500 && res.status !== 429) throw new Error(`${what}: HTTP ${res.status}`);
    } catch (e) {
      if (attempt === 4) throw e;
    }
    await sleep(700 * attempt);
  }
  throw new Error(`${what}: не удалось скачать`);
}

const css = await get(cssUrl, 'список шрифтов').then(r => r.text());

/**
 * Ответ Google — набор блоков @font-face, перед каждым комментарий с названием набора символов.
 * Разбираем на части, чтобы оставить только нужные наборы и заменить ссылки на местные файлы.
 */
const blocks = [...css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)]
  .map(m => ({ subset: m[1], rule: m[2] }))
  .filter(b => KEEP.includes(b.subset));

if (!blocks.length) throw new Error('не нашёл ни одного @font-face — возможно, изменился формат ответа');

await mkdir(OUT, { recursive: true });
// Старые файлы убираем: иначе после смены набора шрифтов останется мусор.
for (const f of await readdir(OUT).catch(() => [])) {
  if (f.endsWith('.woff2')) await rm(new URL(f, OUT));
}

const out = [];
let downloaded = 0;

for (const { subset, rule } of blocks) {
  const family = /font-family:\s*'([^']+)'/.exec(rule)?.[1] ?? 'font';
  const weight = /font-weight:\s*(\d+)/.exec(rule)?.[1] ?? '400';
  const style = /font-style:\s*(\w+)/.exec(rule)?.[1] ?? 'normal';
  const src = /url\((https:[^)]+\.woff2)\)/.exec(rule)?.[1];
  if (!src) continue;

  const name = `${family.replace(/\s+/g, '')}-${weight}${style === 'italic' ? 'i' : ''}-${subset}.woff2`;
  const bytes = Buffer.from(await get(src, name).then(r => r.arrayBuffer()));
  await writeFile(new URL(name, OUT), bytes);
  downloaded++;

  out.push(
    rule
      .replace(/url\(https:[^)]+\)\s*format\('woff2'\)/, `url('./${name}') format('woff2')`)
      // Пока шрифт грузится, текст показывается системным, а не пропадает.
      // Google уже отдаёт font-display при display=swap — второй раз не добавляем.
      .replace(/@font-face\s*\{/, `/* ${family} ${weight} · ${subset} */\n@font-face {`
        + (/font-display/.test(rule) ? '' : '\n  font-display: swap;')),
  );
  console.log(`  + ${name} (${Math.round(bytes.length / 1024)} КБ)`);
  await sleep(120);
}

const header = `/*
 * Шрифты приложения. Файл создан scripts/fonts.mjs — руками не правят, а пересобирают.
 * Лежат рядом, чтобы приложение не обращалось к серверам Google: адрес гостя никуда
 * не уходит, и меню открывается своим шрифтом даже без доступа к внешним сервисам.
 * Лицензии и источник — в README.md этой папки.
 */
`;
await writeFile(new URL('fonts.css', OUT), header + out.join('\n\n') + '\n', 'utf8');
console.log(`\nГотово: ${downloaded} файлов, правил ${out.length}`);
