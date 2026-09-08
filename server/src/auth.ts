/**
 * Токены и проверка секретов.
 *
 * Токен — обычный JWT с подписью HS256 на секрете JWT_SECRET; внешних библиотек не требуется.
 * PIN сотрудника хранится как scrypt-хэш, код из SMS — как HMAC, чтобы в базе не было
 * ни PIN-кодов, ни кодов подтверждения в открытом виде.
 */
import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from './config.ts';

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export interface TokenPayload {
  /** идентификатор пользователя или сотрудника */
  sub: string;
  role: 'user' | 'staff' | 'admin';
  /** телефон клиента: позволяет показать заказы, внесённые персоналом по звонку */
  phone?: string;
  exp: number;
}

export function signToken(payload: Omit<TokenPayload, 'exp'>, ttlSeconds: number): string {
  const body: TokenPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = head + '.' + b64url(JSON.stringify(body));
  const sig = b64url(createHmac('sha256', config.jwtSecret).update(data).digest());
  return data + '.' + sig;
}

export function verifyToken(token: string | undefined): TokenPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = parts[0] + '.' + parts[1];
  const expected = createHmac('sha256', config.jwtSecret).update(data).digest();
  const got = fromB64url(parts[2]);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const payload = JSON.parse(fromB64url(parts[1]).toString('utf8')) as TokenPayload;
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Достаёт токен из заголовка Authorization: Bearer … */
export const bearer = (header?: string) =>
  header && header.startsWith('Bearer ') ? header.slice(7).trim() : undefined;

/* ---------- коды из SMS ---------- */

/** Код без ведущего нуля, чтобы не терялся при копировании. */
export function generateCode(length = config.code.length): string {
  const min = 10 ** (length - 1);
  return String(randomInt(min, 10 ** length));
}

export const hashCode = (phone: string, code: string) =>
  createHmac('sha256', config.jwtSecret).update(`${phone}:${code}`).digest('hex');

export function codeMatches(phone: string, code: string, hash: string): boolean {
  const a = Buffer.from(hashCode(phone, code));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ---------- PIN сотрудника ---------- */

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pin, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function pinMatches(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const a = scryptSync(pin, salt, 32);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ---------- телефон ---------- */

/** Приводит номер к 10 цифрам после +7: и «8 938…», и «+7 938…», и «938…». */
export function normalizePhone(raw: string): string | null {
  let d = (raw || '').replace(/\D/g, '');
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) d = d.slice(1);
  return d.length === 10 ? d : null;
}

export const displayPhone = (d: string) =>
  `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8, 10)}`;
