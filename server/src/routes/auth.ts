/**
 * Вход клиента по коду из SMS и работа с собственным профилем.
 *
 * Пароля у гостя нет: он вводит номер телефона, получает код и обменивает его на токен.
 * Здесь же собраны обязательные по 152-ФЗ права человека на свои данные:
 * доступ (GET /me/data), уточнение (PATCH /me) и удаление вместе с отзывом согласия (DELETE /me).
 *
 * Телефон в журнал не пишем: в сообщениях об ошибках и логах его быть не должно.
 */
import type { FastifyError, FastifyInstance, FastifyRequest } from 'fastify';
// Только ради типов: плагин ограничения частоты добавляет полю config маршрута ключ rateLimit.
import type {} from '@fastify/rate-limit';
import { config, isProd } from '../config.ts';
import { audit, codes, orders, users } from '../db.ts';
import { removeSubscriptionsFor } from '../push.ts';
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
import type { ApiError, ApiUser, RequestCodeBody, RequestCodeReply, VerifyCodeBody, VerifyCodeReply } from '../types.ts';

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
 * Номера, по которым отправка SMS идёт прямо сейчас.
 *
 * Код записывается в базу только после ответа оператора (иначе отказ оператора зря
 * съедал бы паузу в минуту и часовую квоту), а пока идёт ожидание, проверки
 * codes.lastRequestAt и codes.countLastHour ещё ничего не видят. Без этой отметки
 * десяток одновременных запросов на один номер дал бы десяток SMS: и деньги кафе,
 * и звонок «мне пришло двадцать сообщений».
 */
const sendingNow = new Set<string>();

/**
 * Русский текст для частых служебных ошибок Fastify: свои сообщения у них английские,
 * а гостю нужна подсказка, что именно не так с запросом.
 */
const FASTIFY_MESSAGES: Record<string, string> = {
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'Отправьте данные в формате JSON',
  FST_ERR_CTP_INVALID_JSON: 'Тело запроса не является корректным JSON',
  FST_ERR_CTP_BODY_TOO_LARGE: 'Запрос слишком большой',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'Тело запроса пустое',
  FST_ERR_VALIDATION: 'Некорректный запрос',
};

/** Код ошибки в теле ответа должен отвечать статусу, иначе клиент разберёт его неверно. */
const CODE_BY_STATUS: Record<number, string> = {
  404: 'not_found',
  405: 'method_not_allowed',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
};

/** Ошибка с кодом состояния HTTP и текстом, который можно показать гостю. */
function fail(status: number, message: string, code = 'bad_request'): Error {
  const err = new Error(message) as Error & { statusCode: number; code: string; expose: boolean };
  err.statusCode = status;
  err.code = code;
  err.expose = true; // текст написан для человека, его отдаём как есть
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
  /**
   * Предохранитель развёртывания. Провайдер «log» ничего не отправляет и по умолчанию
   * подставляется сам (config.sms.provider), поэтому боевой сервер легко запустить с ним
   * незаметно: SMS никому не приходят, а вход «работает» через код в ответе.
   * Останавливаемся сразу, на старте, а не после первой кражи чужого аккаунта.
   */
  if (isProd && smsIsLoopback()) {
    throw new Error(
      'SMS_PROVIDER=log недопустим при NODE_ENV=production: коды входа не отправляются. ' +
        'Укажите в .env реального оператора (smsru или smsc) вместе с его ключами.',
    );
  }

  /**
   * Свой обработчик ошибок: маршруты регистрируются раньше общего обработчика в server.ts,
   * а плагин запоминает обработчик на момент своей регистрации — без этого клиент получил бы
   * ответ формата Fastify вместо ApiError {error, message} и английский текст от плагинов.
   */
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) app.log.error({ err, url: req.url }, 'ошибка в маршрутах входа');
    const own = (err as { expose?: boolean }).expose === true;
    const code = String(err.code ?? '');
    let error = 'bad_request';
    let message = 'Некорректный запрос';
    if (own) {
      error = code || 'bad_request';
      message = err.message;
    } else if (status >= 500) {
      error = 'internal';
      message = 'Внутренняя ошибка сервера';
    } else if (status === 429) {
      error = 'too_many_requests';
      message = 'Слишком много запросов. Подождите немного и попробуйте снова.';
    } else {
      // Чужие 4xx: код подбираем под статус, а понятный текст сохраняем — его пишет,
      // например, разборщик тела в server.ts. Служебные коды FST_* наружу не выносим.
      error = CODE_BY_STATUS[status] ?? 'bad_request';
      message = FASTIFY_MESSAGES[code] ?? (err.message && !code.startsWith('FST_') ? err.message : 'Некорректный запрос');
    }
    const body: ApiError = { error, message };
    reply.status(status).send(body);
  });

  /* ---------- шаг 1: запрос кода ---------- */

  app.post<{ Body: Partial<RequestCodeBody> }>(
    '/auth/request-code',
    // Отдельный, более строгий предел по IP: рассылка кодов стоит денег.
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const body = req.body ?? {};

      // Отметка body.marketing здесь только принимается для совместимости с приложением,
      // но не сохраняется: запрос никем не подтверждён, а согласие на рекламу должно
      // проставляться самим человеком — на шаге /auth/verify или через PATCH /me.

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

      // Отправка по этому номеру уже идёт: второй код не нужен, ответ как при обычной паузе.
      if (sendingNow.has(phone)) {
        return reply.status(429).header('Retry-After', String(RESEND_SECONDS)).send({
          error: 'too_soon',
          message: `Код уже отправляется. Запросить новый можно через ${RESEND_SECONDS} с.`,
          retryAfter: RESEND_SECONDS,
        });
      }

      const code = generateCode();
      // Сначала отправка, потом сохранение: запись кода поднимает и паузу в минуту,
      // и счётчик часовой квоты, поэтому отказ оператора не должен её создавать —
      // иначе гость получает 502 и вдобавок блокировку, хотя ни одной SMS не ушло.
      sendingNow.add(phone);
      let sent;
      try {
        sent = await sendCode(phone, code, msg => app.log.info(msg));
        // Сохраняем до снятия отметки: следующий запрос должен уже увидеть запись кода.
        if (sent.ok) codes.save(phone, hashCode(phone, code), config.code.ttlMinutes);
      } finally {
        sendingNow.delete(phone);
      }
      if (!sent.ok) {
        // В журнал — только причина от оператора, без номера и кода.
        app.log.error({ reason: sent.error }, 'SMS с кодом не отправлена');
        throw fail(502, 'Не удалось отправить SMS, попробуйте позвонить нам', 'sms_failed');
      }

      const out: RequestCodeReply = { ok: true, retryAfter: RESEND_SECONDS };
      // Вне боя провайдер «log» ничего не отправляет, поэтому код возвращаем прямо в ответе —
      // только для проверки. В бою этот путь закрыт дважды: проверкой isProd и остановкой на старте.
      if (smsIsLoopback() && !isProd) out.devCode = code;
      return out;
    },
  );

  /* ---------- шаг 2: подтверждение кода ---------- */

  app.post<{ Body: Partial<VerifyCodeBody> & { marketing?: boolean } }>(
    '/auth/verify',
    // Свой предел по вводу: подбор кода идёт именно сюда, и с одного адреса можно
    // обстреливать коды сразу многих номеров. Общего лимита в 300 запросов в минуту мало.
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (req, reply) => {
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
        // Новый код можно запросить, когда пройдёт пауза от последней отправки, — как в request-code.
        const passed = Math.floor((Date.now() - codes.lastRequestAt(phone)) / 1000);
        const retryAfter = Math.min(RESEND_SECONDS, Math.max(1, RESEND_SECONDS - passed));
        return reply.status(429).header('Retry-After', String(retryAfter)).send({
          error: 'too_many_attempts',
          message: 'Слишком много попыток, запросите новый код',
          retryAfter,
        });
      }

      if (!codeMatches(phone, code, row.code_hash)) {
        const left = Math.max(0, config.code.maxAttempts - row.attempts - 1);
        throw fail(400, left ? `Неверный код. Осталось попыток: ${left}` : 'Неверный код', 'bad_code');
      }

      codes.clear(phone);

      const name = String(body.name ?? '').trim().slice(0, NAME_MAX);
      /*
       * Согласие на рекламу принимаем только здесь: на этом шаге человек доказал,
       * что номер его. Отметку из /auth/request-code не используем — тот запрос никем
       * не подтверждён, и посторонний, знающий номер, мог бы проставить чужое согласие.
       * Если поля нет (так шлёт нынешнее приложение), в upsert уходит undefined,
       * и COALESCE в базе сохраняет прежнее значение — молча стереть согласие нельзя.
       */
      const marketing = typeof body.marketing === 'boolean' ? body.marketing : undefined;
      const existing = users.byPhone(phone);
      const user = users.upsert(phone, name || undefined, LEGAL_VERSION, existing ? undefined : marketing);

      if (existing) {
        /*
         * Новая редакция документов: в UPDATE версия перезаписывается, а дата согласия остаётся
         * прежней, поэтому без отдельной записи журнал утверждал бы, что человек принял
         * новый текст в день, когда он видел старый. Согласие доказывает кафе (152-ФЗ).
         * Для новых профилей запись 'consent.given' делает сам users.upsert.
         */
        if (existing.consent_version !== LEGAL_VERSION) {
          audit('user:' + user.id, 'consent.given', { version: LEGAL_VERSION, previous: existing.consent_version });
        }
        // Смену отметки о рекламе пишет в журнал сам setMarketing.
        if (marketing !== undefined && marketing !== !!existing.marketing) users.setMarketing(user.id, marketing);
      }

      const token = signToken({ sub: user.id, role: 'user', phone }, config.tokenDays * 86400);
      audit('user:' + user.id, 'login');

      // Перечитываем профиль: отметка о рекламе могла измениться строкой выше.
      const out: VerifyCodeReply = { token, user: toApiUser(users.byId(user.id)!) };
      return out;
    },
  );

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
    // Подписки на уведомления — это адреса устройств человека: удаляем вместе с профилем,
    // иначе они остались бы в базе после отзыва согласия.
    removeSubscriptionsFor({ userId: user.id, phone: user.phone });
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
      // выгрузка по 152-ФЗ должна быть полной, поэтому предел ставим заведомо больше любой истории
      orders: orders.byUser(user.id, 10_000),
      exportedAt: Date.now(),
    };
  });
}
