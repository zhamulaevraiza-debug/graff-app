/**
 * Проверка push-уведомлений: подписка, адресность и удаление вместе с аккаунтом.
 *
 * Запуск при работающем сервере с SMS_PROVIDER=log и заданными ключами VAPID:
 *   node --experimental-strip-types scripts/push-test.ts [адрес] [логин] [PIN]
 *
 * Настоящую доставку проверить нельзя без браузера, поэтому подписки здесь вымышленные:
 * важно, что сервер их принимает, никому лишнему не шлёт и удаляет по требованию.
 */
import { db } from '../src/db.ts';

const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const staffLogin = process.argv[3] || 'kitchen';
const staffPin = process.argv[4] || '1234';

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

const fakeSub = (mark: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/graff-test-${mark}-${Date.now()}`,
  keys: {
    p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
    auth: 'tBHItJI5svbpez7KI4CCXg',
  },
});

async function newUser(name: string) {
  const phone = '999' + String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0');
  const rq = await call('/auth/request-code', { method: 'POST', body: JSON.stringify({ phone, consent: true }) });
  const v = await call('/auth/verify', { method: 'POST', body: JSON.stringify({ phone, code: rq.body?.devCode, name }) });
  return { phone, token: v.body?.token as string };
}

const countSubs = (phone: string) =>
  (db.prepare('SELECT COUNT(*) AS c FROM push_subs WHERE phone = ?').get(phone) as { c: number }).c;

console.log(`Проверка push ${base}\n`);

const key = await call('/push/key');
check('публичный ключ отдаётся', key.status === 200 && typeof key.body?.publicKey === 'string',
  key.body?.publicKey ? 'ключи VAPID настроены' : 'ключей нет — задайте VAPID_* и повторите');
if (!key.body?.publicKey) process.exit(1);

/* Подписка */
console.log('\nПодписка');
const alice = await newUser('Алиса');
const anon = await call('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: fakeSub('anon') }) });
check('без входа подписаться нельзя', anon.status === 401, `статус ${anon.status}`);

const bad = await call('/push/subscribe', { method: 'POST', token: alice.token, body: JSON.stringify({ subscription: { endpoint: 'нет' } }) });
check('битая подписка отклоняется', bad.status === 400, `статус ${bad.status}`);

const sub = fakeSub('alice');
const ok = await call('/push/subscribe', { method: 'POST', token: alice.token, body: JSON.stringify({ subscription: sub }) });
check('подписка сохраняется', ok.status === 200 && countSubs(alice.phone) === 1);

/* Адресность: чужой гостевой заказ на номер Алисы не должен её будить */
console.log('\nАдресность');
const staff = await call('/staff/login', { method: 'POST', body: JSON.stringify({ login: staffLogin, pin: staffPin }) });
if (staff.status !== 200) {
  console.error('  ! вход сотрудника недоступен (статус ' + staff.status + '), часть проверок пропущена');
} else {
  const guestOrder = await call('/orders', {
    method: 'POST',
    body: JSON.stringify({
      consent: true, format: 'togo', table: null, payment: 'cash',
      name: 'Чужой', phone: alice.phone,
      lines: [{ name: 'Чай', unit: 200, qty: 1 }],
    }),
  });
  check('гостевой заказ на чужой номер принимается', guestOrder.status === 201 || guestOrder.status === 200, `статус ${guestOrder.status}`);
  const no = guestOrder.body?.no;
  const before = (db.prepare('SELECT failed FROM push_subs WHERE endpoint = ?').get(sub.endpoint) as { failed: number } | undefined)?.failed ?? 0;
  await call(`/staff/orders/${no}/accept`, { method: 'POST', token: staff.body.token, body: JSON.stringify({ eta: 15 }) });
  await new Promise(r => setTimeout(r, 1500));
  const after = (db.prepare('SELECT failed FROM push_subs WHERE endpoint = ?').get(sub.endpoint) as { failed: number } | undefined)?.failed ?? 0;
  // Отправки не было — значит счётчик неудач не двигался и подписка на месте
  check('чужой гостевой заказ не будит владельца номера', after === before && countSubs(alice.phone) === 1,
    `неудач было ${before}, стало ${after}`);
}

/* Удаление аккаунта */
console.log('\nУдаление данных');
const del = await call('/me', { method: 'DELETE', token: alice.token });
check('аккаунт удаляется', del.status === 200, `статус ${del.status}`);
check('подписки удаляются вместе с аккаунтом', countSubs(alice.phone) === 0, `осталось ${countSubs(alice.phone)}`);

console.log(`\n${failures === 0 ? 'Push настроен верно' : `Провалено проверок: ${failures}`}`);
process.exit(failures === 0 ? 0 : 1);
