/**
 * Добавление сотрудника кухни.
 *
 * Запуск из папки server:
 *   node --experimental-strip-types scripts/add-staff.ts <логин> [PIN] [имя] [роль]
 *   npm run seed:staff -- <логин> [PIN] [имя] [роль]
 *
 * PIN лучше не писать в командной строке: он остаётся в истории оболочки
 * (PowerShell хранит ConsoleHost_history.txt в открытом виде) и виден в списке процессов.
 * Если второй аргумент не цифровой, PIN берётся из переменной окружения STAFF_PIN,
 * а когда нет и её — спрашивается с клавиатуры, причём ввод не отображается.
 *
 * Роль: staff (по умолчанию) или admin. PIN сохраняется только как хэш —
 * восстановить его нельзя, забытый PIN меняется новой записью.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { audit, db, staff } from '../src/db.ts';
import { hashPin } from '../src/auth.ts';

const USAGE =
  'Использование: node --experimental-strip-types scripts/add-staff.ts <логин> [PIN] [имя] [роль]\n' +
  'PIN можно не указывать: он будет взят из переменной STAFF_PIN или спрошен с клавиатуры.\n' +
  'Роль: staff (по умолчанию) или admin. PIN — только цифры, не короче 4 знаков, лучше 6.';

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Одинаковые цифры: 0000, 1111 — такое подбирают первым же перебором. */
const isRepeat = (pin: string) => /^(\d)\1+$/.test(pin);

/** Последовательность вида 1234 или 4321 — вторая по очевидности комбинация. */
function isSequence(pin: string): boolean {
  let up = true;
  let down = true;
  for (let i = 1; i < pin.length; i++) {
    const step = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
    if (step !== 1) up = false;
    if (step !== -1) down = false;
  }
  return up || down;
}

/**
 * Спрашивает PIN с клавиатуры. В терминале ввод скрыт: readline пишет эхо в наш
 * поток вывода, а мы его не пропускаем. Так PIN не попадает ни на экран,
 * ни в историю команд, ни в список процессов.
 */
async function askPin(): Promise<string> {
  const hidden = !!process.stdin.isTTY;
  let muted = false;
  const out = new Writable({
    write(chunk, _encoding, done) {
      if (!muted) process.stdout.write(chunk as Buffer);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output: out, terminal: hidden });
  try {
    return await new Promise<string>(resolve => {
      // Конец ввода без строки (запуск без терминала) — считаем, что PIN не задан.
      rl.on('close', () => resolve(''));
      rl.question('PIN (ввод не отображается): ', answer => resolve(answer));
      // Приглашение уже напечатано, дальше глушим всё: следом идёт эхо набранных цифр.
      muted = hidden;
    });
  } finally {
    muted = false;
    rl.close();
    // Перевод строки после скрытого ввода: собственный Enter пользователя мы съели.
    process.stdout.write('\n');
  }
}

const args = process.argv.slice(2);
const loginArg = args[0];
if (!loginArg) die(USAGE);

// Регистр не меняем: вход (/staff/login) ищет логин точным совпадением.
const login = loginArg.trim();
if (!/^[a-zа-я0-9_-]{2,32}$/i.test(login)) {
  die('Логин: от 2 до 32 символов, только буквы, цифры, дефис и подчёркивание.');
}

// PIN во втором аргументе необязателен, поэтому узнаём его по виду: только цифры.
// Всё остальное на этом месте — уже имя сотрудника.
const pinArg = args[1] && /^\d+$/.test(args[1]) ? args[1] : undefined;
const [nameArg, roleArg] = pinArg ? args.slice(2) : args.slice(1);

const name = (nameArg || '').trim() || 'Кухня';

const roleInput = (roleArg || 'staff').trim().toLowerCase();
if (roleInput !== 'staff' && roleInput !== 'admin') {
  die('Роль может быть только staff или admin.');
}
const role: 'staff' | 'admin' = roleInput === 'admin' ? 'admin' : 'staff';

// Занятый логин проверяем до вопроса о PIN: незачем спрашивать секрет впустую.
if (staff.byLogin(login)) {
  die(`Логин «${login}» уже занят. Выберите другой.`);
}

const pin = (pinArg || (process.env.STAFF_PIN || '').trim() || (await askPin())).trim();

if (!/^\d{4,}$/.test(pin)) {
  die('PIN должен состоять только из цифр и быть не короче 4 знаков.\n' + USAGE);
}
if (isRepeat(pin) || isSequence(pin)) {
  die(
    'Такой PIN подбирается за секунды: одинаковые цифры (0000) и последовательности (1234, 4321) не годятся.\n' +
    'Возьмите 6 непредсказуемых цифр: у входа на кухню нет блокировки по учётной записи, только предел частоты.',
  );
}
if (pin.length < 6) {
  console.warn('Внимание: четырёх- и пятизначный PIN перебирается за считаные дни. Лучше 6 знаков.');
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
console.log('PIN сохранён в виде хэша, в базе его нет. Вход — в панели персонала, логин вводится с учётом регистра.');
