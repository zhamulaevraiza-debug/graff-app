/**
 * Проверка живых обновлений: клиент видит свой заказ, кухня — все заказы,
 * телефон клиента в его поток не попадает.
 *
 * Запуск при работающем сервере с SMS_PROVIDER=log:
 *   node --experimental-strip-types scripts/stream-test.ts [адрес] [логин] [PIN]
 */
const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const staffLogin = process.argv[3] || 'kitchen';
const staffPin = process.argv[4] || '1234';
const phone = '999' + String(Date.now()).slice(-7);

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function call(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await fetch(base + path, {
    ...rest,
    headers: {
      ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) as any }; }
  catch { return { status: res.status, body: text as any }; }
}

interface Listener { events: any[]; stop: () => void }

/** Подписка на поток: читает непрерывно, складывая события в массив. */
async function listen(token: string): Promise<Listener> {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/stream?token=${encodeURIComponent(token)}`, { signal: ctrl.signal });
  if (!res.ok || !res.body) throw new Error('поток не открылся: ' + res.status);
  const events: any[] = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data:')) continue;
            try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* не JSON */ }
          }
        }
      }
    } catch { /* поток закрыт */ }
  })();
  return { events, stop: () => ctrl.abort() };
}

console.log(`Проверка живых обновлений ${base}\n`);

/* Клиент входит */
const rq = await call('/auth/request-code', { method: 'POST', body: JSON.stringify({ phone, consent: true }) });
const verify = await call('/auth/verify', { method: 'POST', body: JSON.stringify({ phone, code: rq.body?.devCode, name: 'Поток' }) });
const userToken: string = verify.body?.token || '';
check('клиент вошёл', !!userToken);

const login = await call('/staff/login', { method: 'POST', body: JSON.stringify({ login: staffLogin, pin: staffPin }) });
const staffToken: string = login.body?.token || '';
check('сотрудник вошёл', !!staffToken);

/* Оба подписываются */
const client = await listen(userToken);
const kitchen = await listen(staffToken);
await sleep(600);
check('клиент получил снимок столиков', client.events.some(e => e.type === 'tables'));
check('кухня получила снимок столиков', kitchen.events.some(e => e.type === 'tables'));

/* Клиент делает заказ */
const order = await call('/orders', {
  method: 'POST',
  token: userToken,
  body: JSON.stringify({ consent: true, format: 'togo', table: null, payment: 'cash', lines: [{ name: 'Фри', unit: 150, qty: 1 }] }),
});
const no: number = order.body?.no;
await sleep(800);
check('кухня сразу видит новый заказ', kitchen.events.some(e => e.type === 'order' && e.order.no === no), `заказ №${no}`);
check('клиент видит свой заказ', client.events.some(e => e.type === 'order' && e.order.no === no));

/* Кухня принимает заказ */
await call(`/staff/orders/${no}/accept`, { method: 'POST', token: staffToken, body: JSON.stringify({ eta: 20 }) });
await sleep(800);
check('клиент получил статус «принят»',
  client.events.some(e => e.type === 'order' && e.order.no === no && e.order.status === 'accepted'));
check('кухня получила статус «принят»',
  kitchen.events.some(e => e.type === 'order' && e.order.no === no && e.order.status === 'accepted'));

/* Готов */
await call(`/staff/orders/${no}/status`, { method: 'POST', token: staffToken, body: JSON.stringify({ status: 'cooking' }) });
await call(`/staff/orders/${no}/status`, { method: 'POST', token: staffToken, body: JSON.stringify({ status: 'ready' }) });
await sleep(900);
check('клиент получил статус «готов»',
  client.events.some(e => e.type === 'order' && e.order.no === no && e.order.status === 'ready'));

/* Приватность */
const clientOrders = client.events.filter(e => e.type === 'order');
check('телефон не попадает в поток клиента', clientOrders.every(e => e.order.phone === undefined));
check('кухня видит телефон гостя', kitchen.events.some(e => e.type === 'order' && e.order.no === no && typeof e.order.phone === 'string'));

/* Чужой заказ не приходит клиенту */
const other = '999' + String(Date.now() + 1).slice(-7);
const rq2 = await call('/auth/request-code', { method: 'POST', body: JSON.stringify({ phone: other, consent: true }) });
const v2 = await call('/auth/verify', { method: 'POST', body: JSON.stringify({ phone: other, code: rq2.body?.devCode, name: 'Другой' }) });
const otherOrder = await call('/orders', {
  method: 'POST',
  token: v2.body?.token,
  body: JSON.stringify({ consent: true, format: 'togo', table: null, payment: 'cash', lines: [{ name: 'Чай', unit: 200, qty: 1 }] }),
});
await sleep(800);
check('чужой заказ клиенту не приходит',
  !client.events.some(e => e.type === 'order' && e.order.no === otherOrder.body?.no), `чужой заказ №${otherOrder.body?.no}`);

/* Гость без входа: ключ на заказ открывает поток только по этому заказу */
const guestOrder = await call('/orders', {
  method: 'POST',
  body: JSON.stringify({
    consent: true, format: 'togo', table: null, payment: 'cash',
    name: 'Гость', phone: '9990000001',
    lines: [{ name: 'Наггетсы', unit: 180, qty: 1 }],
  }),
});
const guestNo: number = guestOrder.body?.no;
const guestToken: string = guestOrder.body?.orderToken || '';
check('гостю выдан ключ на его заказ', !!guestToken, `заказ №${guestNo}`);

if (guestToken) {
  const guest = await listen(guestToken);
  await sleep(700);
  check('гость сразу видит свой заказ', guest.events.some(e => e.type === 'order' && e.order.no === guestNo));
  check('телефон в потоке гостя не отдаётся',
    guest.events.filter(e => e.type === 'order').every(e => e.order.phone === undefined));

  await call(`/staff/orders/${guestNo}/accept`, { method: 'POST', token: staffToken, body: JSON.stringify({ eta: 15 }) });
  await sleep(800);
  check('гость получил статус «принят»',
    guest.events.some(e => e.type === 'order' && e.order.no === guestNo && e.order.status === 'accepted'));
  check('чужой заказ по ключу на заказ не приходит',
    !guest.events.some(e => e.type === 'order' && e.order.no === no), `заказ вошедшего клиента №${no}`);
  guest.stop();
  await sleep(200);
}

client.stop();
kitchen.stop();
await sleep(200);

console.log(`\n${failures === 0 ? 'Живые обновления работают' : `Провалено проверок: ${failures}`}`);
process.exit(failures === 0 ? 0 : 1);
