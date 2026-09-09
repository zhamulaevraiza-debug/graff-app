/**
 * База данных (SQLite). Один файл на диске сервера — этого достаточно для одного кафе,
 * а при росте нагрузки слой запросов можно перенести на PostgreSQL, не трогая маршруты.
 *
 * Все персональные данные (телефон, имя) лежат только здесь, поэтому файл базы
 * должен находиться на сервере в России (152-ФЗ, ч. 5 ст. 18) и попадать в резервные копии.
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config, DEFAULT_TABLES } from './config.ts';
import type { ApiLine, ApiOrder, Format, OrderStatus, PaymentId } from './types.ts';

mkdirSync(dirname(config.dbFile), { recursive: true });
export const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  phone         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  consent_at    INTEGER,
  consent_version TEXT,
  marketing     INTEGER NOT NULL DEFAULT 0,
  marketing_at  INTEGER
);

CREATE TABLE IF NOT EXISTS codes (
  phone       TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS code_requests (
  phone      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS code_requests_phone ON code_requests(phone, created_at);

CREATE TABLE IF NOT EXISTS orders (
  no           INTEGER PRIMARY KEY,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  status       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  accepted_at  INTEGER,
  ready_at     INTEGER,
  done_at      INTEGER,
  eta          INTEGER,
  format       TEXT NOT NULL,
  table_no     INTEGER,
  pickup       TEXT,
  pickup_label TEXT,
  payment      TEXT NOT NULL,
  lines        TEXT NOT NULL,
  comment      TEXT,
  total        INTEGER NOT NULL,
  name         TEXT NOT NULL,
  phone        TEXT,
  by_phone     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id, created_at);

CREATE TABLE IF NOT EXISTS tables_state (
  n         INTEGER PRIMARY KEY,
  zone      TEXT NOT NULL,
  occupied  INTEGER NOT NULL DEFAULT 0,
  order_no  INTEGER
);

CREATE TABLE IF NOT EXISTS staff (
  id         TEXT PRIMARY KEY,
  login      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  pin_hash   TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'staff',
  disabled   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Журнал действий с персональными данными: согласия, отзывы, удаления.
-- Нужен как доказательство согласия (бремя доказывания лежит на кафе).
CREATE TABLE IF NOT EXISTS audit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      INTEGER NOT NULL,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  details TEXT
);
CREATE INDEX IF NOT EXISTS audit_at ON audit(at);
`);

/** Заполняет таблицу столиков из настроек, если она пустая. */
const seedTables = db.transaction(() => {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM tables_state').get() as { c: number }).c;
  if (count > 0) return;
  const ins = db.prepare('INSERT INTO tables_state (n, zone, occupied) VALUES (?, ?, 0)');
  for (const n of DEFAULT_TABLES.terrace) ins.run(n, 'terrace');
  for (const n of DEFAULT_TABLES.hall) ins.run(n, 'hall');
});
seedTables();

/* ---------- строки таблиц ---------- */

interface UserRow {
  id: string; phone: string; name: string; created_at: number;
  consent_at: number | null; consent_version: string | null; marketing: number; marketing_at: number | null;
}
interface OrderRow {
  no: number; user_id: string | null; status: OrderStatus; created_at: number;
  accepted_at: number | null; ready_at: number | null; done_at: number | null; eta: number | null;
  format: Format; table_no: number | null; pickup: string | null; pickup_label: string | null;
  payment: PaymentId; lines: string; comment: string | null; total: number; name: string;
  phone: string | null; by_phone: number;
}
export interface StaffRow {
  id: string; login: string; name: string; pin_hash: string; role: 'staff' | 'admin'; disabled: number; created_at: number;
}

const now = () => Date.now();

/* ---------- журнал ---------- */

export function audit(actor: string, action: string, details?: unknown) {
  db.prepare('INSERT INTO audit (at, actor, action, details) VALUES (?, ?, ?, ?)')
    .run(now(), actor, action, details === undefined ? null : JSON.stringify(details));
}

/* ---------- пользователи ---------- */

export const users = {
  byPhone(phone: string): UserRow | undefined {
    return db.prepare('SELECT * FROM users WHERE phone = ?').get(phone) as UserRow | undefined;
  },
  byId(id: string): UserRow | undefined {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  },
  /** Создаёт пользователя или обновляет его данные после подтверждения кода. */
  upsert(phone: string, name: string | undefined, consentVersion: string, marketing: boolean | undefined): UserRow {
    const existing = users.byPhone(phone);
    const t = now();
    if (existing) {
      db.prepare(`UPDATE users SET name = COALESCE(NULLIF(?, ''), name),
                  consent_at = COALESCE(consent_at, ?), consent_version = ?,
                  marketing = COALESCE(?, marketing),
                  marketing_at = CASE WHEN ? IS NULL THEN marketing_at WHEN ? = 1 THEN ? ELSE NULL END
                  WHERE id = ?`)
        .run(name ?? '', t, consentVersion, marketing === undefined ? null : Number(marketing),
             marketing === undefined ? null : Number(marketing), marketing === undefined ? null : Number(marketing), t, existing.id);
      return users.byId(existing.id)!;
    }
    const id = randomUUID();
    db.prepare(`INSERT INTO users (id, phone, name, created_at, consent_at, consent_version, marketing, marketing_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, phone, name ?? '', t, t, consentVersion, Number(marketing ?? false), marketing ? t : null);
    audit('user:' + id, 'consent.given', { version: consentVersion, marketing: !!marketing });
    return users.byId(id)!;
  },
  setName(id: string, name: string) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id);
  },
  setMarketing(id: string, accepted: boolean) {
    db.prepare('UPDATE users SET marketing = ?, marketing_at = ? WHERE id = ?').run(Number(accepted), accepted ? now() : null, id);
    audit('user:' + id, accepted ? 'marketing.given' : 'marketing.revoked');
  },
  /**
   * Удаление аккаунта: пользователь стирается, а его заказы обезличиваются —
   * они нужны кафе для учёта, но больше не связаны с человеком.
   */
  remove(id: string) {
    const tx = db.transaction(() => {
      db.prepare("UPDATE orders SET user_id = NULL, phone = NULL, name = 'Гость' WHERE user_id = ?").run(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    });
    tx();
    audit('user:' + id, 'account.deleted');
  },
};

/* ---------- коды из SMS ---------- */

export const codes = {
  save(phone: string, hash: string, ttlMinutes: number) {
    const t = now();
    db.prepare(`INSERT INTO codes (phone, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)
                ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
                attempts = 0, created_at = excluded.created_at`)
      .run(phone, hash, t + ttlMinutes * 60000, t);
    db.prepare('INSERT INTO code_requests (phone, created_at) VALUES (?, ?)').run(phone, t);
  },
  get(phone: string) {
    return db.prepare('SELECT * FROM codes WHERE phone = ?').get(phone) as
      { phone: string; code_hash: string; expires_at: number; attempts: number; created_at: number } | undefined;
  },
  countLastHour(phone: string): number {
    const row = db.prepare('SELECT COUNT(*) AS c FROM code_requests WHERE phone = ? AND created_at > ?')
      .get(phone, now() - 3600_000) as { c: number };
    return row.c;
  },
  lastRequestAt(phone: string): number {
    const row = db.prepare('SELECT MAX(created_at) AS t FROM code_requests WHERE phone = ?').get(phone) as { t: number | null };
    return row.t ?? 0;
  },
  bumpAttempt(phone: string) {
    db.prepare('UPDATE codes SET attempts = attempts + 1 WHERE phone = ?').run(phone);
  },
  clear(phone: string) {
    db.prepare('DELETE FROM codes WHERE phone = ?').run(phone);
  },
};

/* ---------- заказы ---------- */

function rowToOrder(r: OrderRow, opts: { withPhone: boolean; userId?: string | null }): ApiOrder {
  return {
    no: r.no,
    status: r.status,
    createdAt: r.created_at,
    acceptedAt: r.accepted_at ?? undefined,
    readyAt: r.ready_at ?? undefined,
    doneAt: r.done_at ?? undefined,
    eta: r.eta ?? undefined,
    format: r.format,
    table: r.table_no,
    pickup: (r.pickup as 'asap' | 'time' | null) ?? undefined,
    pickupLabel: r.pickup_label ?? undefined,
    payment: r.payment,
    lines: JSON.parse(r.lines) as ApiLine[],
    comment: r.comment ?? undefined,
    total: r.total,
    name: r.name,
    phone: opts.withPhone ? (r.phone ?? undefined) : undefined,
    mine: opts.userId ? r.user_id === opts.userId : undefined,
    byPhone: r.by_phone ? true : undefined,
  };
}

export interface NewOrder {
  userId: string | null;
  format: Format;
  table: number | null;
  pickup?: 'asap' | 'time';
  pickupLabel?: string;
  payment: PaymentId;
  lines: ApiLine[];
  comment?: string;
  total: number;
  name: string;
  phone: string | null;
  byPhone?: boolean;
}

export const orders = {
  nextNo(): number {
    const row = db.prepare('SELECT MAX(no) AS m FROM orders').get() as { m: number | null };
    return Math.max(config.orders.startNo, (row.m ?? 0) + 1);
  },
  create(o: NewOrder): ApiOrder {
    const no = orders.nextNo();
    db.prepare(`INSERT INTO orders (no, user_id, status, created_at, format, table_no, pickup, pickup_label,
                payment, lines, comment, total, name, phone, by_phone)
                VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(no, o.userId, now(), o.format, o.table, o.pickup ?? null, o.pickupLabel ?? null, o.payment,
           JSON.stringify(o.lines), o.comment ?? null, o.total, o.name, o.phone, Number(o.byPhone ?? false));
    if (o.table) tables.occupy(o.table, no);
    return orders.byNo(no, { withPhone: true })!;
  },
  byNo(no: number, opts: { withPhone: boolean; userId?: string | null }): ApiOrder | undefined {
    const r = db.prepare('SELECT * FROM orders WHERE no = ?').get(no) as OrderRow | undefined;
    return r ? rowToOrder(r, opts) : undefined;
  },
  rawByNo(no: number): OrderRow | undefined {
    return db.prepare('SELECT * FROM orders WHERE no = ?').get(no) as OrderRow | undefined;
  },
  /** Заказы одного пользователя, свежие сверху. */
  byUser(userId: string, limit = 50): ApiOrder[] {
    const rows = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit) as OrderRow[];
    return rows.map(r => rowToOrder(r, { withPhone: false, userId }));
  },
  /** Активные заказы по номеру телефона: клиент видит и заказ, принятый по звонку. */
  byPhone(phone: string, limit = 50): ApiOrder[] {
    const rows = db.prepare('SELECT * FROM orders WHERE phone = ? ORDER BY created_at DESC LIMIT ?')
      .all(phone, limit) as OrderRow[];
    return rows.map(r => rowToOrder(r, { withPhone: false }));
  },
  /** Всё, что нужно кухне: незакрытые заказы и недавно выданные. */
  forStaff(limit = 100): ApiOrder[] {
    const rows = db.prepare(`SELECT * FROM orders
                             WHERE status NOT IN ('done', 'cancelled') OR done_at > ?
                             ORDER BY (status IN ('done', 'cancelled')), created_at DESC LIMIT ?`)
      .all(now() - 6 * 3600_000, limit) as OrderRow[];
    return rows.map(r => rowToOrder(r, { withPhone: true }));
  },
  setStatus(no: number, status: OrderStatus, extra?: { eta?: number; table?: number | null }): ApiOrder | undefined {
    const t = now();
    const row = orders.rawByNo(no);
    if (!row) return undefined;
    const patch: Record<string, unknown> = { status };
    if (status === 'accepted') { patch.accepted_at = t; patch.eta = extra?.eta ?? row.eta ?? config.orders.defaultEta; }
    if (status === 'ready') patch.ready_at = t;
    if (status === 'done' || status === 'cancelled') patch.done_at = t;
    if (extra?.table !== undefined) patch.table_no = extra.table;

    const sets = Object.keys(patch).map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE orders SET ${sets} WHERE no = @no`).run({ ...patch, no });

    if (status === 'done' || status === 'cancelled') {
      if (row.table_no) tables.free(row.table_no);
    }
    return orders.byNo(no, { withPhone: true });
  },
  setEta(no: number, eta: number): ApiOrder | undefined {
    db.prepare('UPDATE orders SET eta = ? WHERE no = ?').run(eta, no);
    return orders.byNo(no, { withPhone: true });
  },
  /** Удаляет старые заказы: срок хранения задаётся настройкой ORDER_KEEP_DAYS. */
  cleanup(): number {
    const info = db.prepare('DELETE FROM orders WHERE created_at < ?').run(now() - config.orders.keepDays * 86400_000);
    db.prepare('DELETE FROM code_requests WHERE created_at < ?').run(now() - 7 * 86400_000);
    return info.changes;
  },
};

/* ---------- столики ---------- */

export const tables = {
  state() {
    const rows = db.prepare('SELECT n, zone, occupied FROM tables_state ORDER BY n').all() as
      { n: number; zone: 'terrace' | 'hall'; occupied: number }[];
    const occupied: Record<number, boolean> = {};
    const zones = { terrace: [] as number[], hall: [] as number[] };
    for (const r of rows) {
      occupied[r.n] = !!r.occupied;
      zones[r.zone].push(r.n);
    }
    return { occupied, zones };
  },
  occupy(n: number, orderNo: number | null = null) {
    db.prepare('UPDATE tables_state SET occupied = 1, order_no = ? WHERE n = ?').run(orderNo, n);
  },
  free(n: number) {
    db.prepare('UPDATE tables_state SET occupied = 0, order_no = NULL WHERE n = ?').run(n);
  },
  toggle(n: number): boolean {
    const row = db.prepare('SELECT occupied FROM tables_state WHERE n = ?').get(n) as { occupied: number } | undefined;
    if (!row) return false;
    const next = row.occupied ? 0 : 1;
    db.prepare('UPDATE tables_state SET occupied = ?, order_no = NULL WHERE n = ?').run(next, n);
    return !!next;
  },
  /** Первый свободный столик в зоне — когда клиент выбрал «любой свободный». */
  firstFree(zone: 'terrace' | 'hall'): number | null {
    const row = db.prepare('SELECT n FROM tables_state WHERE zone = ? AND occupied = 0 ORDER BY n LIMIT 1')
      .get(zone) as { n: number } | undefined;
    return row?.n ?? null;
  },
};

/* ---------- сотрудники ---------- */

export const staff = {
  byLogin(login: string): StaffRow | undefined {
    return db.prepare('SELECT * FROM staff WHERE login = ? AND disabled = 0').get(login) as StaffRow | undefined;
  },
  byId(id: string): StaffRow | undefined {
    return db.prepare('SELECT * FROM staff WHERE id = ? AND disabled = 0').get(id) as StaffRow | undefined;
  },
  create(login: string, name: string, pinHash: string, role: 'staff' | 'admin' = 'staff'): StaffRow {
    const id = randomUUID();
    db.prepare('INSERT INTO staff (id, login, name, pin_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, login, name, pinHash, role, now());
    return staff.byId(id)!;
  },
  count(): number {
    return (db.prepare('SELECT COUNT(*) AS c FROM staff').get() as { c: number }).c;
  },
};
