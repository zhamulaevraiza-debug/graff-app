/**
 * Живые обновления через Server-Sent Events.
 *
 * Кухня подписывается на все заказы, клиент — только на свои: подписчик хранит
 * идентификатор пользователя и телефон, и получает событие, если заказ относится к нему.
 * SSE выбран вместо веб-сокетов: он проходит через любой обратный прокси и сам переподключается.
 */
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
