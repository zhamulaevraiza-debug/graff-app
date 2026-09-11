/**
 * Данные меню GRAFF — перенесены из печатного меню (design/BRIEF.md, раздел 5)
 * и логики прототипа (design/GRAFF App.dc.html).
 */

export const C = {
  bg: '#FBF6EF', card: '#F4E9DB', line: '#D4B79B', copper: '#B8622B', copper2: '#D08A4E',
  text: '#2E2119', sec: '#7A5C48', price: '#B9432A', peach: '#F8DCC0', green: '#4F8A5B',
  muted: '#B8A08A', occupied: '#DDD5CB', occupiedFg: '#9A8F85', navInactive: '#8C7460',
  grad: 'linear-gradient(135deg,#B8622B,#D08A4E)',
} as const;

/** Контурные иконки 24×24 (path d), медные — как в печатном меню. */
export const ICON = {
  burger: 'M4 10a8 6.5 0 0 1 16 0zM3 13h18M4 16h16v1a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z',
  fries: 'M6 10l1.2 11h9.6L18 10zM6 10h12M9 10V5.5M12 10V3.5M15 10V5.5',
  star: 'M12 3l2.7 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17.3 6.4 20.3l1.2-6.3L3 9.6l6.3-.8z',
  teapot: 'M5 10h10a4 4 0 0 1 4 4v2a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM19 12l3-3M5 13H3M9 10V8.5a3 3 0 0 1 6 0V10M11 6.5h2',
  jar: 'M7 8h10v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2zM8 5h8v3H8zM7 12h10',
  glass: 'M6 5h12l-1.5 15h-9zM7 10h10M13 5l4-3',
  cup: 'M4 9h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM16 11h2a2 2 0 0 1 0 4h-2M6 21h9',
  bottle: 'M10 2h4v4l2 3v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9l2-3zM8 13h8',
  snow: 'M12 2v20M2 12h20M5 5l14 14M19 5L5 19',
  citrus: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3L6.3 17.7',
  apple: 'M12 7.5c-4-1.5-7 1.5-7 5.5s3 8 7 8 7-4 7-8-3-7-7-5.5zM12 7.5V4M12 4c1.5-1.5 3.5-1.5 4.5-1',
  sauce: 'M3 12h16a2 2 0 0 1 0 4h-1.2A5 5 0 0 1 13 20H8a5 5 0 0 1-5-5zM19 14l3-1.5M7 9c0-2 2-2 2-4M11 9c0-2 2-2 2-4',
  chef: 'M7 11a4 4 0 0 1 1-7.5 5 5 0 0 1 8 0A4 4 0 0 1 17 11v9H7zM7 16h10',
  bell: 'M6 17v-6a6 6 0 0 1 12 0v6l2 2H4zM10 21a2 2 0 0 0 4 0',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-2.5-4a1.5 1.5 0 0 1 2.5-1.5L8 14',
  home: 'M4 11l8-7 8 7v9h-5v-6h-6v6H4z',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  user: 'M12 11m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0',
  chair: 'M6 3h12v9H6zM6 12v9M18 12v9M6 16h12',
  sun: 'M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9zM12 12v9M8 21h8',
  bag: 'M6 8h12l1 13H5zM9 8V6.5a3 3 0 0 1 6 0V8',
  clock: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3.5 2',
  heart: 'M12 20.5s-8-5.2-8-11.2A4.4 4.4 0 0 1 12 6.8a4.4 4.4 0 0 1 8 2.5c0 6-8 11.2-8 11.2z',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  pin: 'M12 22s7-7.5 7-13a7 7 0 0 0-14 0c0 5.5 7 13 7 13zM12 9m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
  chevron: 'M9 5l7 7-7 7',
  back: 'M15 5l-7 7 7 7',
  arrow: 'M4 12h15M13 6l6 6-6 6',
  bars: 'M4 7h16M4 12h16M4 17h16',
  leaf: 'M4 20c0-8 6-14 16-16 0 10-6 16-16 16zM4 20c2-6 6-9 11-11',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
} as const;
export type IconName = keyof typeof ICON;

/** Контакты и место — плейсхолдеры по брифу заполняются здесь. */
export const PHONE_DISPLAY = '+7 938 900-90-67';
export const PHONE_TEL = 'tel:+79389009067';
export const TOWN = 'Чири-Юрт';
export const REGION = 'Чеченская Республика';
export const ADDRESS = '[АДРЕС]';
export const HOURS = '[ЧАСЫ РАБОТЫ]';
export const MAPS_URL = 'https://yandex.ru/maps/?text=' + encodeURIComponent(`${TOWN} кафе GRAFF`);

export const SLOGAN = 'Вкус · Качество · Скорость';
export const TAGLINE = 'Еда, которая всегда рядом ♥';
/** Та же подпись, разбитая на строки, — для рукописного блока на главной. */
export const TAGLINE_LINES = ['Еда, которая всегда', 'рядом ♥'];
/** Заголовок главного экрана. Правится здесь: на экране он собирается из этих трёх строк. */
export const HERO_EYEBROW = 'Больше чем еда';
export const HERO_TITLE = ['Вкус', 'в каждой', 'детали'];
export const HERO_SUB = ['Свежие продукты.', 'Быстро.', 'С любовью.'];

/**
 * Три обещания бренда из футера печатного меню.
 * tile — короткая подпись для карточек на главной, short и text — для полосы в меню и «О нас».
 * color — цвет иконки: у свежести он зелёный, остальные медные.
 */
export const PROMISES: { icon: IconName; tile: string; text: string; short: string; color?: string }[] = [
  { icon: 'leaf', tile: 'Свежие продукты', text: 'Свежие продукты каждый день', short: 'Свежие продукты каждый день', color: C.green },
  { icon: 'bolt', tile: 'Быстрое приготовление', text: 'Быстрое приготовление, без лишнего ожидания', short: 'Быстрое приготовление, без лишнего ожидания' },
  { icon: 'heart', tile: 'С любовью для вас', text: 'С любовью для вас! Спасибо, что выбираете нас!', short: 'С любовью для вас!' },
];

export interface Size { l: string; p: number }
const S = (l: string, p: number): Size => ({ l, p });
const V3 = (a: number, b: number, c: number): Size[] => [S('S', a), S('M', b), S('L', c)];

export const TEAS = ['Граф Орлов', 'Лес', 'Голден жасмин', 'Чёрный с бергамотом', 'Золотое Кении', 'Наглый фрукт', 'Таёжный сбор', 'Земляничный пудр', 'Дикая вишня', 'Улыбка гейши', '1001 ночь', 'Арбузная свежесть', 'Адмирал', 'Чёрный принц', 'Персик с айвой'];

type RawItem = [name: string, price: number | Size[]];
/** one — как группа называется рядом с блюдом в единственном числе: «Мясные» → «мясной».
    Правилом это не выводится: у «Мясные» и «Куриные» окончания разные. */
interface RawGroup { name?: string; icon?: string; one?: string; items: RawItem[] }
interface RawCat { id: string; name: string; icon: string; sauces?: boolean; isNew?: boolean; photo?: string; groups: RawGroup[] }

const RAW: RawCat[] = [
  { id: 'burgers', name: 'Бургеры', icon: ICON.burger, sauces: true, photo: 'Фото: двойной чизбургер', groups: [
    { name: 'Мясные', one: 'мясной', items: [['Бургер классический', 330], ['Бургер с халапеньо', 340], ['Грибной', 370], ['Онион', 350], ['Сырный', 370]] },
    { name: 'Куриные', one: 'куриный', items: [['Бургер классический', 230], ['Бургер с халапеньо', 250], ['Грибной', 270], ['Онион', 250], ['Сырный', 290], ['Мини бургеры 5 шт', 500]] },
  ] },
  { id: 'fastfood', name: 'Фастфуд', icon: ICON.fries, sauces: true, photo: 'Фото: фри в картонке GRAFF', groups: [
    { items: [
      ['Стрипсы', [S('5 шт', 250), S('9 шт', 350)]],
      ['Крылышки острые', [S('5 шт', 300), S('8 шт', 420), S('16 шт', 840)]],
      ['Крылышки шашлычные', [S('5 шт', 200), S('8 шт', 280)]],
      ['Наггетсы', [S('6 шт', 180), S('9 шт', 220)]],
      ['Креветки', [S('6 шт', 250), S('9 шт', 300)]],
      ['Сырные палочки', [S('3 шт', 150), S('6 шт', 300)]],
      ['Фри', [S('маленький', 120), S('большой', 150)]],
      ['Сэндвич', [S('индейка', 250), S('мясной', 250)]],
      ['Деревенский', [S('малый', 150), S('большой', 180)]],
    ] },
  ] },
  { id: 'new', name: 'Новинки', icon: ICON.star, isNew: true, sauces: true, photo: 'Фото: ролл / фахитас', groups: [
    { items: [['Фахитас с мясом', 400], ['Фахитас мексикано мясной', 400], ['Филадельфия мексикано', 350], ['Филадельфия с курицей', 350], ['Гиро на тарелке', 350], ['Сэндвич с курицей', 300]] },
  ] },
  { id: 'tea', name: 'Чай', icon: ICON.teapot, photo: 'Фото: стеклянный чайник с чашкой', groups: [
    { items: TEAS.map((n): RawItem => [n, [S('200 мл', 200), S('300 мл', 300)]]) },
  ] },
  { id: 'jam', name: 'Варенья', icon: ICON.jar, photo: 'Фото: банки варенья с ягодами', groups: [
    { items: [['Айва', 300], ['Малиновый', 300], ['Белая вишня', 300], ['Инжир', 300], ['Кокосовое варенье', 300]] },
  ] },
  { id: 'drinks', name: 'Напитки', icon: ICON.glass, photo: 'Фото: капучино с латте-артом', groups: [
    { name: 'Классика', icon: ICON.cup, items: [['Лунго', 150], ['Эспрессо', 150], ['Эспрессо финик', 180], ['Американо', 150], ['Флэт уайт', 200], ['Капучино', [S('S', 200), S('M', 250)]], ['Латте', 250], ['Раф классический', 250], ['Раф урбеч', 300], ['Какао', [S('S', 200), S('M', 250)]]] },
    { name: 'Тоники', icon: ICON.bottle, items: [['Гранат', V3(200, 300, 400)], ['Ананас', V3(200, 300, 400)], ['Свежевыжатый', V3(350, 450, 550)]] },
    { name: 'Холодные', icon: ICON.snow, items: [['Фраппе', 250], ['Айс какао', 250], ['Айс урбеч', V3(250, 350, 450)]] },
    { name: 'Лимонады', icon: ICON.citrus, items: [['Манго маракуйя', V3(250, 350, 400)], ['Ягодный', V3(250, 350, 400)], ['Мохито клубничный', V3(250, 350, 400)], ['Мохито классика', V3(250, 350, 400)], ['Графин', 350]] },
    { name: 'Фреши', icon: ICON.apple, items: [['Апельсин', V3(250, 350, 450)], ['Яблоко', V3(250, 350, 400)], ['Ананасовый', V3(350, 450, 550)], ['Гранатовый', V3(350, 450, 550)], ['Яблоко-апельсин', V3(250, 350, 400)]] },
  ] },
  { id: 'sauces', name: 'Соусы', icon: ICON.sauce, groups: [
    { items: [['Чесночный', 50], ['Фирменный', 50], ['Острый соус', 50], ['Сырный', 30], ['Томатный', 30]] },
  ] },
];

export interface MenuItem {
  id: string; name: string; sizes: Size[]; hasSizes: boolean; priceLabel: string;
  catId: string; catName: string; isNew: boolean; canSauce: boolean; photo: string; group: string;
  /** уточнение группы для строки заказа: ' (мясной)' — или пустая строка */
  groupNote: string;
}
export interface MenuGroup { name: string; hasName: boolean; icon: string; hasIcon: boolean; items: MenuItem[] }
export interface MenuCategory {
  id: string; name: string; icon: string; isNew: boolean; hasPhoto: boolean; photo: string; plateBg: string; groups: MenuGroup[];
}

const rub = (n: number | string) => `${n} ₽`;

export const MENU: MenuCategory[] = RAW.map(c => ({
  id: c.id, name: c.name, icon: c.icon, isNew: !!c.isNew, hasPhoto: !!c.photo, photo: c.photo || '',
  plateBg: c.isNew ? C.peach : C.card,
  groups: c.groups.map((g, gi) => ({
    name: g.name || '', hasName: !!g.name, icon: g.icon || '', hasIcon: !!g.icon,
    items: g.items.map((it, ii): MenuItem => {
      const sizes = Array.isArray(it[1]) ? it[1] : [S('', it[1])];
      return {
        id: `${c.id}-${gi}-${ii}`, name: it[0], sizes, hasSizes: sizes.length > 1,
        priceLabel: rub(sizes.map(z => z.p).join('/')), catId: c.id, catName: c.name,
        isNew: !!c.isNew, canSauce: !!c.sauces, photo: c.photo || 'Фото блюда', group: g.name || '',
        groupNote: g.one ? ` (${g.one})` : '',
      };
    }),
  })),
}));

/** Иконка-плейсхолдер для фотографий раздела и блюда (одна на всё приложение, чтобы экраны не расходились). */
export const CAT_ICON: Record<string, IconName> = {
  burgers: 'burger', fastfood: 'fries', new: 'star', tea: 'teapot', jam: 'jar', drinks: 'cup', sauces: 'sauce',
};
export const catIcon = (catId: string): IconName => CAT_ICON[catId] || 'burger';

export const ITEMS: Record<string, MenuItem> = {};
MENU.forEach(c => c.groups.forEach(g => g.items.forEach(it => { ITEMS[it.id] = it; })));
export const NEW_ITEMS: MenuItem[] = MENU.find(c => c.id === 'new')!.groups[0].items;
export const CAT_BY_ID: Record<string, MenuCategory> = Object.fromEntries(MENU.map(c => [c.id, c]));

/** Описания/составы блюд — по брифу заполняются позже; ключ = id позиции. */
export const DESCRIPTIONS: Record<string, string> = {};
export const DESC_PLACEHOLDER = '[Состав и описание блюда]';
export const describe = (id: string) => DESCRIPTIONS[id] || DESC_PLACEHOLDER;

/**
 * Сведения о блюде, которые кафе обязано доводить до потребителя
 * (Правила оказания услуг общественного питания, ЗоЗПП ст. 10, ТР ТС 022/2011).
 * Заполняются по данным кафе; ключ — id позиции из MENU (например, 'burgers-0-0').
 */
export interface Nutrition {
  /** ккал на порцию */
  kcal: number;
  /** белки, г */
  protein: number;
  /** жиры, г */
  fat: number;
  /** углеводы, г */
  carbs: number;
}
export interface ItemInfo {
  /** Масса или объём порции: «250 г», «0,3 л». Для позиций с вариантами — массив по порядку размеров. */
  portion?: string | string[];
  /** Способ приготовления: «жареный», «на гриле», «запечённый». */
  cooking?: string;
  /** Состав: ингредиенты в порядке убывания массовой доли, включая пищевые добавки. */
  composition?: string;
  /** Пищевая ценность порции. */
  nutrition?: Nutrition;
  /** Аллергены из перечня ТР ТС 022/2011: «глютен», «молоко», «яйцо», «орехи», «соя», «кунжут», «горчица», «рыба», «сельдерей». */
  allergens?: string[];
  /** Противопоказания при отдельных заболеваниях, если есть (Правила № 1515, п. 9). */
  contraindications?: string;
  /** Пометки: «острое», «вегетарианское». */
  tags?: string[];
}
export const ITEM_INFO: Record<string, ItemInfo> = {
  // Пример заполнения (замените на данные кафе):
  // 'burgers-0-0': {
  //   portion: '250 г',
  //   cooking: 'жареный на гриле',
  //   composition: 'Булочка пшеничная, котлета говяжья, сыр, томат, салат, лук, соус фирменный',
  //   nutrition: { kcal: 540, protein: 26, fat: 28, carbs: 44 },
  //   allergens: ['глютен', 'молоко', 'яйцо', 'горчица'],
  // },
};
export const itemInfo = (id: string): ItemInfo => ITEM_INFO[id] || {};
/** Масса/объём выбранного варианта порции. */
export function portionOf(id: string, sizeIdx = 0): string {
  const p = itemInfo(id).portion;
  if (!p) return '';
  return Array.isArray(p) ? (p[sizeIdx] || p[0] || '') : p;
}

export type SauceId = 'garlic' | 'house' | 'hot' | 'cheese' | 'tomato';
export interface Sauce { id: SauceId; name: string; p: number }
export const SAUCES: Sauce[] = [
  { id: 'garlic', name: 'Чесночный', p: 50 }, { id: 'house', name: 'Фирменный', p: 50 }, { id: 'hot', name: 'Острый', p: 50 },
  { id: 'cheese', name: 'Сырный', p: 30 }, { id: 'tomato', name: 'Томатный', p: 30 },
];

export type Format = 'hall' | 'terrace' | 'togo';
export interface FormatDef { id: Format; name: string; icon: string }
export const FORMATS: FormatDef[] = [
  { id: 'hall', name: 'В зале', icon: ICON.chair },
  { id: 'terrace', name: 'На террасе', icon: ICON.sun },
  { id: 'togo', name: 'С собой', icon: ICON.bag },
];
export const FORMAT_NAME: Record<Format, string> = { hall: 'В зале', terrace: 'На террасе', togo: 'С собой' };

export type ZoneId = 'terrace' | 'hall';
export interface Zone { id: ZoneId; name: string; icon: string; tables: number[] }
/** Допущение прототипа: терраса 1–6, зал 7–14. Нумерация условная. */
export const ZONES: Zone[] = [
  { id: 'terrace', name: 'Терраса', icon: ICON.sun, tables: [1, 2, 3, 4, 5, 6] },
  { id: 'hall', name: 'Зал', icon: ICON.chair, tables: [7, 8, 9, 10, 11, 12, 13, 14] },
];

export type PaymentId = 'cash' | 'card' | 'online';
/** soon — способ ещё не работает: показываем, но выбрать нельзя, иначе заказ уйдёт с невозможной оплатой. */
export const PAYMENTS: { id: PaymentId; name: string; soon?: boolean }[] = [
  { id: 'cash', name: 'Наличными при получении' },
  { id: 'card', name: 'Картой при получении' },
  { id: 'online', name: 'Онлайн', soon: true },
];
export const PAY_TEXT: Record<PaymentId, string> = { cash: 'наличными', card: 'картой', online: 'онлайн' };

export type OrderStatus = 'new' | 'accepted' | 'cooking' | 'ready' | 'done' | 'cancelled';
export const STATUS_TEXT: Record<OrderStatus, string> = {
  new: 'Ожидает подтверждения', accepted: 'Принят', cooking: 'Готовится', ready: 'Готов', done: 'Выдан', cancelled: 'Отменён',
};
export const STEP_IDX: Record<OrderStatus, number> = { new: -1, accepted: 0, cooking: 1, ready: 2, done: 3, cancelled: -1 };
export const ETA_CHOICES = [10, 15, 20, 30];
