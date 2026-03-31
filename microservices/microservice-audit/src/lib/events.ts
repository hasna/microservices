/**
 * Core audit event operations.
 * The events table is append-only — logEvent is the only write operation.
 */

import type { Sql } from "postgres";
import { createHash } from "crypto";

export interface AuditEvent {
  id: string;
  actor_id: string | null;
  actor_type: "user" | "system" | "api_key";
  action: string;
  resource_type: string;
  resource_id: string | null;
  workspace_id: string | null;
  ip: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  severity: "debug" | "info" | "warning" | "error" | "critical";
  checksum: string | null;
  created_at: Date;
}

export interface LogEventInput {
  actorId?: string;
  actorType?: "user" | "system" | "api_key";
  action: string;
  resourceType: string;
  resourceId?: string;
  workspaceId?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  severity?: "debug" | "info" | "warning" | "error" | "critical";
}

export interface QueryFilters {
  workspaceId?: string;
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  severity?: "debug" | "info" | "warning" | "error" | "critical";
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export const VALID_SEVERITY_LEVELS = ["debug", "info", "warning", "error", "critical"] as const;
export type SeverityLevel = typeof VALID_SEVERITY_LEVELS[number];

/**
 * Compute a SHA-256 checksum over the canonical event fields.
 * Deterministic: same input always produces same checksum.
 */
export function computeChecksum(fields: {
  actor_id: string | null | undefined;
  action: string;
  resource_type: string;
  resource_id: string | null | undefined;
  workspace_id: string | null | undefined;
  created_at: string;
}): string {
  const payload = JSON.stringify({
    actor_id: fields.actor_id ?? null,
    action: fields.action,
    resource_type: fields.resource_type,
    resource_id: fields.resource_id ?? null,
    workspace_id: fields.workspace_id ?? null,
    created_at: fields.created_at,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export async function logEvent(sql: Sql, data: LogEventInput): Promise<AuditEvent> {
  const createdAt = new Date().toISOString();
  const checksum = computeChecksum({
    actor_id: data.actorId ?? null,
    action: data.action,
    resource_type: data.resourceType,
    resource_id: data.resourceId ?? null,
    workspace_id: data.workspaceId ?? null,
    created_at: createdAt,
  });

  const [event] = await sql<AuditEvent[]>`
    INSERT INTO audit.events (
      actor_id, actor_type, action, resource_type, resource_id,
      workspace_id, ip, user_agent, metadata, severity, checksum, created_at
    ) VALUES (
      ${data.actorId ?? null},
      ${data.actorType ?? "user"},
      ${data.action},
      ${data.resourceType},
      ${data.resourceId ?? null},
      ${data.workspaceId ?? null},
      ${data.ip ?? null},
      ${data.userAgent ?? null},
      ${sql.json(data.metadata ?? {})},
      ${data.severity ?? "info"},
      ${checksum},
      ${createdAt}
    )
    RETURNING *
  `;
  return event;
}

export async function queryEvents(sql: Sql, filters: QueryFilters): Promise<AuditEvent[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (filters.workspaceId) { conditions.push(`workspace_id = $${i++}`); values.push(filters.workspaceId); }
  if (filters.actorId) { conditions.push(`actor_id = $${i++}`); values.push(filters.actorId); }
  if (filters.action) { conditions.push(`action = $${i++}`); values.push(filters.action); }
  if (filters.resourceType) { conditions.push(`resource_type = $${i++}`); values.push(filters.resourceType); }
  if (filters.resourceId) { conditions.push(`resource_id = $${i++}`); values.push(filters.resourceId); }
  if (filters.severity) { conditions.push(`severity = $${i++}`); values.push(filters.severity); }
  if (filters.from) { conditions.push(`created_at >= $${i++}`); values.push(filters.from.toISOString()); }
  if (filters.to) { conditions.push(`created_at <= $${i++}`); values.push(filters.to.toISOString()); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const query = `SELECT * FROM audit.events ${whereClause} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  return sql.unsafe(query, values) as Promise<AuditEvent[]>;
}

export async function countEvents(sql: Sql, filters: Omit<QueryFilters, "limit" | "offset">): Promise<number> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (filters.workspaceId) { conditions.push(`workspace_id = $${i++}`); values.push(filters.workspaceId); }
  if (filters.actorId) { conditions.push(`actor_id = $${i++}`); values.push(filters.actorId); }
  if (filters.action) { conditions.push(`action = $${i++}`); values.push(filters.action); }
  if (filters.resourceType) { conditions.push(`resource_type = $${i++}`); values.push(filters.resourceType); }
  if (filters.resourceId) { conditions.push(`resource_id = $${i++}`); values.push(filters.resourceId); }
  if (filters.severity) { conditions.push(`severity = $${i++}`); values.push(filters.severity); }
  if (filters.from) { conditions.push(`created_at >= $${i++}`); values.push(filters.from.toISOString()); }
  if (filters.to) { conditions.push(`created_at <= $${i++}`); values.push(filters.to.toISOString()); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const query = `SELECT COUNT(*)::int as count FROM audit.events ${whereClause}`;
  const [{ count }] = await sql.unsafe(query, values) as [{ count: number }];
  return count;
}

export async function getEvent(sql: Sql, id: string): Promise<AuditEvent | null> {
  const [event] = await sql<AuditEvent[]>`SELECT * FROM audit.events WHERE id = ${id}`;
  return event ?? null;
}

export async function exportEvents(
  sql: Sql,
  filters: Omit<QueryFilters, "limit" | "offset">,
  format: "json" | "csv"
): Promise<string> {
  const events = await queryEvents(sql, { ...filters, limit: 100000, offset: 0 });

  if (format === "json") {
    return JSON.stringify(events, null, 2);
  }

  // CSV format
  const header = "id,actor_id,action,resource_type,resource_id,workspace_id,severity,created_at";
  const rows = events.map((e) => [
    e.id,
    e.actor_id ?? "",
    e.action,
    e.resource_type,
    e.resource_id ?? "",
    e.workspace_id ?? "",
    e.severity,
    e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at),
  ].map(csvEscape).join(","));

  return [header, ...rows].join("\n");
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
