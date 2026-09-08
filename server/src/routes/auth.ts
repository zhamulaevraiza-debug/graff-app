/**
 * Вход клиента по коду из SMS и работа с собственным профилем.
 *
 * Пароля у гостя нет: он вводит номер телефона, получает код и обменивает его на токен.
 * Здесь же собраны обязательные по 152-ФЗ права человека на свои данные:
 * доступ (GET /me/data), уточнение (PATCH /me) и удаление вместе с отзывом согласия (DELETE /me).
 *
 * Телефон в журнал не пишем: в сообщениях об ошибках и логах его быть не должно.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
// Только ради типов: плагин ограничения частоты добавляет полю config маршрута ключ rateLimit.
import type {} from '@fastify/rate-limit';
import { config } from '../config.ts';
import { audit, codes, orders, users } from '../db.ts';
import {
  bearer,
  codeMatches,
  displayPhone,
  generateCode,
  hashCode,
  normalizePhone,
  signToken,
  verifyToken,
  type TokenPayload,
} from '../auth.ts';
import { sendCode, smsIsLoopback } from '../sms.ts';
import type { ApiUser, RequestCodeBody, RequestCodeReply, VerifyCodeBody, VerifyCodeReply } from '../types.ts';

/**
 * Версия правовых документов, под которой человек даёт согласие.
 * ДОЛЖНА совпадать с LEGAL_VERSION в src/data/legal.ts приложения:
 * версия сохраняется рядом с согласием и служит доказательством того,
 * какой именно текст был показан гостю. Меняются документы — меняются оба значения.
 */
const LEGAL_VERSION = '1.0';

/** Пауза между двумя SMS на один номер, секунд. */
const RESEND_SECONDS = 60;

/** Максимальная длина имени: столько влезает в чек и на экран кухни. */
const NAME_MAX = 60;

/**
 * Согласие на рекламные рассылки гость отмечает на шаге запроса кода,
 * а профиль появляется только после подтверждения. Держим выбор в памяти
 * до подтверждения кода: до этого момента сохранять его некуда и незачем.
 */
const pendingMarketing = new Map<string, { value: boolean; at: number }>();

function rememberMarketing(phone: string, value: boolean | undefined) {
  // Чистим просроченные записи, чтобы карта не росла бесконечно.
  const deadline = Date.now() - config.code.ttlMinutes * 60_000;
  for (const [key, entry] of pendingMarketing) if (entry.at < deadline) pendingMarketing.delete(key);
  if (value === undefined) pendingMarketing.delete(phone);
  else pendingMarketing.set(phone, { value, at: Date.now() });
}

function takeMarketing(phone: string): boolean | undefined {
  const entry = pendingMarketing.get(phone);
  pendingMarketing.delete(phone);
  if (!entry) return undefined;
  if (entry.at < Date.now() - config.code.ttlMinutes * 60_000) return undefined;
  return entry.value;
}

/** Ошибка с кодом состояния HTTP: её подхватывает общий обработчик в server.ts. */
function fail(status: number, message: string, code = 'bad_request'): Error {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = status;
  err.code = code;
  return err;
}

/** Проверяет токен клиента. Без него дальше идти нельзя. */
function requireUser(req: FastifyRequest): TokenPayload {
  const payload = verifyToken(bearer(req.headers.authorization));
  if (!payload || payload.role !== 'user') throw fail(401, 'Требуется вход', 'unauthorized');
  return payload;
}

/** Профиль по токену. Аккаунт мог быть удалён — тогда токен больше не действует. */
function currentUser(req: FastifyRequest) {
  const payload = requireUser(req);
  const row = users.byId(payload.sub);
  if (!row) throw fail(401, 'Профиль не найден, войдите заново', 'unauthorized');
  return row;
}

function toApiUser(row: { id: string; name: string; phone: string; marketing: number }): ApiUser {
  return {
    id: row.id,
    name: row.name,
    // Свой номер человек видеть вправе; чужие телефоны отдаются только персоналу.
    phone: displayPhone(row.phone),
    marketingConsent: !!row.marketing,
  };
}

export async function authRoutes(app: FastifyInstance) {
  /* ---------- шаг 1: запрос кода ---------- */

  app.post<{ Body: Partial<RequestCodeBody> }>(
    '/auth/request-code',
    // Отдельный, более строгий предел по IP: рассылка кодов стоит денег.
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const body = req.body ?? {};

      // Без согласия обработка персональных данных незаконна (152-ФЗ, ст. 6).
      if (body.consent !== true) {
        throw fail(400, 'Без согласия на обработку персональных данных вход невозможен', 'consent_required');
      }

      const phone = normalizePhone(String(body.phone ?? ''));
      if (!phone) throw fail(400, 'Введите номер полностью', 'bad_phone');

      // Не чаще одного кода в минуту на номер.
      const last = codes.lastRequestAt(phone);
      const passed = Math.floor((Date.now() - last) / 1000);
      if (last && passed < RESEND_SECONDS) {
        const retryAfter = RESEND_SECONDS - passed;
        return reply.status(429).header('Retry-After', String(retryAfter)).send({
          error: 'too_soon',
          message: `Код уже отправлен. Запросить новый можно через ${retryAfter} с.`,
          retryAfter,
        });
      }

      // И не больше нескольких кодов в час: защита от перебора номеров.
      if (codes.countLastHour(phone) >= config.code.perHour) {
        const retryAfter = 3600;
        return reply.status(429).header('Retry-After', String(retryAfter)).send({
          error: 'too_many_codes',
          message: 'Слишком много запросов кода на этот номер. Попробуйте через час или позвоните нам.',
          retryAfter,
        });
      }

      const code = generateCode();
      codes.save(phone, hashCode(phone, code), config.code.ttlMinutes);
      rememberMarketing(phone, body.marketing);

      const sent = await sendCode(phone, code, msg => app.log.info(msg));
      if (!sent.ok) {
        // В журнал — только причина от оператора, без номера и кода.
        app.log.error({ reason: sent.error }, 'SMS с кодом не отправлена');
        throw fail(502, 'Не удалось отправить SMS, попробуйте позвонить нам', 'sms_failed');
      }

      const out: RequestCodeReply = { ok: true, retryAfter: RESEND_SECONDS };
      // В режиме «log» SMS не уходят, поэтому код возвращаем прямо в ответе — только для проверки.
      if (smsIsLoopback()) out.devCode = code;
      return out;
    },
  );

  /* ---------- шаг 2: подтверждение кода ---------- */

  app.post<{ Body: Partial<VerifyCodeBody> }>('/auth/verify', async (req, reply) => {
    const body = req.body ?? {};
    const phone = normalizePhone(String(body.phone ?? ''));
    if (!phone) throw fail(400, 'Введите номер полностью', 'bad_phone');

    const code = String(body.code ?? '').replace(/\D/g, '');
    if (!code) throw fail(400, 'Введите код из SMS', 'code_required');

    const row = codes.get(phone);
    if (!row) throw fail(400, 'Код не запрашивался или устарел', 'code_missing');
    if (row.expires_at <= Date.now()) {
      codes.clear(phone);
      throw fail(400, 'Код не запрашивался или устарел', 'code_expired');
    }

    // Попытку засчитываем до сравнения: иначе перебор кода ничего не стоит.
    codes.bumpAttempt(phone);
    if (row.attempts >= config.code.maxAttempts) {
      codes.clear(phone);
      return reply.status(429).send({
        error: 'too_many_attempts',
        message: 'Слишком много попыток, запросите новый код',
      });
    }

    if (!codeMatches(phone, code, row.code_hash)) {
      const left = Math.max(0, config.code.maxAttempts - row.attempts - 1);
      throw fail(400, left ? `Неверный код. Осталось попыток: ${left}` : 'Неверный код', 'bad_code');
    }

    codes.clear(phone);

    const name = String(body.name ?? '').trim().slice(0, NAME_MAX);
    const user = users.upsert(phone, name || undefined, LEGAL_VERSION, takeMarketing(phone));
    const token = signToken({ sub: user.id, role: 'user', phone }, config.tokenDays * 86400);
    audit('user:' + user.id, 'login');

    const out: VerifyCodeReply = { token, user: toApiUser(user) };
    return out;
  });

  /* ---------- профиль ---------- */

  app.get('/me', async req => toApiUser(currentUser(req)));

  /** Уточнение своих данных — право по 152-ФЗ, ст. 14. */
  app.patch<{ Body: { name?: string; marketing?: boolean } }>('/me', async req => {
    const user = currentUser(req);
    const body = req.body ?? {};

    if (typeof body.name === 'string') {
      const name = body.name.trim().slice(0, NAME_MAX);
      if (!name) throw fail(400, 'Имя не может быть пустым', 'bad_name');
      users.setName(user.id, name);
    }
    // Согласие на рекламу отзывается в один клик (ФЗ «О рекламе», ст. 18); отметка идёт в журнал.
    if (typeof body.marketing === 'boolean') users.setMarketing(user.id, body.marketing);

    return toApiUser(users.byId(user.id)!);
  });

  /**
   * Удаление аккаунта и отзыв согласия на обработку данных.
   * Требование 152-ФЗ (ст. 9, ч. 2) и правил магазинов приложений: удаление должно быть
   * доступно из самого приложения. Заказы при этом обезличиваются — они нужны кафе для учёта.
   */
  app.delete('/me', async req => {
    const user = currentUser(req);
    // Отзыв согласия фиксируем отдельной записью: сам users.remove пишет только факт удаления.
    audit('user:' + user.id, 'consent.revoked', { version: LEGAL_VERSION });
    users.remove(user.id);
    return { ok: true };
  });

  /** Выгрузка своих данных — право на доступ к информации о себе (152-ФЗ, ст. 14). */
  app.get('/me/data', async req => {
    const user = currentUser(req);
    return {
      user: toApiUser(user),
      consent: {
        version: user.consent_version,
        at: user.consent_at,
        marketing: !!user.marketing,
        marketingAt: user.marketing_at,
      },
      orders: orders.byUser(user.id),
      exportedAt: Date.now(),
    };
  });
}
