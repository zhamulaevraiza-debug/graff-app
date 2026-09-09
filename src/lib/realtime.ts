/**
 * Живые обновления заказов и столиков через Server-Sent Events (server/src/routes/stream.ts).
 *
 * Клиент получает только свои заказы, панель персонала — все: разграничение делает сервер
 * по токену. EventSource не умеет заголовки, поэтому токен уходит параметром адреса —
 * соединение обязано идти по HTTPS.
 *
 * ВНИМАНИЕ (утечка учётных данных). Адрес запроса попадает в журналы: сервер кафе пишет
 * url каждого запроса (server/src/server.ts), то же делают прокси и сервисы доставки логов.
 * То есть строка вида «GET /stream?token=…» с живым токеном (у гостя 90 дней, у сотрудника
 * 12 часов) сохраняется открытым текстом — тому, у кого есть доступ к логам, этого хватает
 * для полного входа в аккаунт гостя или в панель кухни. Здесь, на клиенте, закрыть это нечем.
 * Нужна одна из двух правок на сервере:
 *  - убрать строку запроса из журнала (сериализатор req: url: r.url.split('?')[0]); либо
 *  - выдавать одноразовый короткоживущий билет (POST /stream/ticket по Authorization,
 *    ответ — ticket на 60 секунд) и подключаться как ?ticket=…; тогда в журнал попадает
 *    уже погашенный билет. Как только маршрут появится — переключить адрес ниже на него.
 *
 * Соединение восстанавливается само: пауза растёт 1 → 2 → 5 → 10 → 30 секунд и сбрасывается
 * после первого удачно принятого события. Но отказ авторизации EventSource сообщает тем же
 * onerror, что и обрыв сети, поэтому несколько неудач подряд мы проверяем обычным запросом:
 * если сервер отвечает 401, переподключаться бессмысленно — нужен новый вход.
 */
import {
  API_URL, ROUTES, isLive, getToken, getStaffToken, orderToken, watchedOrderNo,
  me, getOrder, staffTables, ApiError,
  type ApiOrder, type StreamEvent, type TablesState,
} from './api';

export type StreamState = 'connecting' | 'online' | 'offline';

export interface StreamOptions {
  /** true — поток кухни (все заказы), иначе поток текущего гостя */
  staff?: boolean;
  /** Ключ вместо обычного: так гость без регистрации следит за своим единственным заказом. */
  token?: string;
  onOrder(order: ApiOrder): void;
  onTables(tables: TablesState): void;
  onState?(state: StreamState): void;
  /**
   * Токен больше не годится: протух, отозван или стёрт вместе с аккаунтом.
   * Переподключения остановлены, нужен вход заново.
   */
  onAuthLost?(): void;
}

/** Паузы между попытками переподключения, миллисекунды. */
const DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000];

/** После скольких неудач подряд, не открывших соединение, проверяем токен запросом. */
const PROBE_AFTER = 3;

const noop = () => {};

/**
 * Подписка на поток событий. Возвращает функцию отписки: вызывать при размонтировании
 * экрана или выходе из аккаунта. В демо-режиме и без токена соединение не открывается.
 */
export function connectStream(opts: StreamOptions): () => void {
  const { staff = false, onOrder, onTables, onState, onAuthLost } = opts;
  // Состояние сообщаем только при изменении: события приходят часто, лишние перерисовки не нужны.
  let shown: StreamState | null = null;
  const state = (s: StreamState) => {
    if (s === shown) return;
    shown = s;
    onState?.(s);
  };

  /** Ключ, на котором держится поток: у гостя — ключ на его заказ, иначе вход или смена. */
  const readToken = () => (opts.token !== undefined ? orderToken() : staff ? getStaffToken() : getToken());
  const token = opts.token || (staff ? getStaffToken() : getToken());
  if (!isLive() || !token || typeof EventSource === 'undefined') {
    // Демо-режим, гость не вошёл или браузер без EventSource — живых обновлений нет.
    state('offline');
    return noop;
  }

  const url = `${API_URL}${ROUTES.stream}?token=${encodeURIComponent(token)}`;

  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let stopped = false;
  /** Неудачные попытки подряд, в которых соединение так и не открылось. */
  let failures = 0;
  /** Открылось ли соединение в текущей попытке: при отказе 401 onopen не приходит. */
  let opened = false;
  /** Проверка токена уже идёт — второй запрос не нужен. */
  let checking = false;

  const handle = (raw: string) => {
    let event: StreamEvent;
    try {
      event = JSON.parse(raw) as StreamEvent;
    } catch {
      return; // мусор в потоке пропускаем молча
    }
    // Соединение живое: сбрасываем паузу переподключения и счётчик неудач.
    attempt = 0;
    failures = 0;
    opened = true;
    state('online');
    if (event.type === 'order') onOrder(event.order);
    else if (event.type === 'tables') onTables(event.tables);
    // 'ping' — только признак живого соединения
  };

  const close = () => {
    if (!source) return;
    source.onopen = null;
    source.onerror = null;
    source.onmessage = null;
    source.close();
    source = null;
  };

  const schedule = () => {
    if (stopped || timer) return;
    const pause = DELAYS[Math.min(attempt, DELAYS.length - 1)];
    attempt += 1;
    timer = setTimeout(() => {
      timer = null;
      open();
    }, pause);
  };

  /** Вход больше не действует: прекращаем попытки и сообщаем вызывающему коду. */
  function authLost() {
    if (stopped) return;
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    close();
    detach();
    state('offline');
    onAuthLost?.();
  }

  /**
   * Отличаем отказ авторизации от обрыва связи: EventSource про 401 сообщает тем же onerror,
   * а сам ответ нам недоступен. Дёргаем лёгкий запрос — при 401 обычный слой уже стёр токен,
   * и дальше долбиться на сервер каждые 30 секунд бессмысленно.
   */
  async function checkAuth() {
    if (checking || stopped) return;
    checking = true;
    try {
      if (staff) await staffTables();
      // У гостя нет профиля: проверяем ключ тем единственным заказом, который он открывает.
      else if (opts.token !== undefined) {
        const no = watchedOrderNo();
        if (no != null) await getOrder(no);
      } else await me();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        authLost();
        return;
      }
      // Прочие ошибки (нет связи, 500) о токене ничего не говорят — продолжаем попытки.
    } finally {
      checking = false;
      // Считаем заново: следующая проверка — ещё через PROBE_AFTER неудач.
      failures = 0;
    }
  }

  function open() {
    if (stopped) return;
    close();
    opened = false;
    state('connecting');
    const es = new EventSource(url);
    source = es;
    es.onopen = () => {
      if (stopped) return;
      opened = true;
      failures = 0;
      state('online');
    };
    es.onmessage = e => handle(e.data as string);
    // Сервер может помечать события именем — принимаем оба варианта.
    for (const name of ['order', 'tables', 'ping']) {
      es.addEventListener(name, e => handle((e as MessageEvent<string>).data));
    }
    es.onerror = () => {
      if (stopped) return;
      // Соединение не открывалось — возможно, сервер ответил 401, а не пропала сеть.
      const silent = !opened;
      state('offline');
      close();
      failures = silent ? failures + 1 : 0;
      if (failures >= PROBE_AFTER) void checkAuth();
      schedule();
    };
  }

  // Сеть вернулась — не ждём паузу, соединяемся сразу; пропала — сообщаем экрану.
  const onNetworkUp = () => {
    if (stopped) return;
    attempt = 0;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    open();
  };
  const onNetworkDown = () => {
    if (stopped) return;
    state('offline');
    close();
  };
  // Выход из аккаунта в соседней вкладке: наш токен стёрли или заменили — поток уже не наш.
  const onStorage = () => {
    if (stopped) return;
    // Сравнивать надо с тем же ключом, на котором открыт поток: у гостя это ключ на заказ,
    // а не вход по телефону, которого у него и нет.
    if (readToken() !== token) authLost();
  };

  function detach() {
    window.removeEventListener('online', onNetworkUp);
    window.removeEventListener('offline', onNetworkDown);
    window.removeEventListener('storage', onStorage);
  }

  window.addEventListener('online', onNetworkUp);
  window.addEventListener('offline', onNetworkDown);
  window.addEventListener('storage', onStorage);

  open();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    close();
    detach();
    // Живых обновлений больше нет — индикатор связи не должен остаться в 'online'.
    state('offline');
  };
}
