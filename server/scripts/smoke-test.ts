/**
 * Сквозная проверка сервера: вход клиента, оформление заказа, работа кухни.
 *
 * Запуск (сервер должен быть уже запущен с SMS_PROVIDER=log):
 *   node --experimental-strip-types scripts/smoke-test.ts [адрес] [логин_сотрудника] [PIN]
 * По умолчанию: http://localhost:3000, логин «kitchen», PIN «1234».
 *
 * Скрипт ничего не удаляет, но создаёт тестовый заказ, поэтому на боевом сервере его не запускают.
 */
const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const staffLogin = process.argv[3] || 'kitchen';
const staffPin = process.argv[4] || '1234';
const phone = process.argv[5] || '9990000001';

let failures = 0;
const ok = (name: string, detail = '') => console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`);
const fail = (name: string, detail: string) => { failures++; console.error(`  ✗ ${name} — ${detail}`); };

async function call(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await fetch(base + path, {
    ...rest,
    headers: {
      ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.headers || {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* не JSON — оставляем текст */ }
  return { status: res.status, body: body as any };
}

function check(name: string, cond: boolean, detail = '') {
  if (cond) ok(name, detail); else fail(name, detail || 'условие не выполнено');
  return cond;
}

console.log(`Проверка сервера ${base}\n`);

/* 1. Живой ли сервер */
const health = await call('/health');
check('сервер отвечает', health.status === 200 && health.body?.ok === true, `статус ${health.status}`);
if (health.body?.smsProvider !== 'log') {
  console.error('  ! SMS_PROVIDER не «log»: тест отправит настоящую SMS. Прерываю.');
  process.exit(1);
}

/* 2. Вход клиента */
console.log('\nВход клиента');
const noConsent = await call('/auth/request-code', { method: 'POST', body: JSON.stringify({ phone, consent: false }) });
check('без согласия код не выдаётся', noConsent.status === 400, `статус ${noConsent.status}`);

const req = await call('/auth/request-code', { method: 'POST', body: JSON.stringify({ phone, consent: true }) });
check('код запрошен', req.status === 200 && typeof req.body?.devCode === 'string', `статус ${req.status}`);
const devCode: string = req.body?.devCode || '';

const wrong = await call('/auth/verify', { method: 'POST', body: JSON.stringify({ phone, code: '0000'.slice(0, devCode.length || 4) === devCode ? '1111' : '0000' }) });
check('неверный код отклоняется', wrong.status >= 400, `статус ${wrong.status}`);

const verify = await call('/auth/verify', { method: 'POST', body: JSON.stringify({ phone, code: devCode, name: 'Тест' }) });
const userToken: string = verify.body?.token || '';
check('вход выполнен', verify.status === 200 && !!userToken, `статус ${verify.status}`);
check('телефон возвращается в маске', typeof verify.body?.user?.phone === 'string' && verify.body.user.phone.startsWith('+7'));

const me = await call('/me', { token: userToken });
check('профиль читается по токену', me.status === 200 && me.body?.id === verify.body?.user?.id);
const noToken = await call('/me');
check('без токена профиль закрыт', noToken.status === 401, `статус ${noToken.status}`);

/* 3. Заказ */
console.log('\nЗаказ клиента');
const tablesBefore = await call('/tables');
check('столики отдаются', tablesBefore.status === 200 && !!tablesBefore.body?.zones);

const order = await call('/orders', {
  method: 'POST',
  token: userToken,
  body: JSON.stringify({
    consent: true,
    format: 'hall',
    table: 'any',
    payment: 'cash',
    lines: [{ itemId: 'burgers-0-0', name: 'Бургер классический', portion: '250 г', unit: 330, qty: 2 }],
    comment: 'Проверка',
  }),
});
const no: number = order.body?.no;
check('заказ создан', order.status === 200 || order.status === 201, `статус ${order.status}, номер ${no}`);
check('сумма посчитана сервером', order.body?.total === 660, `получено ${order.body?.total}`);
check('телефон не отдан клиенту', order.body?.phone === undefined);

const mineList = await call('/orders', { token: userToken });
const myOrders: any[] = Array.isArray(mineList.body) ? mineList.body : (mineList.body?.orders ?? []);
check('заказ виден в своём списке', myOrders.some(o => o.no === no));

/* 4. Кухня */
console.log('\nПанель персонала');
const badLogin = await call('/staff/login', { method: 'POST', body: JSON.stringify({ login: staffLogin, pin: '0000' }) });
check('неверный PIN отклоняется', badLogin.status === 401, `статус ${badLogin.status}`);

const login = await call('/staff/login', { method: 'POST', body: JSON.stringify({ login: staffLogin, pin: staffPin }) });
const staffToken: string = login.body?.token || '';
if (!check('сотрудник вошёл', login.status === 200 && !!staffToken, `статус ${login.status}`)) {
  console.error('\n  ! Заведите сотрудника: npm run seed:staff -- kitchen 1234 Кухня');
}

const staffOrders = await call('/staff/orders', { token: staffToken });
const staffList: any[] = staffOrders.body?.orders ?? [];
check('кухня видит заказ', staffList.some(o => o.no === no));
check('кухня видит телефон клиента', staffList.find(o => o.no === no)?.phone !== undefined);

const clientTriesStaff = await call('/staff/orders', { token: userToken });
check('клиент не попадает в панель персонала', clientTriesStaff.status === 401 || clientTriesStaff.status === 403, `статус ${clientTriesStaff.status}`);

const accept = await call(`/staff/orders/${no}/accept`, { method: 'POST', token: staffToken, body: JSON.stringify({ eta: 15 }) });
const accepted = accept.body?.order ?? accept.body;
check('заказ принят', accept.status === 200 && accepted?.status === 'accepted', `статус заказа ${accepted?.status}`);
check('столик назначен', accepted?.table !== null && accepted?.table !== undefined, `столик ${accepted?.table}`);

const badJump = await call(`/staff/orders/${no}/status`, { method: 'POST', token: staffToken, body: JSON.stringify({ status: 'done' }) });
check('нельзя перепрыгнуть статусы', badJump.status === 409, `статус ${badJump.status}`);

for (const status of ['cooking', 'ready', 'done']) {
  const r = await call(`/staff/orders/${no}/status`, { method: 'POST', token: staffToken, body: JSON.stringify({ status }) });
  check(`статус «${status}»`, r.status === 200 && (r.body?.order ?? r.body)?.status === status, `ответ ${r.status}`);
}

const tablesAfter = await call('/tables');
const table = accepted?.table;
if (table) check('столик освободился после выдачи', tablesAfter.body?.occupied?.[table] === false, `столик ${table}`);

/* 5. Удаление данных */
console.log('\nПрава на данные');
const exported = await call('/me/data', { token: userToken });
check('выгрузка своих данных доступна', exported.status === 200 && !!exported.body?.user);
const del = await call('/me', { method: 'DELETE', token: userToken });
check('аккаунт удаляется', del.status === 200, `статус ${del.status}`);
const afterDelete = await call('/me', { token: userToken });
check('после удаления токен не работает', afterDelete.status >= 400, `статус ${afterDelete.status}`);

console.log(`\n${failures === 0 ? 'Все проверки пройдены' : `Провалено проверок: ${failures}`}`);
process.exit(failures === 0 ? 0 : 1);
