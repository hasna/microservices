/**
 * Fresh token reuse detection — microservice-auth.
 *
 * Detects when a token is reused immediately after being issued.
 * This can indicate token stealing (attacker steals a token and reuses it
 * within seconds of the legitimate user getting it).
 *
 * The detection works by tracking token issuance and usage timestamps,
 * then flagging cases where the same token is seen again within a
 * "freshness window" (default: 5 seconds) of being issued.
 */

import type { Sql } from "postgres";

export interface FreshTokenEvent {
  id: string;
  token_hash: string;
  user_id: string;
  workspace_id: string | null;
  event_type: "issued" | "used";
  ip_address: string | null;
  user_agent: string | null;
  detected_reuse: boolean;
  reuse_window_ms: number | null;
  created_at: string;
}

export interface FreshTokenAlert {
  id: string;
  user_id: string;
  workspace_id: string | null;
  token_hash: string;
  issued_at: string;
  reused_at: string;
  issued_ip: string | null;
  reused_ip: string | null;
  issued_user_agent: string | null;
  reused_user_agent: string | null;
  reuse_window_ms: number;
  severity: "low" | "medium" | "high" | "critical";
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
}

/**
 * Record a token issuance event.
 */
export async function recordTokenIssuance(
  sql: Sql,
  tokenHash: string,
  userId: string,
  opts?: {
    workspaceId?: string;
    ipAddress?: string;
    userAgent?: string;
  },
): Promise<FreshTokenEvent> {
  const [event] = await sql<FreshTokenEvent[]>`
    INSERT INTO auth.fresh_token_events (token_hash, user_id, workspace_id, event_type, ip_address, user_agent, detected_reuse)
    VALUES (${tokenHash}, ${userId}, ${opts?.workspaceId ?? null}, 'issued', ${opts?.ipAddress ?? null}, ${opts?.userAgent ?? null}, false)
    RETURNING *
  `;
  return event;
}

/**
 * Record a token usage event and check for fresh reuse.
 *
 * Returns the event and, if reuse was detected, an alert.
 */
export async function recordTokenUsage(
  sql: Sql,
  tokenHash: string,
  userId: string,
  opts?: {
    workspaceId?: string;
    ipAddress?: string;
    userAgent?: string;
    freshnessWindowMs?: number;
  },
): Promise<{ event: FreshTokenEvent; alert: FreshTokenAlert | null }> {
  const windowMs = opts?.freshnessWindowMs ?? 5000; // default 5 seconds

  // Check for recent issuance
  const [priorIssuance] = await sql<{ id: string; created_at: string; ip_address: string | null; user_agent: string | null }[]>`
    SELECT id, created_at, ip_address, user_agent
    FROM auth.fresh_token_events
    WHERE token_hash = ${tokenHash}
      AND user_id = ${userId}
      AND event_type = 'issued'
      AND created_at > NOW() - ${windowMs} * INTERVAL '1 millisecond'
    ORDER BY created_at DESC
    LIMIT 1
  `;

  let detectedReuse = false;
  let reuseWindowMs: number | null = null;

  if (priorIssuance) {
    const issuedAt = new Date(priorIssuance.created_at).getTime();
    const now = Date.now();
    reuseWindowMs = now - issuedAt;
    detectedReuse = reuseWindowMs <= windowMs;
  }

  // Record usage event
  const [event] = await sql<FreshTokenEvent[]>`
    INSERT INTO auth.fresh_token_events (token_hash, user_id, workspace_id, event_type, ip_address, user_agent, detected_reuse, reuse_window_ms)
    VALUES (${tokenHash}, ${userId}, ${opts?.workspaceId ?? null}, 'used', ${opts?.ipAddress ?? null}, ${opts?.userAgent ?? null}, ${detectedReuse}, ${reuseWindowMs})
    RETURNING *
  `;

  // If reuse detected, create alert
  let alert: FreshTokenAlert | null = null;
  if (detectedReuse && priorIssuance) {
    // Determine severity based on reuse window
    let severity: "low" | "medium" | "high" | "critical" = "medium";
    if (reuseWindowMs! < 1000) severity = "critical"; // under 1 second = critical
    else if (reuseWindowMs! < 2000) severity = "high"; // under 2 seconds = high
    else if (reuseWindowMs! < 3000) severity = "medium"; // under 3 seconds = medium
    else severity = "low"; // 3-5 seconds = low

    // Check if IPs differ (different location = more suspicious)
    if (priorIssuance.ip_address && opts?.ipAddress &&
        priorIssuance.ip_address !== opts.ipAddress) {
      // Escalate severity by one level if IP changed
      severity = severity === "critical" ? "critical"
        : severity === "high" ? "critical"
        : severity === "medium" ? "high"
        : "medium";
    }

    [alert] = await sql<FreshTokenAlert[]>`
      INSERT INTO auth.fresh_token_alerts
        (user_id, workspace_id, token_hash, issued_at, reused_at,
         issued_ip, reused_ip, issued_user_agent, reused_user_agent,
         reuse_window_ms, severity)
      VALUES (
        ${userId}, ${opts?.workspaceId ?? null}, ${tokenHash},
        ${priorIssuance.created_at}, ${event.created_at},
        ${priorIssuance.ip_address}, ${opts?.ipAddress ?? null},
        ${priorIssuance.user_agent}, ${opts?.userAgent ?? null},
        ${reuseWindowMs}, ${severity}
      )
      RETURNING *
    `;
  }

  return { event, alert };
}

/**
 * Get fresh token alerts for a workspace or user.
 */
export async function getFreshTokenAlerts(
  sql: Sql,
  opts?: {
    workspaceId?: string;
    userId?: string;
    unresolvedOnly?: boolean;
    severity?: "low" | "medium" | "high" | "critical";
    limit?: number;
  },
): Promise<FreshTokenAlert[]> {
  const limit = opts?.limit ?? 50;

  let query = sql<FreshTokenAlert[]>`
    SELECT * FROM auth.fresh_token_alerts
    WHERE 1=1
  `;

  if (opts?.workspaceId) {
    query = sql<FreshTokenAlert[]>`
      SELECT * FROM auth.fresh_token_alerts
      WHERE workspace_id = ${opts.workspaceId}
    `;
  }

  if (opts?.userId) {
    query = sql<FreshTokenAlert[]>`
      SELECT * FROM auth.fresh_token_alerts
      WHERE user_id = ${opts.userId}
    `;
  }

  if (opts?.unresolvedOnly) {
    query = sql<FreshTokenAlert[]>`
      SELECT * FROM auth.fresh_token_alerts
      WHERE resolved = false
    `;
  }

  if (opts?.severity) {
    query = sql<FreshTokenAlert[]>`
      SELECT * FROM auth.fresh_token_alerts
      WHERE severity = ${opts.severity}
    `;
  }

  const rows = await sql<FreshTokenAlert[]>`
    SELECT * FROM auth.fresh_token_alerts
    WHERE 1=1
    ${opts?.workspaceId ? sql`AND workspace_id = ${opts.workspaceId}` : sql``}
    ${opts?.userId ? sql`AND user_id = ${opts.userId}` : sql``}
    ${opts?.unresolvedOnly ? sql`AND resolved = false` : sql``}
    ${opts?.severity ? sql`AND severity = ${opts.severity}` : sql``}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return rows;
}

/**
 * Resolve a fresh token alert.
 */
export async function resolveFreshTokenAlert(
  sql: Sql,
  alertId: string,
  resolvedBy?: string,
): Promise<FreshTokenAlert | null> {
  const [alert] = await sql<FreshTokenAlert[]>`
    UPDATE auth.fresh_token_alerts
    SET resolved = true, resolved_at = NOW(), resolved_by = ${resolvedBy ?? null}
    WHERE id = ${alertId}
    RETURNING *
  `;
  return alert ?? null;
}

/**
 * Get fresh token reuse statistics for a workspace.
 */
export async function getFreshTokenStats(
  sql: Sql,
  workspaceId: string,
  since?: string,
): Promise<{
  total_alerts: number;
  by_severity: { severity: string; count: number }[];
  avg_reuse_window_ms: number;
  critical_count: number;
  resolved_count: number;
}> {
  const sinceDate = since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [stats] = await sql<{ total: number; avg_ms: number | null; critical: number; resolved: number }[]>`
    SELECT
      COUNT(*)::int as total,
      AVG(reuse_window_ms)::float as avg_ms,
      COUNT(*) FILTER (WHERE severity = 'critical')::int as critical,
      COUNT(*) FILTER (WHERE resolved = true)::int as resolved
    FROM auth.fresh_token_alerts
    WHERE workspace_id = ${workspaceId} AND created_at >= ${sinceDate}
  `;

  const bySeverity = await sql<{ severity: string; count: number }[]>`
    SELECT severity, COUNT(*)::int as count
    FROM auth.fresh_token_alerts
    WHERE workspace_id = ${workspaceId} AND created_at >= ${sinceDate}
    GROUP BY severity
    ORDER BY count DESC
  `;

  return {
    total_alerts: stats?.total ?? 0,
    by_severity: bySeverity,
    avg_reuse_window_ms: stats?.avg_ms ?? 0,
    critical_count: stats?.critical ?? 0,
    resolved_count: stats?.resolved ?? 0,
  };
}
