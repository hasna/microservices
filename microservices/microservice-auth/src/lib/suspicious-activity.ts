/**
 * Suspicious auth activity detection — flags anomalous auth patterns
 * that may indicate compromised accounts or automated attacks.
 */

import type { Sql } from "postgres";

export type SuspiciousActivityType =
  | "burst_logins"
  | "geo_impossible"
  | "many_failed_attempts"
  | "unusual_hour"
  | "password_spray"
  | "credential_stuffing"
  | "token_cloning"
  | "permission_escalation";

export interface SuspiciousActivity {
  id: string;
  user_id: string | null;
  workspace_id: string | null;
  activity_type: SuspiciousActivityType;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  ip_addresses: string[];
  metadata: Record<string, unknown>;
  detected_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  false_positive: boolean;
}

/**
 * Record a suspicious activity detection event.
 */
export async function recordSuspiciousActivity(
  sql: Sql,
  data: {
    userId?: string;
    workspaceId?: string;
    activityType: SuspiciousActivityType;
    severity: "low" | "medium" | "high" | "critical";
    description: string;
    ipAddresses?: string[];
    metadata?: Record<string, unknown>;
  },
): Promise<SuspiciousActivity> {
  const [row] = await sql<SuspiciousActivity[]>`
    INSERT INTO auth.suspicious_activities
      (user_id, workspace_id, activity_type, severity, description,
       ip_addresses, metadata, detected_at)
    VALUES (
      ${data.userId ?? null},
      ${data.workspaceId ?? null},
      ${data.activityType},
      ${data.severity},
      ${data.description},
      ${data.ipAddresses ?? []},
      ${data.metadata ?? {}}
    )
    RETURNING *
  `;
  return row;
}

/**
 * Detect burst logins — many successful logins in a short time window (bot or token cloning).
 */
export async function detectBurstLogins(
  sql: Sql,
  userId: string,
  opts: { windowSeconds?: number; threshold?: number } = {},
): Promise<{ burst: boolean; count: number; window_seconds: number }> {
  const windowSeconds = opts.windowSeconds ?? 60;
  const threshold = opts.threshold ?? 5;
  const cutoff = new Date(Date.now() - windowSeconds * 1000).toISOString();

  const [row] = await sql<[{ count: number }]>`
    SELECT COUNT(*) as count FROM auth.login_events
    WHERE user_id = ${userId}
      AND event_type = 'login_success'
      AND created_at > ${cutoff}
  `;

  const count = Number(row?.count ?? 0);
  return { burst: count > threshold, count, window_seconds: windowSeconds };
}

/**
 * Detect many failed attempts from the same IP targeting different accounts (password spray).
 */
export async function detectPasswordSpray(
  sql: Sql,
  ipAddress: string,
  opts: { windowMinutes?: number; accountThreshold?: number } = {},
): Promise<{ spray: boolean; unique_accounts: number; attempts: number }> {
  const windowMinutes = opts.windowMinutes ?? 15;
  const accountThreshold = opts.accountThreshold ?? 3;
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  const [stats] = await sql<[{ attempts: number; unique_accounts: number }]>`
    SELECT
      COUNT(*) as attempts,
      COUNT(DISTINCT user_id) as unique_accounts
    FROM auth.login_events
    WHERE ip_address = ${ipAddress}
      AND event_type = 'login_failed'
      AND created_at > ${cutoff}
  `;

  const uniqueAccounts = Number(stats?.unique_accounts ?? 0);
  return {
    spray: uniqueAccounts > accountThreshold,
    unique_accounts: uniqueAccounts,
    attempts: Number(stats?.attempts ?? 0),
  };
}

/**
 * Get all unresolved suspicious activities for a workspace, sorted by severity.
 */
export async function getUnresolvedActivities(
  sql: Sql,
  workspaceId?: string,
  opts: { limit?: number; minSeverity?: "low" | "medium" | "high" | "critical" } = {},
): Promise<SuspiciousActivity[]> {
  const limit = opts.limit ?? 50;
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const minSev = severityOrder[opts.minSeverity ?? "low"];

  const [rows] = await sql<SuspiciousActivity[]>`
    SELECT * FROM auth.suspicious_activities
    WHERE resolved_at IS NULL
      AND false_positive = FALSE
      AND (${workspaceId ? sql`workspace_id = ${workspaceId}` : sql`true`})
    ORDER BY
      CASE severity
        WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3
      END,
      detected_at DESC
    LIMIT ${limit}
  `;

  return rows.filter((r) => severityOrder[r.severity] <= minSev);
}

/**
 * Mark a suspicious activity as resolved or false positive.
 */
export async function resolveSuspiciousActivity(
  sql: Sql,
  activityId: string,
  resolvedBy: string,
  opts: { falsePositive?: boolean } = {},
): Promise<boolean> {
  const [row] = await sql<[{ id: string }][]>`
    UPDATE auth.suspicious_activities
    SET resolved_at = NOW(),
        resolved_by = ${resolvedBy},
        false_positive = ${opts.falsePositive ?? false}
    WHERE id = ${activityId} AND resolved_at IS NULL
    RETURNING id
  `;
  return !!row;
}

/**
 * Get suspicious activity summary for a user (for auth security dashboards).
 */
export async function getUserActivitySummary(
  sql: Sql,
  userId: string,
  days = 30,
): Promise<{
  total_activities: number;
  unresolved: number;
  by_type: Record<string, number>;
  by_severity: Record<string, number>;
  recent: SuspiciousActivity[];
}> {
  const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();

  const [rows] = await sql<SuspiciousActivity[]>`
    SELECT * FROM auth.suspicious_activities
    WHERE user_id = ${userId} AND detected_at > ${cutoff}
    ORDER BY detected_at DESC
  `;

  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  let unresolved = 0;

  for (const r of rows) {
    byType[r.activity_type] = (byType[r.activity_type] ?? 0) + 1;
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    if (!r.resolved_at) unresolved++;
  }

  return {
    total_activities: rows.length,
    unresolved,
    by_type: byType,
    by_severity: bySeverity,
    recent: rows.slice(0, 10),
  };
}
