/**
 * Compliance CRUD operations — requirements, licenses, audits
 */

import { getDatabase } from "./database.js";

// ========================
// Types
// ========================

export type Framework = "gdpr" | "soc2" | "hipaa" | "pci" | "tax" | "iso27001" | "custom";
export type RequirementStatus = "compliant" | "non_compliant" | "in_progress" | "not_applicable";
export type LicenseType = "software" | "business" | "professional" | "patent" | "trademark";
export type LicenseStatus = "active" | "expired" | "pending_renewal";
export type AuditStatus = "scheduled" | "in_progress" | "completed" | "failed";

export interface Requirement {
  id: string;
  name: string;
  framework: Framework | null;
  status: RequirementStatus;
  description: string | null;
  evidence: string | null;
  due_date: string | null;
  reviewed_at: string | null;
  reviewer: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface RequirementRow {
  id: string;
  name: string;
  framework: string | null;
  status: string;
  description: string | null;
  evidence: string | null;
  due_date: string | null;
  reviewed_at: string | null;
  reviewer: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface License {
  id: string;
  name: string;
  type: LicenseType | null;
  issuer: string | null;
  license_number: string | null;
  status: LicenseStatus;
  issued_at: string | null;
  expires_at: string | null;
  auto_renew: boolean;
  cost: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface LicenseRow {
  id: string;
  name: string;
  type: string | null;
  issuer: string | null;
  license_number: string | null;
  status: string;
  issued_at: string | null;
  expires_at: string | null;
  auto_renew: number;
  cost: number | null;
  metadata: string;
  created_at: string;
}

export interface Audit {
  id: string;
  name: string;
  framework: string | null;
  status: AuditStatus;
  findings: unknown[];
  auditor: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface AuditRow {
  id: string;
  name: string;
  framework: string | null;
  status: string;
  findings: string;
  auditor: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// ========================
// Row converters
// ========================

function rowToRequirement(row: RequirementRow): Requirement {
  return {
    ...row,
    framework: row.framework as Framework | null,
    status: row.status as RequirementStatus,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

function rowToLicense(row: LicenseRow): License {
  return {
    ...row,
    type: row.type as LicenseType | null,
    status: row.status as LicenseStatus,
    auto_renew: row.auto_renew === 1,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

function rowToAudit(row: AuditRow): Audit {
  return {
    ...row,
    status: row.status as AuditStatus,
    findings: JSON.parse(row.findings || "[]"),
  };
}

// ========================
// Requirements CRUD
// ========================

export interface CreateRequirementInput {
  name: string;
  framework?: Framework;
  status?: RequirementStatus;
  description?: string;
  evidence?: string;
  due_date?: string;
  reviewer?: string;
  metadata?: Record<string, unknown>;
}

export function createRequirement(input: CreateRequirementInput): Requirement {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO requirements (id, name, framework, status, description, evidence, due_date, reviewer, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.framework || null,
    input.status || "in_progress",
    input.description || null,
    input.evidence || null,
    input.due_date || null,
    input.reviewer || null,
    metadata
  );

  return getRequirement(id)!;
}

export function getRequirement(id: string): Requirement | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM requirements WHERE id = ?").get(id) as RequirementRow | null;
  return row ? rowToRequirement(row) : null;
}

export interface ListRequirementsOptions {
  framework?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function listRequirements(options: ListRequirementsOptions = {}): Requirement[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.framework) {
    conditions.push("framework = ?");
    params.push(options.framework);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.search) {
    conditions.push("(name LIKE ? OR description LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q);
  }

  let sql = "SELECT * FROM requirements";
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

  const rows = db.prepare(sql).all(...params) as RequirementRow[];
  return rows.map(rowToRequirement);
}

export interface UpdateRequirementInput {
  name?: string;
  framework?: Framework;
  status?: RequirementStatus;
  description?: string;
  evidence?: string;
  due_date?: string;
  reviewed_at?: string;
  reviewer?: string;
  metadata?: Record<string, unknown>;
}

export function updateRequirement(id: string, input: UpdateRequirementInput): Requirement | null {
  const db = getDatabase();
  const existing = getRequirement(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.framework !== undefined) { sets.push("framework = ?"); params.push(input.framework); }
  if (input.status !== undefined) { sets.push("status = ?"); params.push(input.status); }
  if (input.description !== undefined) { sets.push("description = ?"); params.push(input.description); }
  if (input.evidence !== undefined) { sets.push("evidence = ?"); params.push(input.evidence); }
  if (input.due_date !== undefined) { sets.push("due_date = ?"); params.push(input.due_date); }
  if (input.reviewed_at !== undefined) { sets.push("reviewed_at = ?"); params.push(input.reviewed_at); }
  if (input.reviewer !== undefined) { sets.push("reviewer = ?"); params.push(input.reviewer); }
  if (input.metadata !== undefined) { sets.push("metadata = ?"); params.push(JSON.stringify(input.metadata)); }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE requirements SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getRequirement(id);
}

export function deleteRequirement(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM requirements WHERE id = ?").run(id);
  return result.changes > 0;
}

export function searchRequirements(query: string): Requirement[] {
  return listRequirements({ search: query });
}

// ========================
// Licenses CRUD
// ========================

export interface CreateLicenseInput {
  name: string;
  type?: LicenseType;
  issuer?: string;
  license_number?: string;
  status?: LicenseStatus;
  issued_at?: string;
  expires_at?: string;
  auto_renew?: boolean;
  cost?: number;
  metadata?: Record<string, unknown>;
}

export function createLicense(input: CreateLicenseInput): License {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO licenses (id, name, type, issuer, license_number, status, issued_at, expires_at, auto_renew, cost, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.type || null,
    input.issuer || null,
    input.license_number || null,
    input.status || "active",
    input.issued_at || null,
    input.expires_at || null,
    input.auto_renew ? 1 : 0,
    input.cost ?? null,
    metadata
  );

  return getLicense(id)!;
}

export function getLicense(id: string): License | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM licenses WHERE id = ?").get(id) as LicenseRow | null;
  return row ? rowToLicense(row) : null;
}

export interface ListLicensesOptions {
  type?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function listLicenses(options: ListLicensesOptions = {}): License[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.type) {
    conditions.push("type = ?");
    params.push(options.type);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.search) {
    conditions.push("(name LIKE ? OR issuer LIKE ? OR license_number LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q, q);
  }

  let sql = "SELECT * FROM licenses";
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

  const rows = db.prepare(sql).all(...params) as LicenseRow[];
  return rows.map(rowToLicense);
}

export interface UpdateLicenseInput {
  name?: string;
  type?: LicenseType;
  issuer?: string;
  license_number?: string;
  status?: LicenseStatus;
  issued_at?: string;
  expires_at?: string;
  auto_renew?: boolean;
  cost?: number;
  metadata?: Record<string, unknown>;
}

export function updateLicense(id: string, input: UpdateLicenseInput): License | null {
  const db = getDatabase();
  const existing = getLicense(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.type !== undefined) { sets.push("type = ?"); params.push(input.type); }
  if (input.issuer !== undefined) { sets.push("issuer = ?"); params.push(input.issuer); }
  if (input.license_number !== undefined) { sets.push("license_number = ?"); params.push(input.license_number); }
  if (input.status !== undefined) { sets.push("status = ?"); params.push(input.status); }
  if (input.issued_at !== undefined) { sets.push("issued_at = ?"); params.push(input.issued_at); }
  if (input.expires_at !== undefined) { sets.push("expires_at = ?"); params.push(input.expires_at); }
  if (input.auto_renew !== undefined) { sets.push("auto_renew = ?"); params.push(input.auto_renew ? 1 : 0); }
  if (input.cost !== undefined) { sets.push("cost = ?"); params.push(input.cost); }
  if (input.metadata !== undefined) { sets.push("metadata = ?"); params.push(JSON.stringify(input.metadata)); }

  if (sets.length === 0) return existing;

  params.push(id);

  db.prepare(`UPDATE licenses SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getLicense(id);
}

export function deleteLicense(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM licenses WHERE id = ?").run(id);
  return result.changes > 0;
}

export function renewLicense(id: string, newExpiresAt: string): License | null {
  return updateLicense(id, { status: "active", expires_at: newExpiresAt });
}

export function listExpiringLicenses(days: number): License[] {
  const db = getDatabase();
  const rows = db.prepare(
    `SELECT * FROM licenses
     WHERE status = 'active'
       AND expires_at IS NOT NULL
       AND expires_at <= datetime('now', '+' || ? || ' days')
     ORDER BY expires_at ASC`
  ).all(days) as LicenseRow[];
  return rows.map(rowToLicense);
}

export function getLicenseStats(): {
  total: number;
  active: number;
  expired: number;
  pending_renewal: number;
  total_cost: number;
  by_type: Record<string, number>;
} {
  const db = getDatabase();

  const total = (db.prepare("SELECT COUNT(*) as count FROM licenses").get() as { count: number }).count;
  const active = (db.prepare("SELECT COUNT(*) as count FROM licenses WHERE status = 'active'").get() as { count: number }).count;
  const expired = (db.prepare("SELECT COUNT(*) as count FROM licenses WHERE status = 'expired'").get() as { count: number }).count;
  const pending_renewal = (db.prepare("SELECT COUNT(*) as count FROM licenses WHERE status = 'pending_renewal'").get() as { count: number }).count;
  const costRow = db.prepare("SELECT COALESCE(SUM(cost), 0) as total FROM licenses").get() as { total: number };

  const typeRows = db.prepare(
    "SELECT type, COUNT(*) as count FROM licenses WHERE type IS NOT NULL GROUP BY type"
  ).all() as { type: string; count: number }[];

  const by_type: Record<string, number> = {};
  for (const row of typeRows) {
    by_type[row.type] = row.count;
  }

  return { total, active, expired, pending_renewal, total_cost: costRow.total, by_type };
}

// ========================
// Audits CRUD
// ========================

export interface CreateAuditInput {
  name: string;
  framework?: string;
  auditor?: string;
  scheduled_at?: string;
}

export function scheduleAudit(input: CreateAuditInput): Audit {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO audits (id, name, framework, status, auditor, scheduled_at)
     VALUES (?, ?, ?, 'scheduled', ?, ?)`
  ).run(
    id,
    input.name,
    input.framework || null,
    input.auditor || null,
    input.scheduled_at || null
  );

  return getAudit(id)!;
}

export function getAudit(id: string): Audit | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM audits WHERE id = ?").get(id) as AuditRow | null;
  return row ? rowToAudit(row) : null;
}

export interface ListAuditsOptions {
  framework?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export function listAudits(options: ListAuditsOptions = {}): Audit[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.framework) {
    conditions.push("framework = ?");
    params.push(options.framework);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  let sql = "SELECT * FROM audits";
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

  const rows = db.prepare(sql).all(...params) as AuditRow[];
  return rows.map(rowToAudit);
}

export function completeAudit(id: string, findings: unknown[]): Audit | null {
  const db = getDatabase();
  const existing = getAudit(id);
  if (!existing) return null;

  const hasCritical = findings.some(
    (f: unknown) => typeof f === "object" && f !== null && (f as Record<string, unknown>).severity === "critical"
  );

  db.prepare(
    `UPDATE audits SET status = ?, findings = ?, completed_at = datetime('now') WHERE id = ?`
  ).run(hasCritical ? "failed" : "completed", JSON.stringify(findings), id);

  return getAudit(id);
}

export function getAuditReport(id: string): {
  audit: Audit;
  summary: { total_findings: number; by_severity: Record<string, number> };
} | null {
  const audit = getAudit(id);
  if (!audit) return null;

  const by_severity: Record<string, number> = {};
  for (const finding of audit.findings) {
    if (typeof finding === "object" && finding !== null) {
      const severity = (finding as Record<string, unknown>).severity as string || "unknown";
      by_severity[severity] = (by_severity[severity] || 0) + 1;
    }
  }

  return {
    audit,
    summary: {
      total_findings: audit.findings.length,
      by_severity,
    },
  };
}

export function deleteAudit(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM audits WHERE id = ?").run(id);
  return result.changes > 0;
}

// ========================
// Analytics / Scoring
// ========================

export function getComplianceScore(): {
  total: number;
  compliant: number;
  non_compliant: number;
  in_progress: number;
  not_applicable: number;
  score: number;
} {
  const db = getDatabase();
  const total = (db.prepare("SELECT COUNT(*) as count FROM requirements").get() as { count: number }).count;
  const compliant = (db.prepare("SELECT COUNT(*) as count FROM requirements WHERE status = 'compliant'").get() as { count: number }).count;
  const non_compliant = (db.prepare("SELECT COUNT(*) as count FROM requirements WHERE status = 'non_compliant'").get() as { count: number }).count;
  const in_progress = (db.prepare("SELECT COUNT(*) as count FROM requirements WHERE status = 'in_progress'").get() as { count: number }).count;
  const not_applicable = (db.prepare("SELECT COUNT(*) as count FROM requirements WHERE status = 'not_applicable'").get() as { count: number }).count;

  // Score = % of applicable requirements that are compliant
  const applicable = total - not_applicable;
  const score = applicable > 0 ? Math.round((compliant / applicable) * 100) : 100;

  return { total, compliant, non_compliant, in_progress, not_applicable, score };
}

export function getFrameworkStatus(framework: string): {
  framework: string;
  total: number;
  compliant: number;
  non_compliant: number;
  in_progress: number;
  not_applicable: number;
  score: number;
  requirements: Requirement[];
} {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM requirements WHERE framework = ? ORDER BY name").all(framework) as RequirementRow[];
  const requirements = rows.map(rowToRequirement);

  const total = requirements.length;
  const compliant = requirements.filter((r) => r.status === "compliant").length;
  const non_compliant = requirements.filter((r) => r.status === "non_compliant").length;
  const in_progress = requirements.filter((r) => r.status === "in_progress").length;
  const not_applicable = requirements.filter((r) => r.status === "not_applicable").length;

  const applicable = total - not_applicable;
  const score = applicable > 0 ? Math.round((compliant / applicable) * 100) : 100;

  return { framework, total, compliant, non_compliant, in_progress, not_applicable, score, requirements };
}
