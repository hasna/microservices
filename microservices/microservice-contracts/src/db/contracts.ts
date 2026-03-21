/**
 * Contract, Clause, and Reminder CRUD operations
 */

import { getDatabase } from "./database.js";

// --- Contract types ---

export type ContractType = "nda" | "service" | "employment" | "license" | "other";
export type ContractStatus = "draft" | "pending_review" | "pending_signature" | "active" | "expired" | "terminated";

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

  // Save version history before updating
  saveContractVersion(existing);

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

// --- Obligation operations ---

export type ObligationStatus = "pending" | "completed" | "overdue";

export interface Obligation {
  id: string;
  clause_id: string;
  description: string;
  due_date: string | null;
  status: ObligationStatus;
  assigned_to: string | null;
  created_at: string;
}

export interface CreateObligationInput {
  clause_id: string;
  description: string;
  due_date?: string;
  assigned_to?: string;
}

export function createObligation(input: CreateObligationInput): Obligation {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO obligations (id, clause_id, description, due_date, assigned_to)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, input.clause_id, input.description, input.due_date || null, input.assigned_to || null);

  return getObligation(id)!;
}

export function getObligation(id: string): Obligation | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM obligations WHERE id = ?").get(id) as Obligation | null;
  return row || null;
}

export function listObligations(clauseId: string): Obligation[] {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM obligations WHERE clause_id = ? ORDER BY created_at ASC")
    .all(clauseId) as Obligation[];
}

export function completeObligation(id: string): Obligation | null {
  const db = getDatabase();
  const result = db
    .prepare("UPDATE obligations SET status = 'completed' WHERE id = ?")
    .run(id);
  if (result.changes === 0) return null;
  return getObligation(id);
}

export function listOverdueObligations(): Obligation[] {
  const db = getDatabase();
  // Mark obligations past due_date as overdue, then return them
  db.prepare(
    `UPDATE obligations SET status = 'overdue'
     WHERE status = 'pending' AND due_date IS NOT NULL AND date(due_date) < date('now')`
  ).run();

  return db
    .prepare(
      `SELECT * FROM obligations
       WHERE status = 'overdue'
       ORDER BY due_date ASC`
    )
    .all() as Obligation[];
}

// --- Approval workflow ---

const APPROVAL_FLOW: Record<string, string> = {
  draft: "pending_review",
  pending_review: "pending_signature",
  pending_signature: "active",
};

/**
 * Submit a draft contract for review: draft -> pending_review
 */
export function submitForReview(id: string): Contract | null {
  const contract = getContract(id);
  if (!contract) return null;
  if (contract.status !== "draft") {
    throw new Error(`Cannot submit for review: contract status is '${contract.status}', expected 'draft'`);
  }
  return updateContract(id, { status: "pending_review" });
}

/**
 * Approve a contract: pending_review -> pending_signature -> active
 * Advances the contract one step in the approval flow.
 */
export function approveContract(id: string): Contract | null {
  const contract = getContract(id);
  if (!contract) return null;
  const nextStatus = APPROVAL_FLOW[contract.status];
  if (!nextStatus) {
    throw new Error(
      `Cannot approve: contract status is '${contract.status}'. Approval flow: draft -> pending_review -> pending_signature -> active`
    );
  }
  return updateContract(id, { status: nextStatus as ContractStatus });
}

// --- Version history ---

export interface ContractVersion {
  id: string;
  contract_id: string;
  title: string;
  status: string;
  value: number | null;
  metadata_snapshot: Record<string, unknown>;
  changed_at: string;
}

interface ContractVersionRow {
  id: string;
  contract_id: string;
  title: string;
  status: string;
  value: number | null;
  metadata_snapshot: string;
  changed_at: string;
}

function rowToVersion(row: ContractVersionRow): ContractVersion {
  return {
    ...row,
    metadata_snapshot: JSON.parse(row.metadata_snapshot || "{}"),
  };
}

function saveContractVersion(contract: Contract): void {
  const db = getDatabase();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO contract_versions (id, contract_id, title, status, value, metadata_snapshot)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    contract.id,
    contract.title,
    contract.status,
    contract.value,
    JSON.stringify(contract.metadata)
  );
}

export function getContractHistory(contractId: string): ContractVersion[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM contract_versions WHERE contract_id = ? ORDER BY changed_at ASC")
    .all(contractId) as ContractVersionRow[];
  return rows.map(rowToVersion);
}

// --- Signature logging ---

export type SignatureMethod = "digital" | "wet" | "docusign";

export interface Signature {
  id: string;
  contract_id: string;
  signer_name: string;
  signer_email: string | null;
  signed_at: string;
  method: SignatureMethod;
}

export interface RecordSignatureInput {
  contract_id: string;
  signer_name: string;
  signer_email?: string;
  method?: SignatureMethod;
}

export function recordSignature(input: RecordSignatureInput): Signature {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO signatures (id, contract_id, signer_name, signer_email, method)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, input.contract_id, input.signer_name, input.signer_email || null, input.method || "digital");

  return getSignature(id)!;
}

export function getSignature(id: string): Signature | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM signatures WHERE id = ?").get(id) as Signature | null;
  return row || null;
}

export function listSignatures(contractId: string): Signature[] {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM signatures WHERE contract_id = ? ORDER BY signed_at ASC")
    .all(contractId) as Signature[];
}

// --- Clause templates (library) ---

export interface ClauseTemplate {
  id: string;
  name: string;
  text: string;
  type: "standard" | "custom" | "negotiated";
  created_at: string;
}

export interface SaveClauseTemplateInput {
  name: string;
  text: string;
  type?: "standard" | "custom" | "negotiated";
}

export function saveClauseTemplate(input: SaveClauseTemplateInput): ClauseTemplate {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO clause_templates (id, name, text, type)
     VALUES (?, ?, ?, ?)`
  ).run(id, input.name, input.text, input.type || "standard");

  return getClauseTemplate(id)!;
}

export function getClauseTemplate(id: string): ClauseTemplate | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM clause_templates WHERE id = ?").get(id) as ClauseTemplate | null;
  return row || null;
}

export function getClauseTemplateByName(name: string): ClauseTemplate | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM clause_templates WHERE name = ?").get(name) as ClauseTemplate | null;
  return row || null;
}

export function listClauseTemplates(): ClauseTemplate[] {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM clause_templates ORDER BY name ASC")
    .all() as ClauseTemplate[];
}

export function addClauseFromTemplate(contractId: string, templateName: string): Clause {
  const template = getClauseTemplateByName(templateName);
  if (!template) {
    throw new Error(`Clause template '${templateName}' not found`);
  }
  return createClause({
    contract_id: contractId,
    name: template.name,
    text: template.text,
    type: template.type,
  });
}

// --- Multi-stage reminders ---

export function setMultiReminders(
  contractId: string,
  daysBefore: number[]
): Reminder[] {
  const contract = getContract(contractId);
  if (!contract) {
    throw new Error(`Contract '${contractId}' not found`);
  }
  if (!contract.end_date) {
    throw new Error(`Contract '${contractId}' has no end_date set`);
  }

  const endDate = new Date(contract.end_date);
  const reminders: Reminder[] = [];

  for (const days of daysBefore) {
    const remindDate = new Date(endDate);
    remindDate.setDate(remindDate.getDate() - days);
    const remindAt = remindDate.toISOString().split("T")[0] + "T09:00:00";

    const reminder = createReminder({
      contract_id: contractId,
      remind_at: remindAt,
      message: `Contract "${contract.title}" expires in ${days} day(s)`,
    });
    reminders.push(reminder);
  }

  return reminders;
}

// --- Contract comparison ---

export interface ContractComparison {
  contract1: { id: string; title: string };
  contract2: { id: string; title: string };
  field_differences: { field: string; contract1_value: unknown; contract2_value: unknown }[];
  clause_only_in_1: Clause[];
  clause_only_in_2: Clause[];
  clause_differences: { name: string; contract1_text: string; contract2_text: string }[];
}

export function compareContracts(id1: string, id2: string): ContractComparison {
  const c1 = getContract(id1);
  const c2 = getContract(id2);
  if (!c1) throw new Error(`Contract '${id1}' not found`);
  if (!c2) throw new Error(`Contract '${id2}' not found`);

  // Compare fields
  const fieldsToCompare: (keyof Contract)[] = [
    "title", "type", "status", "counterparty", "counterparty_email",
    "start_date", "end_date", "auto_renew", "renewal_period",
    "value", "currency",
  ];
  const field_differences: { field: string; contract1_value: unknown; contract2_value: unknown }[] = [];
  for (const field of fieldsToCompare) {
    const v1 = c1[field];
    const v2 = c2[field];
    if (JSON.stringify(v1) !== JSON.stringify(v2)) {
      field_differences.push({ field, contract1_value: v1, contract2_value: v2 });
    }
  }

  // Compare clauses by name
  const clauses1 = listClauses(id1);
  const clauses2 = listClauses(id2);
  const names1 = new Set(clauses1.map((c) => c.name));
  const names2 = new Set(clauses2.map((c) => c.name));

  const clause_only_in_1 = clauses1.filter((c) => !names2.has(c.name));
  const clause_only_in_2 = clauses2.filter((c) => !names1.has(c.name));

  const clause_differences: { name: string; contract1_text: string; contract2_text: string }[] = [];
  for (const cl1 of clauses1) {
    const cl2 = clauses2.find((c) => c.name === cl1.name);
    if (cl2 && cl1.text !== cl2.text) {
      clause_differences.push({ name: cl1.name, contract1_text: cl1.text, contract2_text: cl2.text });
    }
  }

  return {
    contract1: { id: c1.id, title: c1.title },
    contract2: { id: c2.id, title: c2.title },
    field_differences,
    clause_only_in_1,
    clause_only_in_2,
    clause_differences,
  };
}

// --- Markdown export ---

export function exportContract(id: string, format: "md" | "json" = "md"): string {
  const contract = getContract(id);
  if (!contract) throw new Error(`Contract '${id}' not found`);

  if (format === "json") {
    const clauses = listClauses(id);
    const sigs = listSignatures(id);
    const reminders = listReminders(id);
    return JSON.stringify({ contract, clauses, signatures: sigs, reminders }, null, 2);
  }

  // Markdown export
  const lines: string[] = [];
  lines.push(`# ${contract.title}`);
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Type | ${contract.type} |`);
  lines.push(`| Status | ${contract.status} |`);
  if (contract.counterparty) lines.push(`| Counterparty | ${contract.counterparty} |`);
  if (contract.counterparty_email) lines.push(`| Email | ${contract.counterparty_email} |`);
  if (contract.start_date) lines.push(`| Start Date | ${contract.start_date} |`);
  if (contract.end_date) lines.push(`| End Date | ${contract.end_date} |`);
  if (contract.value !== null) lines.push(`| Value | ${contract.value} ${contract.currency} |`);
  if (contract.auto_renew) lines.push(`| Auto-Renew | ${contract.renewal_period || "1 year"} |`);
  lines.push(`| Created | ${contract.created_at} |`);
  lines.push(`| Updated | ${contract.updated_at} |`);

  const clauses = listClauses(id);
  if (clauses.length > 0) {
    lines.push("");
    lines.push("## Clauses");
    lines.push("");
    for (const clause of clauses) {
      lines.push(`### ${clause.name} (${clause.type})`);
      lines.push("");
      lines.push(clause.text);
      lines.push("");
    }
  }

  const sigs = listSignatures(id);
  if (sigs.length > 0) {
    lines.push("## Signatures");
    lines.push("");
    for (const sig of sigs) {
      const email = sig.signer_email ? ` (${sig.signer_email})` : "";
      lines.push(`- **${sig.signer_name}**${email} — ${sig.method} — ${sig.signed_at}`);
    }
    lines.push("");
  }

  const reminders = listReminders(id);
  if (reminders.length > 0) {
    lines.push("## Reminders");
    lines.push("");
    for (const r of reminders) {
      const sent = r.sent ? " (sent)" : "";
      lines.push(`- ${r.remind_at} — ${r.message}${sent}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
