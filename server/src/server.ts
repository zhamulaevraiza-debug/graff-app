/**
 * Точка входа сервера GRAFF.
 *
 * Запуск: npm start (нужен Node 22+). Настройки — в переменных окружения, см. .env.example.
 * Маршруты разложены по файлам в src/routes.
 */
import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config, isProd } from './config.ts';
import { orders, staff as staffRepo } from './db.ts';
import { hub } from './events.ts';
import { hashPin } from './auth.ts';
import { authRoutes } from './routes/auth.ts';
import { orderRoutes } from './routes/orders.ts';
import { pushRoutes } from './routes/push.ts';
import { staffRoutes } from './routes/staff.ts';
import { streamRoutes } from './routes/stream.ts';

const app = Fastify({
  logger: {
    level: isProd ? 'info' : 'debug',
    // В журнал не должны попадать телефоны и коды: пишем только метаданные запроса.
    serializers: {
      req: r => ({ method: r.method, url: r.url, ip: r.ip }),
    },
  },
  // Доверяем ровно тому числу прокси, что стоит перед сервером (см. config.trustProxyHops):
  // при trustProxy: true клиент подделал бы X-Forwarded-For и обошёл ограничения частоты.
  // hop считается от ближайшего к серверу узла, поэтому условие повторяет числовую форму.
  trustProxy: (_address: string, hop: number) => hop < config.trustProxyHops,
  bodyLimit: 256 * 1024,
});

await app.register(cors, {
  origin: config.corsOrigins.length ? config.corsOrigins : true,
  credentials: false,
  // Методы перечисляем явно: без PATCH и DELETE браузер не пропустит сохранение имени
  // и удаление аккаунта — они уходят предварительным запросом OPTIONS.
  methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  // Сутки не переспрашивать разрешение на каждый запрос.
  maxAge: 86400,
});

// Общий предел на все запросы; на отправку кода в routes/auth.ts стоит отдельный, более строгий.
await app.register(rateLimit, {
  global: true,
  max: 300,
  timeWindow: '1 minute',
  keyGenerator: req => req.ip,
});

// Некоторые клиенты и прокси шлют заголовок JSON без тела (например, при DELETE).
// Считаем пустое тело пустым объектом, чтобы это не превращалось в ошибку разбора.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  const raw = typeof body === 'string' ? body.trim() : '';
  if (!raw) return done(null, {});
  try {
    done(null, JSON.parse(raw));
  } catch {
    const err = new Error('Тело запроса не является корректным JSON') as Error & { statusCode?: number };
    err.statusCode = 400;
    done(err);
  }
});

app.get('/health', async () => ({
  ok: true,
  time: Date.now(),
  subscribers: hub.count(),
  smsProvider: config.sms.provider,
}));

await app.register(authRoutes);
await app.register(orderRoutes);
await app.register(pushRoutes);
await app.register(staffRoutes);
await app.register(streamRoutes);

app.setErrorHandler((err: FastifyError, req, reply) => {
  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  if (status >= 500) app.log.error({ err, url: req.url }, 'ошибка сервера');
  reply.status(status).send({
    error: status >= 500 ? 'internal' : (err.code || 'bad_request'),
    message: status >= 500 ? 'Внутренняя ошибка сервера' : err.message,
  });
});

/** Первый запуск: если сотрудников нет, заводим одного из переменных окружения. */
function bootstrapStaff() {
  if (staffRepo.count() > 0) return;
  const login = process.env.STAFF_LOGIN;
  const pin = process.env.STAFF_PIN;
  if (!login || !pin) {
    app.log.warn('Сотрудники не заведены. Создайте первого: npm run seed:staff -- <логин> <PIN> <имя>');
    return;
  }
  staffRepo.create(login, process.env.STAFF_NAME || 'Кухня', hashPin(pin), 'admin');
  app.log.info(`Создан сотрудник «${login}» из переменных окружения`);
}
bootstrapStaff();

// Чистка старых заказов и пинг подписчиков.
const cleanupTimer = setInterval(() => {
  const removed = orders.cleanup();
  if (removed) app.log.info(`Удалено старых заказов: ${removed}`);
}, 6 * 3600_000);
const pingTimer = setInterval(() => hub.ping(), 25_000);

const shutdown = async (signal: string) => {
  app.log.info(`Остановка по сигналу ${signal}`);
  clearInterval(cleanupTimer);
  clearInterval(pingTimer);
  hub.closeAll();
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.port, host: config.host });
app.log.info(`GRAFF сервер слушает ${config.host}:${config.port}, база: ${config.dbFile}`);
