/**
 * Отправка SMS с кодом входа.
 *
 * Поддержаны два российских агрегатора, выбор в переменной SMS_PROVIDER:
 *   smsru — sms.ru, ключ в SMS_API_ID;
 *   smsc  — smsc.ru, логин и пароль в SMS_LOGIN и SMS_PASSWORD.
 * Значение «log» ничего не отправляет и пишет код в журнал сервера: годится только для проверки.
 *
 * Имя отправителя (SMS_SENDER) должно быть заранее зарегистрировано у оператора,
 * иначе сообщения не доставляются. Код входа — сервисное сообщение, отдельного
 * согласия на рекламу для него не требуется, но добавлять в него рекламу нельзя.
 */
import { config } from './config.ts';

export interface SmsResult {
  ok: boolean;
  /** идентификатор сообщения у оператора — пригодится при разборе жалоб */
  id?: string;
  error?: string;
}

const text = (code: string) => config.sms.template.replace('{code}', code);

async function sendViaSmsRu(phone10: string, code: string): Promise<SmsResult> {
  const url = new URL('https://sms.ru/sms/send');
  url.searchParams.set('api_id', config.sms.apiId);
  url.searchParams.set('to', '7' + phone10);
  url.searchParams.set('msg', text(code));
  url.searchParams.set('from', config.sms.sender);
  url.searchParams.set('json', '1');
  const res = await fetch(url, { method: 'POST' });
  const data = (await res.json()) as { status: string; status_text?: string; sms?: Record<string, { status: string; sms_id?: string; status_text?: string }> };
  if (data.status !== 'OK') return { ok: false, error: data.status_text || 'sms.ru: отказ' };
  const entry = data.sms?.['7' + phone10];
  if (entry && entry.status !== 'OK') return { ok: false, error: entry.status_text || 'sms.ru: сообщение не принято' };
  return { ok: true, id: entry?.sms_id };
}

async function sendViaSmsc(phone10: string, code: string): Promise<SmsResult> {
  const url = new URL('https://smsc.ru/sys/send.php');
  url.searchParams.set('login', config.sms.login);
  url.searchParams.set('psw', config.sms.password);
  url.searchParams.set('phones', '7' + phone10);
  url.searchParams.set('mes', text(code));
  url.searchParams.set('sender', config.sms.sender);
  url.searchParams.set('fmt', '3');
  const res = await fetch(url, { method: 'POST' });
  const data = (await res.json()) as { id?: number; cnt?: number; error?: string; error_code?: number };
  if (data.error) return { ok: false, error: `smsc.ru: ${data.error}` };
  return { ok: true, id: data.id ? String(data.id) : undefined };
}

/**
 * Отправляет код. Возвращает результат, а не бросает исключение:
 * клиенту не нужно знать подробности сбоя у оператора связи.
 */
export async function sendCode(phone10: string, code: string, log: (msg: string) => void): Promise<SmsResult> {
  try {
    switch (config.sms.provider) {
      case 'smsru': return await sendViaSmsRu(phone10, code);
      case 'smsc': return await sendViaSmsc(phone10, code);
      default:
        log(`[SMS отключены] код для +7${phone10}: ${code}`);
        return { ok: true, id: 'log' };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'сбой отправки SMS' };
  }
}

/** В режиме «log» код возвращается приложению, чтобы можно было проверить вход без реальных SMS. */
export const smsIsLoopback = () => config.sms.provider === 'log';
