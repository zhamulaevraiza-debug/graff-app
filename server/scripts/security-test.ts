/**
 * Проверка защиты: чужие заказы, перебор кода и PIN, ограничения частоты, доверие к данным клиента.
 *
 * Запуск при работающем сервере с SMS_PROVIDER=log:
 *   node --experimental-strip-types scripts/security-test.ts [адрес] [логин] [PIN]
 */
const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const staffLogin = process.argv[3] || 'kitchen';
const staffPin = process.argv[4] || '1234';
const panelCode = process.argv[5] || '2468';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

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

/** Заводит клиента и возвращает его токен. */
async function newUser(name: string) {
  const phone = '999' + String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0');
  const rq = await call('/auth/request-code', { method: 'POST', body: JSON.stringify({ phone, consent: true }) });
  const v = await call('/auth/verify', { method: 'POST', body: JSON.stringify({ phone, code: rq.body?.devCode, name }) });
  return { phone, token: v.body?.token as string };
}

console.log(`Проверка защиты ${base}\n`);

const alice = await newUser('Алиса');
const bob = await newUser('Борис');
check('два клиента заведены', !!alice.token && !!bob.token);

/* Чужие заказы */
console.log('\nДоступ к чужим данным');
const order = await call('/orders', {
  method: 'POST', token: alice.token,
  body: JSON.stringify({ consent: true, format: 'togo', table: null, payment: 'cash', lines: [{ name: 'Фри', unit: 150, qty: 1 }] }),
});
const no: number = order.body?.no;
check('заказ создан', !!no, `№${no}`);

const foreignRead = await call(`/orders/${no}`, { token: bob.token });
check('чужой заказ не читается', foreignRead.status === 404 || foreignRead.status === 403, `статус ${foreignRead.status}`);

const foreignCancel = await call(`/orders/${no}/cancel`, { method: 'POST', token: bob.token });
check('чужой заказ не отменяется', foreignCancel.status >= 400, `статус ${foreignCancel.status}`);

const listBob = await call('/orders', { token: bob.token });
const bobOrders: any[] = Array.isArray(listBob.body) ? listBob.body : (listBob.body?.orders ?? []);
check('чужой заказ не виден в списке', !bobOrders.some(o => o.no === no));

/* Подделка токена */
console.log('\nТокены');
const tampered = alice.token.split('.').slice(0, 2).join('.') + '.' + 'ZmFrZQ';
const withTampered = await call('/me', { token: tampered });
check('подделанная подпись отклоняется', withTampered.status === 401, `статус ${withTampered.status}`);

const staffFake = await call('/staff/orders', { token: alice.token });
check('токен клиента не пускает в панель кухни', staffFake.status === 401 || staffFake.status === 403, `статус ${staffFake.status}`);

/* Доверие к данным клиента */
console.log('\nДанные из запроса');
const lie = await call('/orders', {
  method: 'POST', token: alice.token,
  body: JSON.stringify({ consent: true, format: 'togo', table: null, payment: 'cash', total: 1, lines: [{ name: 'Бургер', unit: 330, qty: 3 }] }),
});
check('сумма считается сервером, а не берётся из запроса', lie.body?.total === 990, `получено ${lie.body?.total}`);

const noConsent = await call('/orders', {
  method: 'POST', token: alice.token,
  body: JSON.stringify({ format: 'togo', table: null, payment: 'cash', lines: [{ name: 'Чай', unit: 200, qty: 1 }] }),
});
check('заказ без согласия отклоняется', noConsent.status === 400, `статус ${noConsent.status}`);

const emptyLines = await call('/orders', {
  method: 'POST', token: alice.token,
  body: JSON.stringify({ consent: true, format: 'togo', table: null, payment: 'cash', lines: [] }),
});
check('пустой заказ отклоняется', emptyLines.status === 400, `статус ${emptyLines.status}`);

const negative = await call('/orders', {
  method: 'POST', token: alice.token,
  body: JSON.stringify({ consent: true, format: 'togo', table: null, payment: 'cash', lines: [{ name: 'Хак', unit: -500, qty: 1 }] }),
});
check('отрицательная цена отклоняется', negative.status === 400, `статус ${negative.status}`);

/* Перебор кода */
console.log('\nПеребор и частота');
const victim = '999' + String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0');
await call('/auth/request-code', { method: 'POST', body: JSON.stringify({ phone: victim, consent: true }) });
let blocked = false;
for (let i = 0; i < 8; i++) {
  const r = await call('/auth/verify', { method: 'POST', body: JSON.stringify({ phone: victim, code: '0001' }) });
  if (r.status === 429) { blocked = true; break; }
}
check('перебор кода останавливается', blocked, blocked ? 'после нескольких попыток' : 'ограничение не сработало');

const again = await call('/auth/request-code', { method: 'POST', body: JSON.stringify({ phone: victim, consent: true }) });
check('повторный код не выдаётся сразу', again.status === 429, `статус ${again.status}`);

/* Панель кухни: код заведения — первый рубеж, без него PIN даже не проверяется */
const noTicket = await call('/staff/login', { method: 'POST', body: JSON.stringify({ login: staffLogin, pin: staffPin }) });
check('вход сотрудника без кода заведения не отвечает', noTicket.status === 401 && noTicket.body?.error === 'panel_required', `статус ${noTicket.status}`);

const badPanel = await call('/staff/panel', { method: 'POST', body: JSON.stringify({ code: '0000' }) });
check('неверный код заведения отклоняется', badPanel.status === 401, `статус ${badPanel.status}`);

const panel = await call('/staff/panel', { method: 'POST', body: JSON.stringify({ code: panelCode }) });
check('верный код заведения даёт пропуск', panel.status === 200 && !!panel.body?.ticket, `статус ${panel.status}`);
const panelTicket: string = panel.body?.ticket || '';

let pinBlocked = false;
for (let i = 0; i < 12; i++) {
  const r = await call('/staff/login', { method: 'POST', body: JSON.stringify({ login: staffLogin, pin: '0000', ticket: panelTicket }) });
  if (r.status === 429) { pinBlocked = true; break; }
}
check('перебор PIN сотрудника ограничивается', pinBlocked, pinBlocked ? 'сработало ограничение частоты' : 'ограничение не сработало');

/* После ограничения вход настоящим PIN может быть временно закрыт — это ожидаемо */
const staffOk = await call('/staff/login', { method: 'POST', body: JSON.stringify({ login: staffLogin, pin: staffPin, ticket: panelTicket }) });
check('сервер отвечает на вход сотрудника', staffOk.status === 200 || staffOk.status === 429, `статус ${staffOk.status}`);

console.log(`\n${failures === 0 ? 'Защита работает' : `Провалено проверок: ${failures}`}`);
process.exit(failures === 0 ? 0 : 1);
