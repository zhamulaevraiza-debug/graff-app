/**
 * Поток живых событий (Server-Sent Events).
 *
 * GET /stream — одно долгое соединение на вкладку: кухня получает все заказы,
 * клиент — только свои, и все получают занятость столиков.
 * Браузерный EventSource не умеет слать заголовки, поэтому токен принимается
 * и через Authorization: Bearer …, и через параметр запроса ?token=…
 *
 * Ответ пишется в reply.raw в обход сериализации Fastify: тело не заканчивается,
 * пока клиент не закроет вкладку. Заголовок X-Accel-Buffering: no обязателен —
 * иначе nginx копит ответ в буфере и события приходят пачками с задержкой.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { OutgoingHttpHeaders } from 'node:http';
import { bearer, verifyToken } from '../auth.ts';
import { orders, tables } from '../db.ts';
import { hub } from '../events.ts';
import type { ApiOrder, StreamEvent } from '../types.ts';

/** Через сколько миллисекунд браузеру пробовать переподключиться после обрыва. */
const RETRY_MS = 3000;

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

export async function streamRoutes(app: FastifyInstance) {
  app.get('/stream', async (req, reply) => {
    const payload = verifyToken(tokenFrom(req));
    if (!payload) {
      return reply.status(401).send({ error: 'unauthorized', message: 'Требуется вход' });
    }

    // Сотрудник видит все заказы и не привязан к телефону, клиент — только свои.
    const isStaff = payload.role === 'staff' || payload.role === 'admin';
    const userId = isStaff ? null : payload.sub;
    const phone = isStaff ? null : (payload.phone ?? null);

    reply.raw.writeHead(200, streamHeaders(reply));
    reply.raw.flushHeaders();
    // Долгое соединение: без таймаута и без склейки мелких пакетов.
    reply.raw.socket?.setTimeout(0);
    reply.raw.socket?.setNoDelay(true);

    let open = true;
    let subId = 0;

    const send = (event: StreamEvent) => {
      if (!open) return;
      try {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // Клиент отвалился между проверкой и записью — отписываемся молча.
        open = false;
        if (subId) hub.remove(subId);
      }
    };

    const close = () => {
      open = false;
      if (subId) hub.remove(subId);
      try {
        reply.raw.end();
      } catch {
        /* соединение уже разорвано */
      }
    };

    const drop = () => {
      open = false;
      if (subId) hub.remove(subId);
    };
    req.raw.on('close', drop);
    req.raw.on('error', drop);
    reply.raw.on('error', drop);

    // Подсказка браузеру, как быстро переподключаться после обрыва.
    reply.raw.write(`retry: ${RETRY_MS}\n\n`);

    // Снимок текущего состояния: столики всем, дальше заказы — по одному событию на заказ.
    try {
      send({ type: 'tables', tables: tables.state() });
      const snapshot = isStaff ? orders.forStaff() : activeForUser(payload.sub, phone);
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
  });
}
