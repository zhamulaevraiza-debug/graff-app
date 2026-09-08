/**
 * Добавление сотрудника кухни.
 *
 * Запуск из папки server:
 *   node --experimental-strip-types scripts/add-staff.ts <логин> <PIN> [имя] [роль]
 *   npm run seed:staff -- <логин> <PIN> [имя] [роль]
 *
 * Роль: staff (по умолчанию) или admin. PIN сохраняется только как хэш —
 * восстановить его нельзя, забытый PIN меняется новой записью.
 */
import { audit, db, staff } from '../src/db.ts';
import { hashPin } from '../src/auth.ts';

const USAGE =
  'Использование: node --experimental-strip-types scripts/add-staff.ts <логин> <PIN> [имя] [роль]\n' +
  'Роль: staff (по умолчанию) или admin. PIN — только цифры, не короче 4.';

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

const [loginArg, pinArg, nameArg, roleArg] = process.argv.slice(2);

if (!loginArg || !pinArg) die(USAGE);

const login = loginArg.trim().toLowerCase();
if (!/^[a-zа-я0-9_-]{2,32}$/i.test(login)) {
  die('Логин: от 2 до 32 символов, только буквы, цифры, дефис и подчёркивание.');
}

const pin = pinArg.trim();
if (!/^\d{4,}$/.test(pin)) {
  die('PIN должен состоять только из цифр и быть не короче 4 знаков.');
}

const name = (nameArg || '').trim() || 'Кухня';

const role = (roleArg || 'staff').trim().toLowerCase();
if (role !== 'staff' && role !== 'admin') {
  die('Роль может быть только staff или admin.');
}

if (staff.byLogin(login)) {
  die(`Логин «${login}» уже занят. Выберите другой.`);
}

function createOrDie() {
  try {
    return staff.create(login, name, hashPin(pin), role);
  } catch (err) {
    // Логин уникален в базе: сюда попадаем, если запись есть, но отключена (disabled).
    const message = err instanceof Error ? err.message : String(err);
    die(message.includes('UNIQUE')
      ? `Логин «${login}» уже занят (запись отключена).`
      : `Не удалось создать сотрудника: ${message}`);
  }
}

const created = createOrDie();

audit('script:add-staff', 'staff.created', { login: created.login, role: created.role });
db.close();

console.log(`Сотрудник создан: ${created.name} (логин «${created.login}», роль ${created.role}).`);
console.log('PIN сохранён в виде хэша, в базе его нет. Вход — в панели персонала.');
