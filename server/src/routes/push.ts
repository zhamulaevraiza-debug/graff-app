/**
 * Подписка на push-уведомления.
 *
 * Порядок такой: приложение спрашивает открытый ключ (GET /push/key), браузер по нему
 * оформляет подписку у своего push-сервиса и присылает её нам (POST /push/subscribe).
 * Выключил уведомления — присылает адрес подписки на удаление (POST /push/unsubscribe).
 *
 * Подписываться разрешаем только клиенту с подтверждённым профилем — тому, кто вошёл по SMS.
 * Ключ гостевого заказа (sub вида «order:1005») сюда не пускаем: он привязан к номеру,
 * который никто не подтверждал, — иначе на чужой, наугад введённый номер приходили бы
 * уведомления о чужих заказах. Значит, push — только для входивших по SMS; гость видит
 * статус на экране заказа в открытом приложении (живой поток SSE) и уведомлений не получает.
 *
 * Адрес подписки (endpoint) проверяется в push.ts по списку известных push-сервисов:
 * POST по нему делает сервер, и произвольный адрес превратил бы этот маршрут в способ
 * стучаться с нашего сервера куда угодно, в том числе на соседние внутренние службы.
 *
 * Сам адрес подписки в журнал не пишем: это адрес конкретного браузера человека.
 * В журнале остаётся только имя push-сервиса — этого хватает, чтобы разбираться с недоставкой.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { bearer, verifyToken } from '../auth.ts';
import { audit, users } from '../db.ts';
import { isPushEnabled, publicKey, removeSubscription, saveSubscription } from '../push.ts';
import type { ApiError } from '../types.ts';

/** Ответ об ошибке в формате ApiError. */
function fail(reply: FastifyReply, status: number, error: string, message: string) {
  const body: ApiError = { error, message };
  return reply.status(status).send(body);
}

/** Строка профиля клиента по токену; гостевой ключ на один заказ профилем не считается. */
function profile(req: FastifyRequest) {
  const payload = verifyToken(bearer(req.headers.authorization));
  if (!payload || payload.role !== 'user') return null;
  // Профиль перепроверяем по базе: аккаунт могли удалить, а токен живёт до 90 дней.
  return users.byId(payload.sub) ?? null;
}

/** Имя push-сервиса из адреса подписки: только оно попадает в журнал. */
function serviceOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'неизвестен';
  }
}

export async function pushRoutes(app: FastifyInstance) {
  /**
   * Открытый ключ VAPID. Публичный по определению — он и так уезжает в браузер.
   * null означает «уведомления на сервере не настроены»: приложение просто не покажет переключатель.
   */
  app.get('/push/key', async () => ({ publicKey: publicKey() }));

  /** Сохранение подписки браузера. */
  app.post<{ Body: { subscription?: unknown } }>(
    '/push/subscribe',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!isPushEnabled()) {
        return fail(reply, 503, 'push_disabled', 'Уведомления пока не настроены на сервере');
      }

      const user = profile(req);
      if (!user) {
        return fail(reply, 401, 'unauthorized', 'Войдите по номеру телефона, чтобы получать уведомления');
      }

      const endpoint = saveSubscription({
        userId: user.id,
        phone: user.phone,
        subscription: req.body?.subscription,
      });
      if (!endpoint) {
        // Сюда же попадает подписка с адресом не от известного push-сервиса: подробности
        // клиенту не нужны, а в ответе им незачем подсказывать, что именно не подошло.
        return fail(reply, 400, 'bad_subscription', 'Подписка не принята: неизвестный вид или адрес push-сервиса');
      }

      audit('user:' + user.id, 'push.subscribed', { service: serviceOf(endpoint) });
      return { ok: true };
    },
  );

  /**
   * Удаление подписки. Токен не требуем: человек мог выключить уведомления после того,
   * как срок токена истёк, и подписка иначе осталась бы в базе навсегда. Знать чужой
   * endpoint посторонний не может — браузер выдаёт его только своему приложению.
   *
   * Этот маршрут зовётся с того устройства, где выключили переключатель. Подписки при
   * удалении аккаунта убирает removeSubscriptionsFor из push.ts (её место — рядом с
   * users.remove в DELETE /me); пока вызова там нет, мёртвые строки отсекаются при отправке.
   */
  app.post<{ Body: { endpoint?: unknown } }>(
    '/push/unsubscribe',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
      if (!endpoint) return fail(reply, 400, 'bad_request', 'Не указан адрес подписки');

      const removed = removeSubscription(endpoint);
      const user = profile(req);
      audit(user ? 'user:' + user.id : 'guest', 'push.unsubscribed', {
        service: serviceOf(endpoint),
        removed,
      });

      // Подписки уже не было — для приложения это тот же успех: уведомления не придут.
      return { ok: true };
    },
  );
}
