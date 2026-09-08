/**
 * Настройки сервера. Всё берётся из переменных окружения (файл .env на сервере),
 * секреты в код не попадают. Пример значений — в server/.env.example.
 */
import { randomBytes } from 'node:crypto';

const env = process.env;
const num = (v: string | undefined, def: number) => (v && Number.isFinite(Number(v)) ? Number(v) : def);
const bool = (v: string | undefined, def = false) => (v === undefined ? def : v === '1' || v.toLowerCase() === 'true');
const list = (v: string | undefined) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : []);

export const isProd = env.NODE_ENV === 'production';

/** Секрет для подписи токенов. В бою обязателен: без него токены не переживут перезапуск. */
const secretFromEnv = env.JWT_SECRET;
if (isProd && !secretFromEnv) {
  throw new Error('JWT_SECRET не задан. Сгенерируйте: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}

export const config = {
  port: num(env.PORT, 3000),
  host: env.HOST || '0.0.0.0',
  /** Файл базы данных SQLite. Должен лежать на диске сервера в России (152-ФЗ, ч. 5 ст. 18). */
  dbFile: env.DB_FILE || 'data/graff.db',
  jwtSecret: secretFromEnv || randomBytes(32).toString('hex'),
  /** Сколько живёт токен клиента, дней. */
  tokenDays: num(env.TOKEN_DAYS, 90),
  /** Сколько живёт токен сотрудника, часов: смена закончилась — вход нужен заново. */
  staffTokenHours: num(env.STAFF_TOKEN_HOURS, 12),
  /** Домены, которым разрешено обращаться к API. */
  corsOrigins: list(env.CORS_ORIGINS),

  sms: {
    /** smsru | smsc | log. «log» пишет код в журнал сервера — только для тестов. */
    provider: (env.SMS_PROVIDER || 'log') as 'smsru' | 'smsc' | 'log',
    apiId: env.SMS_API_ID || '',
    login: env.SMS_LOGIN || '',
    password: env.SMS_PASSWORD || '',
    /** Зарегистрированное имя отправителя у оператора связи. */
    sender: env.SMS_SENDER || 'GRAFF',
    /** Шаблон сообщения; {code} заменяется на код. */
    template: env.SMS_TEMPLATE || 'Код для входа в GRAFF: {code}. Никому его не сообщайте.',
  },

  code: {
    /** Длина кода из SMS. */
    length: num(env.CODE_LENGTH, 4),
    /** Сколько минут действует код. */
    ttlMinutes: num(env.CODE_TTL_MINUTES, 10),
    /** Сколько попыток ввода даётся на один код. */
    maxAttempts: num(env.CODE_MAX_ATTEMPTS, 5),
    /** Сколько кодов можно запросить на один номер за час. */
    perHour: num(env.CODE_PER_HOUR, 5),
  },

  orders: {
    /** С какого номера начинается нумерация заказов. */
    startNo: num(env.ORDER_START_NO, 1001),
    /** Сколько дней хранить заказы; старые удаляются (152-ФЗ: сроки хранения). */
    keepDays: num(env.ORDER_KEEP_DAYS, 365),
    /** Время готовности по умолчанию, минут. */
    defaultEta: num(env.DEFAULT_ETA, 15),
  },

  /** Столики: терраса и зал. Меняются под реальный зал кафе. */
  tables: {
    terrace: list(env.TABLES_TERRACE).map(Number).filter(Number.isFinite),
    hall: list(env.TABLES_HALL).map(Number).filter(Number.isFinite),
  },

  /** Часы работы для проверки, принимаем ли заказ. Пусто — принимаем круглосуточно. */
  workHours: {
    from: env.WORK_FROM || '',
    to: env.WORK_TO || '',
  },

  /** Логировать тело запросов (в бою выключено: в них персональные данные). */
  logBodies: bool(env.LOG_BODIES, !isProd),
} as const;

export const DEFAULT_TABLES = {
  terrace: config.tables.terrace.length ? config.tables.terrace : [1, 2, 3, 4, 5, 6],
  hall: config.tables.hall.length ? config.tables.hall : [7, 8, 9, 10, 11, 12, 13, 14],
};
