/**
 * Поток живых событий (Server-Sent Events).
 *
 * GET /stream — одно долгое соединение на вкладку: кухня получает все заказы,
 * клиент — только свои, и все получают занятость столиков.
 * Браузерный EventSource не умеет слать заголовки, поэтому токен принимается
 * и через Authorization: Bearer …, и через параметр запроса ?token=…
 * Из-за этого журналирование запросов на маршруте выключено (logLevel: 'warn'):
 * в адресе лежит токен, а в нём — телефон клиента, а такому в журнале не место
 * (по той же причине deploy/nginx.conf не пишет access_log для /api/stream).
 *
 * Прав из токена мало: перед подпиской и дальше по ходу соединения доступ
 * перепроверяется по базе, а по истечении токена поток закрывается. Иначе
 * открытый утром на планшете поток пережил бы и конец смены, и увольнение,
 * и удаление аккаунта клиентом — а отдаёт он самое чувствительное: заказы с телефонами.
 *
 * Ответ пишется в reply.raw в обход сериализации Fastify: тело не заканчивается,
 * пока клиент не закроет вкладку. Заголовок X-Accel-Buffering: no обязателен —
 * иначе nginx копит ответ в буфере и события приходят пачками с задержкой.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { OutgoingHttpHeaders } from 'node:http';
import { bearer, verifyToken } from '../auth.ts';
import { orders, staff, tables, users } from '../db.ts';
import { hub } from '../events.ts';
import type { ApiOrder, StreamEvent } from '../types.ts';

/** Через сколько миллисекунд браузеру пробовать переподключиться после обрыва. */
const RETRY_MS = 3000;

/** Как часто перепроверять по базе, что доступ ещё действует, миллисекунды. */
const RECHECK_MS = 30_000;

/** Сколько одновременных потоков разрешено одному клиенту или сотруднику. */
const MAX_STREAMS = 5;

/**
 * Предел неотправленных байтов на соединение: клиент перестал читать —
 * рвём поток, иначе события копятся в памяти процесса без ограничений.
 */
const MAX_BUFFER_BYTES = 1_000_000;

/**
 * Предел задержки setTimeout в Node (около 24 суток): большее значение сработало бы
 * мгновенно, а токен клиента живёт до 90 дней. Такой поток закроется раньше срока —
 * браузер переподключится сам, ничего не заметив.
 */
const MAX_TIMER_MS = 2_147_483_647;

interface StreamQuery {
  token?: string | string[];
}

/** Токен из заголовка или из строки запроса — EventSource умеет только второе. */
function tokenFrom(req: FastifyRequest): string | undefined {
  const fromHeader = bearer(req.headers.authorization);
  if (fromHeader) return fromHeader;
  const q = req.query as StreamQuery | undefined;
  const raw = q?.token;
  const value = typeof raw === 'string' ? raw.trim() : undefined;
  return value || undefined;
}

/**
 * Активные заказы клиента: и оформленные им самим, и внесённые персоналом
 * по его телефону (заказ по звонку). Телефон клиенту не отдаём.
 */
function activeForUser(userId: string, phone: string | null): ApiOrder[] {
  const found = [...orders.byUser(userId), ...(phone ? orders.byPhone(phone) : [])];
  const uniq = new Map<number, ApiOrder>();
  for (const o of found) {
    if (o.status === 'done' || o.status === 'cancelled') continue;
    uniq.set(o.no, { ...o, phone: undefined, mine: true });
  }
  return [...uniq.values()].sort((a, b) => a.createdAt - b.createdAt);
}

/** Заголовки потока поверх тех, что уже поставили плагины (CORS и прочие). */
function streamHeaders(reply: FastifyReply): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {};
  const own = new Set(['content-type', 'content-length', 'cache-control', 'connection', 'x-accel-buffering']);
  for (const [key, value] of Object.entries(reply.getHeaders())) {
    const name = key.toLowerCase();
    if (value === undefined || own.has(name)) continue;
    headers[name] = value;
  }
  headers['content-type'] = 'text/event-stream; charset=utf-8';
  headers['cache-control'] = 'no-cache, no-transform';
  headers['connection'] = 'keep-alive';
  headers['x-accel-buffering'] = 'no';
  return headers;
}

/* ---------- учёт открытых потоков ---------- */

/**
 * Открытые потоки по владельцу токена. Общий предел частоты считает запросы,
 * а не соединения, поэтому один валидный токен мог бы удерживать их тысячами:
 * каждое соединение — сокет и проход по подписчикам на каждом пинге.
 */
const liveStreams = new Map<string, Set<() => void>>();

/** Регистрирует поток и закрывает самый давний, если владелец превысил предел. */
function trackStream(key: string, close: () => void) {
  let opened = liveStreams.get(key);
  if (!opened) {
    opened = new Set<() => void>();
    liveStreams.set(key, opened);
  }
  // Set хранит порядок вставки: первый в нём — самый давний поток этого владельца.
  while (opened.size >= MAX_STREAMS) {
    const oldest = opened.values().next().value;
    if (!oldest) break;
    opened.delete(oldest);
    oldest();
  }
  opened.add(close);
}

/** Снимает поток с учёта; пустые наборы не копим. */
function untrackStream(key: string, close: () => void) {
  const opened = liveStreams.get(key);
  if (!opened) return;
  opened.delete(close);
  if (opened.size === 0) liveStreams.delete(key);
}

/* ---------- маршрут ---------- */

export async function streamRoutes(app: FastifyInstance) {
  app.get(
    '/stream',
    {
      // Токен едет в адресе: строки «incoming request» с ним в журнал попадать не должны.
      // Предупреждения и ошибки самого маршрута при этом пишутся как обычно.
      logLevel: 'warn',
      // Без этого Fastify завёл бы HEAD /stream на тот же обработчик: ответ никогда
      // не завершится, а подписчик будет висеть, пока клиент сам не отвалится.
      exposeHeadRoute: false,
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => req.ip,
          // Плагин ждёт именно объект ошибки: из него берётся код ответа.
          errorResponseBuilder: () =>
            Object.assign(new Error('Слишком много подключений к потоку. Подождите минуту.'), {
              statusCode: 429,
              code: 'too_many_requests',
            }),
        },
      },
    },
    async (req, reply) => {
      const payload = verifyToken(tokenFrom(req));
      if (!payload) {
        return reply.status(401).send({ error: 'unauthorized', message: 'Требуется вход' });
      }

      // Сотрудник видит все заказы и не привязан к телефону, клиент — только свои.
      const isStaff = payload.role === 'staff' || payload.role === 'admin';

      /*
       * Роль и телефон из токена не принимаем на веру, как и остальные маршруты
       * (см. requireStaff в staff.ts и caller в orders.ts): сотрудника могли уволить,
       * а клиент — удалить аккаунт, и тогда его номер мог отойти другому человеку.
       */
      if (isStaff && !staff.byId(payload.sub)) {
        return reply.status(401).send({ error: 'unauthorized', message: 'Доступ сотрудника отозван, войдите заново' });
      }
      const viewer = isStaff ? null : users.byId(payload.sub);
      if (!isStaff && !viewer) {
        return reply.status(401).send({ error: 'unauthorized', message: 'Профиль не найден, войдите заново' });
      }

      const userId = viewer ? viewer.id : null;
      const phone = viewer ? viewer.phone : null;
      const key = (isStaff ? 'staff:' : 'user:') + payload.sub;

      reply.raw.writeHead(200, streamHeaders(reply));
      reply.raw.flushHeaders();
      // Долгое соединение: без таймаута простоя и без склейки мелких пакетов.
      // Мёртвые и подвисшие соединения подбирает keepalive — пробы TCP каждые 30 секунд.
      reply.raw.socket?.setTimeout(0);
      reply.raw.socket?.setNoDelay(true);
      reply.raw.socket?.setKeepAlive(true, 30_000);

      let open = true;
      let subId = 0;
      let checkedAt = Date.now();

      const drop = () => {
        if (!open) return;
        open = false;
        // Без этого таймер до конца срока токена (у клиента — до 90 дней) держал бы процесс.
        clearTimeout(expiry);
        if (subId) hub.remove(subId);
        untrackStream(key, close);
      };

      const close = () => {
        drop();
        try {
          reply.raw.end();
        } catch {
          /* соединение уже разорвано */
        }
      };

      /** Действует ли доступ прямо сейчас: срок токена и запись в базе, но не чаще RECHECK_MS. */
      const accessValid = (): boolean => {
        const t = Date.now();
        if (payload.exp * 1000 <= t) return false;
        if (t - checkedAt < RECHECK_MS) return true;
        checkedAt = t;
        return isStaff ? !!staff.byId(payload.sub) : !!users.byId(payload.sub);
      };

      // Смена кончилась — поток закрываем сам: клиент переподключится и получит честный 401.
      const ttl = Math.max(0, payload.exp * 1000 - Date.now());
      const expiry = setTimeout(close, Math.min(ttl, MAX_TIMER_MS));

      const send = (event: StreamEvent) => {
        if (!open) return;
        // Токен истёк, сотрудника уволили, клиент удалил аккаунт — дальше не отдаём ничего.
        if (!accessValid()) {
          close();
          return;
        }
        // Клиент перестал читать: копить события в памяти процесса нельзя, рвём соединение.
        if (reply.raw.writableLength > MAX_BUFFER_BYTES) {
          close();
          return;
        }
        try {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch {
          // Клиент отвалился между проверкой и записью — отписываемся молча.
          drop();
        }
      };

      req.raw.on('close', drop);
      req.raw.on('error', drop);
      reply.raw.on('error', drop);

      // Больше MAX_STREAMS вкладок на одного владельца не держим: лишнее закрываем.
      trackStream(key, close);

      // Подсказка браузеру, как быстро переподключаться после обрыва.
      reply.raw.write(`retry: ${RETRY_MS}\n\n`);

      // Снимок текущего состояния: столики всем, дальше заказы — по одному событию на заказ.
      try {
        send({ type: 'tables', tables: tables.state() });
        const snapshot = viewer ? activeForUser(viewer.id, viewer.phone) : orders.forStaff();
        for (const order of snapshot) send({ type: 'order', order });
      } catch (err) {
        app.log.error({ err }, 'не удалось отдать снимок состояния в поток');
      }

      if (open) {
        subId = hub.add({ userId, phone, staff: isStaff, send, close });
      } else {
        close();
      }

      // Fastify не должен закрывать ответ: поток живёт до закрытия вкладки.
      reply.hijack();
      return reply;
    },
  );
}
