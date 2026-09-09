/**
 * Обводит логотип с фотографии вывески кафе (design/logo.jpg) в векторные контуры.
 *
 * Порядок: пиксели -> маска нужного цвета -> чистка мелкого мусора ->
 * marching squares (границы) -> упрощение Рамера—Дугласа—Пойкера -> кривые.
 *
 * Node сам не читает JPEG, поэтому пиксели сначала выгружает PowerShell:
 *
 *   powershell -ExecutionPolicy Bypass -File scripts/logo-dump.ps1 -Src design/logo.jpg -Out logo.raw
 *   node scripts/logo-trace.mjs logo.raw logo.svg src/data/logo-paths.ts
 *   powershell -ExecutionPolicy Bypass -File scripts/logo-icons.ps1
 *
 * Размеры снимка заданы ниже константами: если появится другая фотография,
 * их надо взять из вывода logo-dump.ps1 (ширина, высота, длина строки).
 * Когда кафе даст логотип в векторе, всё это не нужно — контуры просто заменяются.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const W = 1319, H = 422, STRIDE = 5276;
const buf = readFileSync(process.argv[2]);
const px = (x, y) => {
  const i = y * STRIDE + x * 4;
  return { b: buf[i], g: buf[i + 1], r: buf[i + 2] };
};

/* ---------- маски ---------- */

/** Тёмно-красный знак: красный заметно выше зелёного и синего. */
const isRed = (p) => p.r - p.g > 40 && p.r - p.b > 32 && p.g < 120 && p.r < 210;
/** Чёрные буквы: всё тёмное и без красного отлива. */
const isBlack = (p) => p.r < 90 && p.g < 90 && p.b < 90 && p.r - p.g < 30;

function mask(test, x0, y0, x1, y1) {
  const m = new Uint8Array(W * H);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) if (test(px(x, y))) m[y * W + x] = 1;
  }
  return m;
}

/** Убирает пятна меньше min пикселей — крапины от сжатия фотографии. */
function despeckle(m, min) {
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || seen[i]) continue;
    let top = 0, n = 0;
    stack[top++] = i; seen[i] = 1;
    const cells = [];
    while (top) {
      const c = stack[--top];
      cells.push(c); n++;
      const x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (m[j] && !seen[j]) { seen[j] = 1; stack[top++] = j; }
      }
    }
    if (n < min) for (const c of cells) m[c] = 0;
  }
  return m;
}

/** Затягивает дырки меньше min пикселей — блики на краске. */
function fillHoles(m, min) {
  const inv = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) inv[i] = m[i] ? 0 : 1;
  // всё, что связано с краем, — это фон, его не трогаем
  const seen = new Uint8Array(m.length);
  const stack = [];
  for (let x = 0; x < W; x++) { stack.push(x); stack.push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { stack.push(y * W); stack.push(y * W + W - 1); }
  while (stack.length) {
    const c = stack.pop();
    if (!inv[c] || seen[c]) continue;
    seen[c] = 1;
    const x = c % W, y = (c / W) | 0;
    if (x > 0) stack.push(c - 1);
    if (x < W - 1) stack.push(c + 1);
    if (y > 0) stack.push(c - W);
    if (y < H - 1) stack.push(c + W);
  }
  // оставшиеся пустоты — внутренние; мелкие закрашиваем
  const seen2 = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) {
    if (!inv[i] || seen[i] || seen2[i]) continue;
    const cells = [];
    const st = [i]; seen2[i] = 1;
    while (st.length) {
      const c = st.pop();
      cells.push(c);
      const x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (inv[j] && !seen[j] && !seen2[j]) { seen2[j] = 1; st.push(j); }
      }
    }
    if (cells.length < min) for (const c of cells) m[c] = 1;
  }
  return m;
}

/** Сглаживает края маски: снимает зазубрины от сжатия фотографии. */
function smoothMask(m, passes = 2) {
  for (let k = 0; k < passes; k++) {
    const src = m.slice();
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            n += src[(y + dy) * W + (x + dx)];
          }
        }
        const i = y * W + x;
        if (src[i] && n <= 2) m[i] = 0;
        else if (!src[i] && n >= 6) m[i] = 1;
      }
    }
  }
  return m;
}

/* ---------- границы: marching squares ---------- */

const KEY = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

function contours(m) {
  const get = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : m[y * W + x]);
  const segs = [];
  for (let y = -1; y < H; y++) {
    for (let x = -1; x < W; x++) {
      const tl = get(x, y), tr = get(x + 1, y), br = get(x + 1, y + 1), bl = get(x, y + 1);
      const c = tl * 8 + tr * 4 + br * 2 + bl;
      if (c === 0 || c === 15) continue;
      // середины сторон ячейки; координаты — в пикселях исходного снимка
      const T = [x + 0.5, y], R = [x + 1, y + 0.5], B = [x + 0.5, y + 1], L = [x, y + 0.5];
      const add = (a, b) => segs.push([a, b]);
      switch (c) {
        case 1: case 14: add(L, B); break;
        case 2: case 13: add(B, R); break;
        case 3: case 12: add(L, R); break;
        case 4: case 11: add(T, R); break;
        case 6: case 9: add(T, B); break;
        case 7: case 8: add(L, T); break;
        case 5: add(L, T); add(B, R); break;
        case 10: add(L, B); add(T, R); break;
      }
    }
  }
  // сшиваем отрезки в замкнутые контуры
  const byPoint = new Map();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = KEY(p);
      if (!byPoint.has(k)) byPoint.set(k, []);
      byPoint.get(k).push(i);
    }
  });
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop = [segs[i][0], segs[i][1]];
    for (;;) {
      const k = KEY(loop[loop.length - 1]);
      const next = (byPoint.get(k) || []).find(j => !used[j]);
      if (next === undefined) break;
      used[next] = 1;
      const [a, b] = segs[next];
      loop.push(KEY(a) === k ? b : a);
    }
    if (loop.length > 8) loops.push(loop);
  }
  if (process.env.TRACE_DEBUG) console.log('  отрезков', segs.length, 'контуров', loops.length, 'самый длинный', Math.max(0, ...loops.map(l => l.length)));
  return loops;
}

/* ---------- упрощение ---------- */

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const dist = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1e-9;
    return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
  };
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let far = -1, best = eps;
    for (let i = a + 1; i < b; i++) {
      const d = dist(pts[i], pts[a], pts[b]);
      if (d > best) { best = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/* ---------- вывод ---------- */

const num = (v) => (Math.round(v * 10) / 10).toString();

/**
 * Упрощение замкнутого контура. Напрямую Рамер—Дуглас—Пойкер здесь не работает:
 * начало и конец совпадают, отрезок между ними вырожденный, и всё схлопывается в две точки.
 * Поэтому режем контур на две дуги между самыми удалёнными друг от друга точками.
 */
function simplifyClosed(pts, eps) {
  const p = pts.slice();
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  while (p.length > 1 && same(p[0], p[p.length - 1])) p.pop();
  if (p.length < 6) return p;
  let far = 0, best = -1;
  for (let i = 1; i < p.length; i++) {
    const d = (p[i][0] - p[0][0]) ** 2 + (p[i][1] - p[0][1]) ** 2;
    if (d > best) { best = d; far = i; }
  }
  const head = rdp(p.slice(0, far + 1), eps);
  const tail = rdp(p.slice(far).concat([p[0]]), eps);
  return head.slice(0, -1).concat(tail.slice(0, -1));
}

/**
 * Ломаную превращаем в гладкую кривую: вершины становятся опорными точками квадратичных
 * кривых, а стыки — серединами сторон. Ступеньки от пиксельной сетки исчезают,
 * а форма остаётся той же.
 */
function toSmoothPath(p) {
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const n = p.length;
  let d = 'M' + fmt(mid(p[n - 1], p[0]));
  for (let i = 0; i < n; i++) {
    const next = mid(p[i], p[(i + 1) % n]);
    d += 'Q' + fmt(p[i]) + ' ' + fmt(next);
  }
  return d + 'Z';
}
const fmt = (q) => `${num(q[0])} ${num(q[1])}`;

function toPath(loops, eps) {
  return loops.map(l => {
    const p = simplifyClosed(l, eps);
    return p.length < 4 ? '' : toSmoothPath(p);
  }).join('');
}

function build(test, region, { speck = 60, hole = 40, eps = 1.4 } = {}) {
  const m = mask(test, region.x0, region.y0, region.x1, region.y1);
  despeckle(m, speck);
  fillHoles(m, hole);
  smoothMask(m, 2);
  despeckle(m, speck);
  // плотная рамка вокруг части — из неё получится viewBox, чтобы часть можно было показать отдельно
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const pad = 1;
  return {
    d: toPath(contours(m), eps),
    box: [x0 - pad, y0 - pad, x1 - x0 + 2 * pad + 1, y1 - y0 + 2 * pad + 1].map(v => Math.round(v)).join(' '),
  };
}

/* Границы участков подобраны по снимку: знак слева, корона над словом,
   «GRAFF» и «FAST & DELICIOUS» — двумя строками. */
const mark = build(isRed, { x0: 20, y0: 40, x1: 400, y1: 422 });
const crown = build(isRed, { x0: 520, y0: 20, x1: 780, y1: 150 });
const word = build(isBlack, { x0: 360, y0: 110, x1: 1260, y1: 325 });
const tagline = build(isBlack, { x0: 360, y0: 325, x1: 1260, y1: 415 });

const RED = '#8A2A12';
const BLACK = '#101010';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" fill="none">
<g fill="${RED}" fill-rule="evenodd"><path d="${mark.d}"/><path d="${crown.d}"/></g>
<g fill="${BLACK}" fill-rule="evenodd"><path d="${word.d}"/><path d="${tagline.d}"/></g>
</svg>
`;
writeFileSync(process.argv[3], svg, 'utf8');

const ts = `/**
 * Контуры логотипа GRAFF, обведённые с фотографии вывески кафе (design/logo.jpg).
 * Файл создан scripts/logo-trace.mjs — руками его не правят, а пересобирают из снимка.
 *
 * У каждой части своя рамка (box), поэтому её можно показать отдельно:
 * знак — в шапке панели персонала и в баннере, всё вместе — на главной и на входе.
 */
export interface LogoPart { d: string; box: string }

export const LOGO_MARK: LogoPart = { box: '${mark.box}', d: '${mark.d}' };
export const LOGO_CROWN: LogoPart = { box: '${crown.box}', d: '${crown.d}' };
export const LOGO_WORD: LogoPart = { box: '${word.box}', d: '${word.d}' };
export const LOGO_TAGLINE: LogoPart = { box: '${tagline.box}', d: '${tagline.d}' };

/** Кирпично-красный вывески: измерен по сердцевине штрихов на снимке. */
export const LOGO_RED = '${RED}';
/** Чёрный слова «GRAFF». */
export const LOGO_BLACK = '${BLACK}';
`;
if (process.argv[4]) writeFileSync(process.argv[4], ts, 'utf8');
console.log('знак', mark.box, '| корона', crown.box, '| GRAFF', word.box, '| подпись', tagline.box);
console.log('размер SVG', svg.length, 'байт; модуль', ts.length, 'байт');
