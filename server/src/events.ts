/**
 * Живые обновления через Server-Sent Events.
 *
 * Кухня подписывается на все заказы, клиент — только на свои: подписчик хранит
 * идентификатор пользователя и телефон, и получает событие, если заказ относится к нему.
 * SSE выбран вместо веб-сокетов: он проходит через любой обратный прокси и сам переподключается.
 *
 * Поток работает, только пока приложение открыто, поэтому важные шаги заказа дублируются
 * push-уведомлением (см. push.ts): свернул телефон — всё равно узнаешь, что заказ готов.
 */
import { notifyOrder } from './push.ts';
import type { ApiOrder, StreamEvent, TablesState } from './types.ts';

export interface Subscriber {
  id: number;
  /** null — подписчик видит все заказы (кухня) */
  userId: string | null;
  phone: string | null;
  staff: boolean;
  send: (event: StreamEvent) => void;
  close: () => void;
}

let seq = 0;
const subscribers = new Map<number, Subscriber>();

export const hub = {
  add(sub: Omit<Subscriber, 'id'>): number {
    const id = ++seq;
    subscribers.set(id, { ...sub, id });
    return id;
  },
  remove(id: number) {
    subscribers.delete(id);
  },
  count() {
    return subscribers.size;
  },
  /** Рассылает заказ кухне и тому клиенту, которому он принадлежит. */
  publishOrder(order: ApiOrder, owner: { userId: string | null; phone: string | null }) {
    for (const sub of subscribers.values()) {
      const mine = (owner.userId && sub.userId === owner.userId) || (owner.phone && sub.phone === owner.phone);
      if (!sub.staff && !mine) continue;
      // клиенту не отдаём телефон из заказа
      const payload = sub.staff ? order : { ...order, phone: undefined, mine: true };
      sub.send({ type: 'order', order: payload });
    }
    // Push — только на те три шага, ради которых человек и ждёт сообщения.
    // «Готовится» и «выдан» он уже видит сам, будить телефон ради них незачем.
    if (order.status === 'accepted' || order.status === 'ready' || order.status === 'cancelled') {
      notifyOrder(order, owner);
    }
  },
  /** Занятость столиков нужна и клиенту (выбор столика), и кухне. */
  publishTables(tables: TablesState) {
    for (const sub of subscribers.values()) sub.send({ type: 'tables', tables });
  },
  /** Периодический пинг, чтобы прокси не рвал соединение по таймауту. */
  ping() {
    for (const sub of subscribers.values()) sub.send({ type: 'ping' });
  },
  closeAll() {
    for (const sub of subscribers.values()) sub.close();
    subscribers.clear();
  },
};
