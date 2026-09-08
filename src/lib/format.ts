/** Форматирование: рубли, время, телефон. */

export const rub = (n: number | string) => `${n} ₽`;
export const pad = (n: number) => String(n).padStart(2, '0');
export const fmtTime = (ts: number) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
export const digits = (s?: string | null) => (s || '').replace(/\D/g, '');

/** Русские множественные формы: plural(5, 'минута', 'минуты', 'минут') */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/**
 * Нормализует набранные цифры к 10 цифрам после +7.
 * Понимает и «сырой» ввод (8XXXXXXXXXX, 7XXXXXXXXXX, XXXXXXXXXX), и собственный вывод маски («+7 938 900-90-67»,
 * в том числе частичный «+7 93»), поэтому маску можно безопасно применять к каждому нажатию клавиши.
 */
export function phoneDigits10(raw: string): string {
  const s = (raw || '').trim();
  // вывод маски: код страны уже есть — убираем его, остальное и есть номер
  let d = /^\+7/.test(s) ? digits(s.slice(2)) : digits(s);
  // 11 цифр — значит, первая была кодом страны (8 или 7). Цифры «8» и «7» в начале сами по себе не отбрасываем:
  // с них начинаются местные городские коды (например, 8712 в Чеченской Республике).
  if (d.length >= 11 && (d[0] === '7' || d[0] === '8')) d = d.slice(1);
  return d.slice(0, 10);
}

/** Маска «+7 938 900-90-67» по мере ввода. Пустой ввод → ''. */
export function formatPhone(raw: string): string {
  const d = phoneDigits10(raw);
  if (!d) return '';
  let out = '+7';
  if (d.length > 0) out += ' ' + d.slice(0, 3);
  if (d.length > 3) out += ' ' + d.slice(3, 6);
  if (d.length > 6) out += '-' + d.slice(6, 8);
  if (d.length > 8) out += '-' + d.slice(8, 10);
  return out;
}
export const isPhoneComplete = (raw: string) => phoneDigits10(raw).length === 10;
/** Ключ для сравнения номеров (профиль ↔ заказ по звонку). */
export const phoneKey = (raw?: string | null) => phoneDigits10(raw || '');
export const telHref = (raw: string) => 'tel:+7' + phoneDigits10(raw);
