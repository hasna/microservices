/**
 * Contract, Clause, and Reminder CRUD operations
 */

import { getDatabase } from "./database.js";

// --- Contract types ---

export type ContractType = "nda" | "service" | "employment" | "license" | "other";
export type ContractStatus = "draft" | "pending_signature" | "active" | "expired" | "terminated";

export interface Contract {
  id: string;
  title: string;
  type: ContractType;
  status: ContractStatus;
  counterparty: string | null;
  counterparty_email: string | null;
  start_date: string | null;
  end_date: string | null;
  auto_renew: boolean;
  renewal_period: string | null;
  value: number | null;
  currency: string;
  file_path: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface ContractRow {
  id: string;
  title: string;
  type: string;
  status: string;
  counterparty: string | null;
  counterparty_email: string | null;
  start_date: string | null;
  end_date: string | null;
  auto_renew: number;
  renewal_period: string | null;
  value: number | null;
  currency: string;
  file_path: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToContract(row: ContractRow): Contract {
  return {
    ...row,
    type: row.type as ContractType,
    status: row.status as ContractStatus,
    auto_renew: row.auto_renew === 1,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface CreateContractInput {
  title: string;
  type?: ContractType;
  status?: ContractStatus;
  counterparty?: string;
  counterparty_email?: string;
  start_date?: string;
  end_date?: string;
  auto_renew?: boolean;
  renewal_period?: string;
  value?: number;
  currency?: string;
  file_path?: string;
  metadata?: Record<string, unknown>;
}

export function createContract(input: CreateContractInput): Contract {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO contracts (id, title, type, status, counterparty, counterparty_email, start_date, end_date, auto_renew, renewal_period, value, currency, file_path, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.title,
    input.type || "other",
    input.status || "draft",
    input.counterparty || null,
    input.counterparty_email || null,
    input.start_date || null,
    input.end_date || null,
    input.auto_renew ? 1 : 0,
    input.renewal_period || null,
    input.value ?? null,
    input.currency || "USD",
    input.file_path || null,
    metadata
  );

  return getContract(id)!;
}

export function getContract(id: string): Contract | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM contracts WHERE id = ?").get(id) as ContractRow | null;
  return row ? rowToContract(row) : null;
}

export interface ListContractsOptions {
  search?: string;
  type?: ContractType;
  status?: ContractStatus;
  counterparty?: string;
  limit?: number;
  offset?: number;
}

export function listContracts(options: ListContractsOptions = {}): Contract[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    conditions.push(
      "(title LIKE ? OR counterparty LIKE ? OR counterparty_email LIKE ?)"
    );
    const q = `%${options.search}%`;
    params.push(q, q, q);
  }

  if (options.type) {
    conditions.push("type = ?");
    params.push(options.type);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.counterparty) {
    conditions.push("counterparty LIKE ?");
    params.push(`%${options.counterparty}%`);
  }

  let sql = "SELECT * FROM contracts";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as ContractRow[];
  return rows.map(rowToContract);
}

export interface UpdateContractInput {
  title?: string;
  type?: ContractType;
  status?: ContractStatus;
  counterparty?: string;
  counterparty_email?: string;
  start_date?: string;
  end_date?: string;
  auto_renew?: boolean;
  renewal_period?: string;
  value?: number;
  currency?: string;
  file_path?: string;
  metadata?: Record<string, unknown>;
}

export function updateContract(
  id: string,
  input: UpdateContractInput
): Contract | null {
  const db = getDatabase();
  const existing = getContract(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.title !== undefined) {
    sets.push("title = ?");
    params.push(input.title);
  }
  if (input.type !== undefined) {
    sets.push("type = ?");
    params.push(input.type);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.counterparty !== undefined) {
    sets.push("counterparty = ?");
    params.push(input.counterparty);
  }
  if (input.counterparty_email !== undefined) {
    sets.push("counterparty_email = ?");
    params.push(input.counterparty_email);
  }
  if (input.start_date !== undefined) {
    sets.push("start_date = ?");
    params.push(input.start_date);
  }
  if (input.end_date !== undefined) {
    sets.push("end_date = ?");
    params.push(input.end_date);
  }
  if (input.auto_renew !== undefined) {
    sets.push("auto_renew = ?");
    params.push(input.auto_renew ? 1 : 0);
  }
  if (input.renewal_period !== undefined) {
    sets.push("renewal_period = ?");
    params.push(input.renewal_period);
  }
  if (input.value !== undefined) {
    sets.push("value = ?");
    params.push(input.value);
  }
  if (input.currency !== undefined) {
    sets.push("currency = ?");
    params.push(input.currency);
  }
  if (input.file_path !== undefined) {
    sets.push("file_path = ?");
    params.push(input.file_path);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE contracts SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getContract(id);
}

export function deleteContract(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM contracts WHERE id = ?").run(id);
  return result.changes > 0;
}

export function searchContracts(query: string): Contract[] {
  return listContracts({ search: query });
}

/**
 * List contracts expiring within the given number of days
 */
export function listExpiring(days: number): Contract[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM contracts
       WHERE end_date IS NOT NULL
         AND status IN ('active', 'pending_signature')
         AND date(end_date) <= date('now', '+' || ? || ' days')
         AND date(end_date) >= date('now')
       ORDER BY end_date ASC`
    )
    .all(days) as ContractRow[];
  return rows.map(rowToContract);
}

/**
 * Renew a contract by extending its end_date based on renewal_period.
 * If renewal_period is not set, extends by 1 year.
 */
export function renewContract(id: string): Contract | null {
  const contract = getContract(id);
  if (!contract) return null;

  const period = contract.renewal_period || "1 year";
  const baseDate = contract.end_date || new Date().toISOString().split("T")[0];

  const db = getDatabase();
  db.prepare(
    `UPDATE contracts
     SET end_date = date(?, '+' || ?),
         status = 'active',
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(baseDate, period, id);

  return getContract(id);
}

/**
 * Get aggregate stats about contracts
 */
export function getContractStats(): {
  total: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  total_value: number;
  expiring_30_days: number;
} {
  const db = getDatabase();

  const total = (
    db.prepare("SELECT COUNT(*) as count FROM contracts").get() as { count: number }
  ).count;

  const statusRows = db
    .prepare("SELECT status, COUNT(*) as count FROM contracts GROUP BY status")
    .all() as { status: string; count: number }[];
  const by_status: Record<string, number> = {};
  for (const row of statusRows) {
    by_status[row.status] = row.count;
  }

  const typeRows = db
    .prepare("SELECT type, COUNT(*) as count FROM contracts GROUP BY type")
    .all() as { type: string; count: number }[];
  const by_type: Record<string, number> = {};
  for (const row of typeRows) {
    by_type[row.type] = row.count;
  }

  const valueRow = db
    .prepare("SELECT COALESCE(SUM(value), 0) as total FROM contracts WHERE status = 'active'")
    .get() as { total: number };

  const expiringRow = db
    .prepare(
      `SELECT COUNT(*) as count FROM contracts
       WHERE end_date IS NOT NULL
         AND status IN ('active', 'pending_signature')
         AND date(end_date) <= date('now', '+30 days')
         AND date(end_date) >= date('now')`
    )
    .get() as { count: number };

  return {
    total,
    by_status,
    by_type,
    total_value: valueRow.total,
    expiring_30_days: expiringRow.count,
  };
}

// --- Clause operations ---

export interface Clause {
  id: string;
  contract_id: string;
  name: string;
  text: string;
  type: "standard" | "custom" | "negotiated";
  created_at: string;
}

export interface CreateClauseInput {
  contract_id: string;
  name: string;
  text: string;
  type?: "standard" | "custom" | "negotiated";
}

export function createClause(input: CreateClauseInput): Clause {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO clauses (id, contract_id, name, text, type)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, input.contract_id, input.name, input.text, input.type || "standard");

  return getClause(id)!;
}

export function getClause(id: string): Clause | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM clauses WHERE id = ?").get(id) as Clause | null;
  return row || null;
}

export function listClauses(contractId: string): Clause[] {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM clauses WHERE contract_id = ? ORDER BY created_at ASC")
    .all(contractId) as Clause[];
}

export function deleteClause(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM clauses WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Reminder operations ---

export interface Reminder {
  id: string;
  contract_id: string;
  remind_at: string;
  message: string;
  sent: boolean;
  created_at: string;
}

interface ReminderRow {
  id: string;
  contract_id: string;
  remind_at: string;
  message: string;
  sent: number;
  created_at: string;
}

function rowToReminder(row: ReminderRow): Reminder {
  return {
    ...row,
    sent: row.sent === 1,
  };
}

export interface CreateReminderInput {
  contract_id: string;
  remind_at: string;
  message: string;
}

export function createReminder(input: CreateReminderInput): Reminder {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO reminders (id, contract_id, remind_at, message)
     VALUES (?, ?, ?, ?)`
  ).run(id, input.contract_id, input.remind_at, input.message);

  return getReminder(id)!;
}

export function getReminder(id: string): Reminder | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM reminders WHERE id = ?").get(id) as ReminderRow | null;
  return row ? rowToReminder(row) : null;
}

export function listReminders(contractId: string): Reminder[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM reminders WHERE contract_id = ? ORDER BY remind_at ASC")
    .all(contractId) as ReminderRow[];
  return rows.map(rowToReminder);
}

export function deleteReminder(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM reminders WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listPendingReminders(): Reminder[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM reminders
       WHERE sent = 0 AND datetime(remind_at) <= datetime('now')
       ORDER BY remind_at ASC`
    )
    .all() as ReminderRow[];
  return rows.map(rowToReminder);
}

export function markReminderSent(id: string): boolean {
  const db = getDatabase();
  const result = db
    .prepare("UPDATE reminders SET sent = 1 WHERE id = ?")
    .run(id);
  return result.changes > 0;
}
