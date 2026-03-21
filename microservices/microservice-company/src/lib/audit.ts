/**
 * Audit log operations — track actions across the company microservice
 */

import { getDatabase } from "../db/database.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuditAction = "create" | "update" | "delete" | "execute" | "login" | "approve";

export interface AuditEntry {
  id: string;
  org_id: string | null;
  actor: string;
  action: AuditAction;
  service: string | null;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
  timestamp: string;
}

interface AuditRow {
  id: string;
  org_id: string | null;
  actor: string;
  action: string;
  service: string | null;
  entity_type: string | null;
  entity_id: string | null;
  details: string;
  timestamp: string;
}

function rowToAudit(row: AuditRow): AuditEntry {
  return {
    ...row,
    action: row.action as AuditAction,
    details: JSON.parse(row.details || "{}"),
  };
}

// ─── Operations ──────────────────────────────────────────────────────────────

export interface LogActionInput {
  org_id?: string;
  actor: string;
  action: AuditAction;
  service?: string;
  entity_type?: string;
  entity_id?: string;
  details?: Record<string, unknown>;
}

export function logAction(input: LogActionInput): AuditEntry {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO audit_log (id, org_id, actor, action, service, entity_type, entity_id, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.org_id || null,
    input.actor,
    input.action,
    input.service || null,
    input.entity_type || null,
    input.entity_id || null,
    JSON.stringify(input.details || {})
  );

  const row = db.prepare("SELECT * FROM audit_log WHERE id = ?").get(id) as AuditRow;
  return rowToAudit(row);
}

export interface SearchAuditFilters {
  org_id?: string;
  actor?: string;
  service?: string;
  action?: AuditAction;
  entity_type?: string;
  entity_id?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export function searchAudit(filters: SearchAuditFilters = {}): AuditEntry[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.org_id) { conditions.push("org_id = ?"); params.push(filters.org_id); }
  if (filters.actor) { conditions.push("actor = ?"); params.push(filters.actor); }
  if (filters.service) { conditions.push("service = ?"); params.push(filters.service); }
  if (filters.action) { conditions.push("action = ?"); params.push(filters.action); }
  if (filters.entity_type) { conditions.push("entity_type = ?"); params.push(filters.entity_type); }
  if (filters.entity_id) { conditions.push("entity_id = ?"); params.push(filters.entity_id); }
  if (filters.from) { conditions.push("timestamp >= ?"); params.push(filters.from); }
  if (filters.to) { conditions.push("timestamp <= ?"); params.push(filters.to); }

  let sql = "SELECT * FROM audit_log";
  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY timestamp DESC";

  if (filters.limit) { sql += " LIMIT ?"; params.push(filters.limit); }

  const rows = db.prepare(sql).all(...params) as AuditRow[];
  return rows.map(rowToAudit);
}

export function getAuditTimeline(entityType: string, entityId: string): AuditEntry[] {
  const db = getDatabase();
  const rows = db.prepare(
    "SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY timestamp ASC"
  ).all(entityType, entityId) as AuditRow[];
  return rows.map(rowToAudit);
}

export interface AuditStats {
  total: number;
  by_actor: Record<string, number>;
  by_service: Record<string, number>;
  by_action: Record<string, number>;
}

export function getAuditStats(orgId?: string, from?: string, to?: string): AuditStats {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (orgId) { conditions.push("org_id = ?"); params.push(orgId); }
  if (from) { conditions.push("timestamp >= ?"); params.push(from); }
  if (to) { conditions.push("timestamp <= ?"); params.push(to); }

  const where = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";

  const totalRow = db.prepare(`SELECT COUNT(*) as count FROM audit_log${where}`).get(...params) as { count: number };

  const actorRows = db.prepare(
    `SELECT actor, COUNT(*) as count FROM audit_log${where} GROUP BY actor`
  ).all(...params) as { actor: string; count: number }[];

  const serviceRows = db.prepare(
    `SELECT service, COUNT(*) as count FROM audit_log${where} GROUP BY service`
  ).all(...params) as { service: string; count: number }[];

  const actionRows = db.prepare(
    `SELECT action, COUNT(*) as count FROM audit_log${where} GROUP BY action`
  ).all(...params) as { action: string; count: number }[];

  const by_actor: Record<string, number> = {};
  for (const r of actorRows) by_actor[r.actor] = r.count;

  const by_service: Record<string, number> = {};
  for (const r of serviceRows) by_service[r.service || "unknown"] = r.count;

  const by_action: Record<string, number> = {};
  for (const r of actionRows) by_action[r.action] = r.count;

  return {
    total: totalRow.count,
    by_actor,
    by_service,
    by_action,
  };
}
