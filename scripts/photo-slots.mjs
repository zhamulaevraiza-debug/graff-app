/**
 * Список слотов фотографий и поисковых запросов к Openverse.
 *
 * slot — имя файла в public/photos (см. README там же), what — что должно быть на снимке,
 * q — запросы по убыванию точности: берётся первый, который дал достаточно кандидатов.
 * Какой именно снимок выбран из кандидатов, записано в photo-picks.json.
 *
 * Идентификаторы блюд повторяют src/data/menu.ts: `<раздел>-<группа>-<номер>`.
 */
const d = (slot, what, ...q) => ({ slot, what, q });

export const SLOTS = [
  /* Главная и разделы меню */
  d('hero-burger', 'бургер в круге на главной', 'double cheeseburger', 'cheeseburger'),
  d('hero-fries', 'картофель фри в круге на главной', 'french fries paper cup', 'french fries'),
  d('cat-burgers', 'раздел «Бургеры»', 'hamburger sandwich beef', 'cheeseburger'),
  d('cat-fastfood', 'раздел «Фастфуд»', 'fried chicken wings plate', 'fried chicken basket'),
  d('cat-new', 'раздел «Новинки»', 'chicken fajitas', 'fajita'),
  d('cat-tea', 'раздел «Чай»', 'glass teapot tea', 'teapot and cup of tea'),
  d('cat-jam', 'раздел «Варенья»', 'jars of fruit jam', 'fruit preserves jars'),
  d('cat-drinks', 'раздел «Напитки»', 'cappuccino latte art', 'cappuccino cup'),

  /* Бургеры — мясные */
  d('dish-burgers-0-0', 'Бургер классический (мясной)', 'hamburger beef sandwich', 'hamburger'),
  d('dish-burgers-0-1', 'Бургер с халапеньо (мясной)', 'burger jalapeno', 'jalapeno sandwich'),
  d('dish-burgers-0-2', 'Грибной бургер (мясной)', 'mushroom burger', 'mushroom swiss burger'),
  d('dish-burgers-0-3', 'Онион бургер (мясной)', 'burger onion rings', 'onion ring burger'),
  d('dish-burgers-0-4', 'Сырный бургер (мясной)', 'cheeseburger melted cheese', 'cheeseburger'),
  /* Бургеры — куриные */
  d('dish-burgers-1-0', 'Бургер классический (куриный)', 'crispy chicken burger', 'chicken sandwich burger'),
  d('dish-burgers-1-1', 'Бургер с халапеньо (куриный)', 'spicy chicken sandwich', 'chicken burger spicy'),
  d('dish-burgers-1-2', 'Грибной бургер (куриный)', 'chicken mushroom burger', 'mushroom burger'),
  d('dish-burgers-1-3', 'Онион бургер (куриный)', 'chicken burger onion rings', 'onion rings burger'),
  d('dish-burgers-1-4', 'Сырный бургер (куриный)', 'chicken cheese burger', 'chicken cheeseburger'),
  d('dish-burgers-1-5', 'Мини бургеры, 5 шт', 'slider burgers', 'mini burgers'),

  /* Фастфуд */
  d('dish-fastfood-0-0', 'Стрипсы', 'chicken tenders fried', 'chicken strips'),
  d('dish-fastfood-0-1', 'Крылышки острые', 'buffalo wings', 'spicy chicken wings'),
  d('dish-fastfood-0-2', 'Крылышки шашлычные', 'barbecue chicken wings', 'grilled chicken wings'),
  d('dish-fastfood-0-3', 'Наггетсы', 'chicken nuggets', 'nuggets'),
  d('dish-fastfood-0-4', 'Креветки', 'fried shrimp breaded', 'fried prawns'),
  d('dish-fastfood-0-5', 'Сырные палочки', 'mozzarella sticks', 'fried cheese sticks'),
  d('dish-fastfood-0-6', 'Фри', 'french fries', 'pommes frites'),
  d('dish-fastfood-0-7', 'Сэндвич', 'club sandwich', 'turkey sandwich'),
  d('dish-fastfood-0-8', 'Деревенский картофель', 'potato wedges', 'country potatoes roasted'),

  /* Новинки */
  d('dish-new-0-0', 'Фахитас с мясом', 'beef fajitas', 'fajitas'),
  d('dish-new-0-1', 'Фахитас мексикано мясной', 'fajitas skillet', 'fajita tortilla'),
  d('dish-new-0-2', 'Филадельфия мексикано', 'burrito wrap cut', 'tortilla wrap'),
  d('dish-new-0-3', 'Филадельфия с курицей', 'chicken wrap tortilla', 'chicken wrap'),
  d('dish-new-0-4', 'Гиро на тарелке', 'gyros plate', 'gyros'),
  d('dish-new-0-5', 'Сэндвич с курицей', 'chicken sandwich', 'chicken burger sandwich'),

  /* Чай */
  d('dish-tea-0-0', 'Чай «Граф Орлов»', 'black tea glass cup', 'cup of black tea'),
  d('dish-tea-0-1', 'Чай «Лес»', 'fruit tea glass cup', 'berry infusion tea'),
  d('dish-tea-0-2', 'Чай «Голден жасмин»', 'jasmine tea', 'jasmine green tea cup'),
  d('dish-tea-0-3', 'Чёрный с бергамотом', 'earl grey tea', 'bergamot tea cup'),
  d('dish-tea-0-4', 'Чай «Золотое Кении»', 'kenyan tea', 'black tea leaves cup'),
  d('dish-tea-0-5', 'Чай «Наглый фрукт»', 'fruit tea glass', 'fruit infusion tea'),
  d('dish-tea-0-6', 'Чай «Таёжный сбор»', 'herbal tea herbs cup', 'herbal infusion'),
  d('dish-tea-0-7', 'Чай «Земляничный пудр»', 'tea glass cup red', 'rooibos tea cup'),
  d('dish-tea-0-8', 'Чай «Дикая вишня»', 'hibiscus tea glass', 'red tea glass cup'),
  d('dish-tea-0-9', 'Чай «Улыбка гейши»', 'green tea cup', 'green tea glass'),
  d('dish-tea-0-10', 'Чай «1001 ночь»', 'tea glass teapot table', 'green tea glass teapot'),
  d('dish-tea-0-11', 'Чай «Арбузная свежесть»', 'watermelon drink glass', 'iced fruit tea'),
  d('dish-tea-0-12', 'Чай «Адмирал»', 'tea with lemon', 'black tea lemon glass'),
  d('dish-tea-0-13', 'Чай «Чёрный принц»', 'teapot black tea', 'black tea pot'),
  d('dish-tea-0-14', 'Чай «Персик с айвой»', 'iced tea glass lemon', 'tea glass ice'),

  /* Варенья */
  d('dish-jam-0-0', 'Варенье из айвы', 'quince jam', 'quince preserve'),
  d('dish-jam-0-1', 'Малиновое варенье', 'raspberry jam jar', 'jam jar spoon berries'),
  d('dish-jam-0-2', 'Варенье из белой вишни', 'cherry jam', 'cherry preserve jar'),
  d('dish-jam-0-3', 'Варенье из инжира', 'fig jam toast', 'figs jam'),
  d('dish-jam-0-4', 'Кокосовое варенье', 'coconut jam jar', 'kaya jam toast'),

  /* Напитки — классика */
  d('dish-drinks-0-0', 'Лунго', 'lungo coffee', 'espresso cup coffee'),
  d('dish-drinks-0-1', 'Эспрессо', 'espresso shot cup', 'espresso coffee cup saucer'),
  d('dish-drinks-0-2', 'Эспрессо финик', 'arabic coffee dates', 'coffee cup dates plate'),
  d('dish-drinks-0-3', 'Американо', 'americano coffee', 'black coffee cup'),
  d('dish-drinks-0-4', 'Флэт уайт', 'flat white coffee', 'flat white'),
  d('dish-drinks-0-5', 'Капучино', 'cappuccino latte art', 'cappuccino'),
  d('dish-drinks-0-6', 'Латте', 'caffe latte glass', 'latte macchiato glass'),
  d('dish-drinks-0-7', 'Раф классический', 'coffee cream glass', 'latte glass cream coffee'),
  d('dish-drinks-0-8', 'Раф урбеч', 'coffee cream cup', 'coffee foam glass'),
  d('dish-drinks-0-9', 'Какао', 'hot chocolate cup', 'cocoa drink cup'),
  /* Напитки — тоники */
  d('dish-drinks-1-0', 'Тоник гранат', 'juice glass ice', 'red drink glass ice'),
  d('dish-drinks-1-1', 'Тоник ананас', 'pineapple drink glass', 'pineapple smoothie glass'),
  d('dish-drinks-1-2', 'Тоник свежевыжатый', 'fresh juice glass', 'citrus drink glass'),
  /* Напитки — холодные */
  d('dish-drinks-2-0', 'Фраппе', 'frappe coffee', 'iced coffee frappe'),
  d('dish-drinks-2-1', 'Айс какао', 'iced chocolate drink', 'iced cocoa glass'),
  d('dish-drinks-2-2', 'Айс урбеч', 'iced coffee glass', 'iced latte glass'),
  /* Напитки — лимонады */
  d('dish-drinks-3-0', 'Лимонад манго-маракуйя', 'mango passion fruit drink', 'mango juice glass'),
  d('dish-drinks-3-1', 'Лимонад ягодный', 'berry lemonade', 'berry drink glass'),
  d('dish-drinks-3-2', 'Мохито клубничный', 'strawberry mojito', 'strawberry cocktail mint'),
  d('dish-drinks-3-3', 'Мохито классика', 'mojito glass mint', 'mint lime drink glass'),
  d('dish-drinks-3-4', 'Графин лимонада', 'lemonade pitcher', 'carafe of lemonade'),
  /* Напитки — фреши */
  d('dish-drinks-4-0', 'Фреш апельсин', 'orange juice glass', 'freshly squeezed orange juice'),
  d('dish-drinks-4-1', 'Фреш яблоко', 'glass of apple juice', 'apple juice glass table'),
  d('dish-drinks-4-2', 'Фреш ананасовый', 'tropical juice glass', 'pineapple juice glass table'),
  d('dish-drinks-4-3', 'Фреш гранатовый', 'pomegranate glass drink', 'red fruit juice glass'),
  d('dish-drinks-4-4', 'Фреш яблоко-апельсин', 'juice glasses breakfast', 'orange juice glass table'),

  /* Соусы */
  d('dish-sauces-0-0', 'Чесночный соус', 'garlic sauce bowl', 'aioli bowl'),
  d('dish-sauces-0-1', 'Фирменный соус', 'dipping sauce bowl', 'sauce bowl white'),
  d('dish-sauces-0-2', 'Острый соус', 'chili sauce bowl', 'hot sauce bowl red'),
  d('dish-sauces-0-3', 'Сырный соус', 'cheese dip bowl', 'cheese sauce pan'),
  d('dish-sauces-0-4', 'Томатный соус', 'ketchup bowl', 'tomato sauce bowl'),
];

/**
 * Карусель «Новинки ★» на главной берёт снимок из отдельного слота — он совпадает с карточкой блюда.
 * Имя слота там — `new-` плюс идентификатор блюда, а он сам начинается с `new-`: `new-new-0-0`.
 */
export const NEW_COPIES = SLOTS.filter(s => s.slot.startsWith('dish-new-'))
  .map(s => ({ from: s.slot, to: s.slot.replace(/^dish-/, 'new-') }));
