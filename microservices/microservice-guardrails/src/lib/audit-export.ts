/**
 * Audit log export — export audit entries as JSON or CSV for compliance/reporting.
 */

import type { Sql } from "postgres";
import { type AuditLogEntry, queryAuditLog } from "./audit.js";

export interface AuditExportOptions {
  workspaceId?: string;
  since?: Date;
  until?: Date;
  guardResult?: "pass" | "warn" | "block";
  limit?: number;
  format?: "json" | "csv";
}

/**
 * Export audit log entries as JSON.
 */
export async function exportAuditLogJSON(
  sql: Sql,
  opts: AuditExportOptions = {},
): Promise<string> {
  const entries = await queryAuditLog(sql, { ...opts, limit: opts.limit ?? 10000 });
  return JSON.stringify(entries, null, 2);
}

/**
 * Export audit log entries as CSV (RFC 4180).
 */
export async function exportAuditLogCSV(
  sql: Sql,
  opts: AuditExportOptions = {},
): Promise<string> {
  const entries = await queryAuditLog(sql, { ...opts, limit: opts.limit ?? 10000 });

  if (entries.length === 0) {
    return "id,workspace_id,user_id,request_id,direction,ip_address,user_agent,content_hash,fingerprint,content_length,guard_result,latency_ms,rules_triggered,pii_types,injection_detected,toxicity_detected,policy_violated,blocked_content,metadata,created_at\n";
  }

  const headers = [
    "id", "workspace_id", "user_id", "request_id", "direction",
    "ip_address", "user_agent", "content_hash", "fingerprint",
    "content_length", "guard_result", "latency_ms", "rules_triggered",
    "pii_types", "injection_detected", "toxicity_detected",
    "policy_violated", "blocked_content", "metadata", "created_at",
  ];

  const rows = entries.map((e) => [
    e.id,
    e.workspace_id ?? "",
    e.user_id ?? "",
    e.request_id ?? "",
    e.direction,
    e.ip_address ?? "",
    e.user_agent ?? "",
    e.content_hash ?? "",
    e.fingerprint ?? "",
    String(e.content_length),
    e.guard_result,
    e.latency_ms != null ? String(e.latency_ms) : "",
    JSON.stringify(e.rules_triggered),
    JSON.stringify(e.pii_types),
    String(e.injection_detected),
    String(e.toxicity_detected),
    String(e.policy_violated),
    e.blocked_content ? `"${e.blocked_content.replace(/"/g, '""')}"` : "",
    JSON.stringify(e.metadata),
    e.created_at,
  ].map((v) => v.includes(",") ? `"${v.replace(/"/g, '""')}"` : v));

  return [headers.join(","), ...rows].join("\n");
}
