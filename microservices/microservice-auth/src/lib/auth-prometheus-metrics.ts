/**
 * Auth Prometheus metrics export.
 *
 * Exposes auth operational metrics in Prometheus text format
 * for scraping and dashboarding.
 */

import type { Sql } from "postgres";

export interface AuthMetrics {
  loginAttempts: MetricFamily;
  loginFailures: MetricFamily;
  activeSessions: MetricFamily;
  riskEvents: MetricFamily;
  lockouts: MetricFamily;
  deviceRegistrations: MetricFamily;
  passkeyRegistrations: MetricFamily;
  apiKeyUsage: MetricFamily;
}

export interface MetricFamily {
  name: string;
  help: string;
  type: "counter" | "gauge" | "histogram";
  metrics: Metric[];
}

export interface Metric {
  labels: Record<string, string>;
  value: number;
}

export interface PrometheusTextOutput {
  text: string;
  metricCount: number;
}

/**
 * Convert metrics to Prometheus text format.
 */
export function toPrometheusTextFormat(metrics: AuthMetrics): PrometheusTextOutput {
  const lines: string[] = [];
  let metricCount = 0;

  for (const family of Object.values(metrics)) {
    lines.push(`# HELP ${family.name} ${family.help}`);
    lines.push(`# TYPE ${family.name} ${family.type}`);

    for (const metric of family.metrics) {
      const labelStr = Object.entries(metric.labels).length > 0
        ? `{${Object.entries(metric.labels).map(([k, v]) => `${k}="${v}"`).join(",")}}`
        : "";
      lines.push(`${family.name}${labelStr} ${metric.value}`);
      metricCount++;
    }
  }

  return {
    text: lines.join("\n") + "\n",
    metricCount,
  };
}

/**
 * Get all auth metrics from the database.
 */
export async function getAuthMetrics(
  sql: Sql,
  workspaceId?: string,
  since?: Date,
): Promise<AuthMetrics> {
  const sinceDate = since ?? new Date(Date.now() - 3600_000); // Default: last hour

  return {
    loginAttempts: await getLoginAttempts(sql, workspaceId, sinceDate),
    loginFailures: await getLoginFailures(sql, workspaceId, sinceDate),
    activeSessions: await getActiveSessions(sql, workspaceId),
    riskEvents: await getRiskEvents(sql, workspaceId, sinceDate),
    lockouts: await getLockouts(sql, workspaceId, sinceDate),
    deviceRegistrations: await getDeviceRegistrations(sql, workspaceId, sinceDate),
    passkeyRegistrations: await getPasskeyRegistrations(sql, workspaceId, sinceDate),
    apiKeyUsage: await getApiKeyUsage(sql, workspaceId, sinceDate),
  };
}

async function getLoginAttempts(sql: Sql, workspaceId: string | undefined, since: Date): Promise<MetricFamily> {
  const query = workspaceId
    ? `
      SELECT wm.workspace_id, le.success, COUNT(*) as count
      FROM auth.login_events le
      JOIN auth.workspace_members wm ON le.user_id = wm.user_id
      WHERE le.created_at >= $1 AND wm.workspace_id = $2
      GROUP BY wm.workspace_id, le.success
    `
    : `
      SELECT success, COUNT(*) as count
      FROM auth.login_events
      WHERE created_at >= $1
      GROUP BY success
    `;

  const params = workspaceId ? [since, workspaceId] : [since];
  const rows = await sql.unsafe(query, params) as [{ success: boolean; count: string } | { workspace_id: string; success: boolean; count: string }];

  return {
    name: "auth_login_attempts_total",
    help: "Total login attempts",
    type: "counter",
    metrics: rows.map(r => ({
      labels: workspaceId
        ? { workspace_id: (r as { workspace_id: string }).workspace_id, success: String((r as { success: boolean }).success) }
        : { success: String((r as { success: boolean }).success) },
      value: parseInt((r as { count: string }).count, 10),
    })),
  };
}

async function getLoginFailures(sql: Sql, workspaceId: string | undefined, since: Date): Promise<MetricFamily> {
  const query = workspaceId
    ? `
      SELECT le.failure_reason, COUNT(*) as count
      FROM auth.login_events le
      JOIN auth.workspace_members wm ON le.user_id = wm.user_id
      WHERE le.created_at >= $1 AND le.success = false AND wm.workspace_id = $2
      GROUP BY le.failure_reason
    `
    : `
      SELECT failure_reason, COUNT(*) as count
      FROM auth.login_events
      WHERE created_at >= $1 AND success = false
      GROUP BY failure_reason
    `;

  const params = workspaceId ? [since, workspaceId] : [since];
  const rows = await sql.unsafe(query, params) as [{ failure_reason: string | null; count: string }];

  return {
    name: "auth_login_failures_total",
    help: "Total login failures by reason",
    type: "counter",
    metrics: rows.map(r => ({
      labels: { reason: r.failure_reason ?? "unknown" },
      value: parseInt(r.count, 10),
    })),
  };
}

async function getActiveSessions(sql: Sql, workspaceId: string | undefined): Promise<MetricFamily> {
  const query = workspaceId
    ? `
      SELECT wm.workspace_id, COUNT(*) as count
      FROM auth.sessions s
      JOIN auth.users u ON s.user_id = u.id
      JOIN auth.workspace_members wm ON u.id = wm.user_id
      WHERE s.expires_at > NOW() AND wm.workspace_id = $2
      GROUP BY wm.workspace_id
    `
    : `
      SELECT COUNT(*) as count
      FROM auth.sessions
      WHERE expires_at > NOW()
    `;

  const params = workspaceId ? [new Date(), workspaceId] : [new Date()];
  const rows = await sql.unsafe(query, params) as [{ count: string } | { workspace_id: string; count: string }];

  return {
    name: "auth_active_sessions",
    help: "Number of active sessions",
    type: "gauge",
    metrics: rows.map(r => ({
      labels: workspaceId
        ? { workspace_id: (r as { workspace_id: string }).workspace_id }
        : {},
      value: parseInt((r as { count: string }).count, 10),
    })),
  };
}

async function getRiskEvents(sql: Sql, workspaceId: string | undefined, since: Date): Promise<MetricFamily> {
  const query = workspaceId
    ? `
      SELECT are.risk_level, COUNT(*) as count
      FROM auth.auth_risk_events are
      JOIN auth.workspace_members wm ON are.user_id = wm.user_id
      WHERE are.created_at >= $1 AND wm.workspace_id = $2
      GROUP BY are.risk_level
    `
    : `
      SELECT risk_level, COUNT(*) as count
      FROM auth.auth_risk_events
      WHERE created_at >= $1
      GROUP BY risk_level
    `;

  const params = workspaceId ? [since, workspaceId] : [since];
  const rows = await sql.unsafe(query, params) as [{ risk_level: string; count: string }];

  return {
    name: "auth_risk_events_total",
    help: "Auth risk events by level",
    type: "counter",
    metrics: rows.map(r => ({
      labels: { risk_level: r.risk_level },
      value: parseInt(r.count, 10),
    })),
  };
}

async function getLockouts(sql: Sql, workspaceId: string | undefined, since: Date): Promise<MetricFamily> {
  const query = workspaceId
    ? `
      SELECT l.lockout_type, COUNT(*) as count
      FROM auth.lockouts l
      WHERE l.created_at >= $1 AND l.workspace_id = $2
      GROUP BY l.lockout_type
    `
    : `
      SELECT lockout_type, COUNT(*) as count
      FROM auth.lockouts
      WHERE created_at >= $1
      GROUP BY lockout_type
    `;

  const params = workspaceId ? [since, workspaceId] : [since];
  const rows = await sql.unsafe(query, params) as [{ lockout_type: string; count: string }];

  return {
    name: "auth_lockouts_total",
    help: "Account lockouts by type",
    type: "counter",
    metrics: rows.map(r => ({
      labels: { type: r.lockout_type },
      value: parseInt(r.count, 10),
    })),
  };
}

async function getDeviceRegistrations(sql: Sql, workspaceId: string | undefined, since: Date): Promise<MetricFamily> {
  const query = workspaceId
    ? `
      SELECT COUNT(*) as count
      FROM auth.devices d
      JOIN auth.workspace_members wm ON d.user_id = wm.user_id
      WHERE d.created_at >= $1 AND wm.workspace_id = $2
    `
    : `
      SELECT COUNT(*) as count
      FROM auth.devices
      WHERE created_at >= $1
    `;

  const params = workspaceId ? [since, workspaceId] : [since];
  const rows = await sql.unsafe(query, params) as [{ count: string }];

  return {
    name: "auth_device_registrations_total",
    help: "New device registrations",
    type: "counter",
    metrics: rows.map(r => ({
      labels: {},
      value: parseInt(r.count, 10),
    })),
  };
}

async function getPasskeyRegistrations(sql: Sql, workspaceId: string | undefined, since: Date): Promise<MetricFamily> {
  const query = workspaceId
    ? `
      SELECT COUNT(*) as count
      FROM auth.passkeys p
      JOIN auth.workspace_members wm ON p.user_id = wm.user_id
      WHERE p.created_at >= $1 AND wm.workspace_id = $2
    `
    : `
      SELECT COUNT(*) as count
      FROM auth.passkeys
      WHERE created_at >= $1
    `;

  const params = workspaceId ? [since, workspaceId] : [since];
  const rows = await sql.unsafe(query, params) as [{ count: string }];

  return {
    name: "auth_passkey_registrations_total",
    help: "New passkey registrations",
    type: "counter",
    metrics: rows.map(r => ({
      labels: {},
      value: parseInt(r.count, 10),
    })),
  };
}

async function getApiKeyUsage(sql: Sql, workspaceId: string | undefined, since: Date): Promise<MetricFamily> {
  const query = workspaceId
    ? `
      SELECT akus.endpoint, COUNT(*) as count
      FROM auth.api_key_usage_logs akus
      JOIN auth.api_keys ak ON akus.api_key_id = ak.id
      JOIN auth.workspace_members wm ON ak.user_id = wm.user_id
      WHERE akus.used_at >= $1 AND wm.workspace_id = $2
      GROUP BY akus.endpoint
    `
    : `
      SELECT endpoint, COUNT(*) as count
      FROM auth.api_key_usage_logs
      WHERE used_at >= $1
      GROUP BY endpoint
    `;

  const params = workspaceId ? [since, workspaceId] : [since];
  const rows = await sql.unsafe(query, params) as [{ endpoint: string | null; count: string }];

  return {
    name: "auth_api_key_usage_total",
    help: "API key usage by endpoint",
    type: "counter",
    metrics: rows.map(r => ({
      labels: { endpoint: r.endpoint ?? "unknown" },
      value: parseInt(r.count, 10),
    })),
  };
}

/**
 * Export auth metrics as Prometheus text format.
 */
export async function exportAuthMetrics(
  sql: Sql,
  workspaceId?: string,
  since?: Date,
): Promise<PrometheusTextOutput> {
  const metrics = await getAuthMetrics(sql, workspaceId, since);
  return toPrometheusTextFormat(metrics);
}

/**
 * Export auth metrics as structured JSON.
 */
export async function exportAuthMetricsJSON(
  sql: Sql,
  workspaceId?: string,
  since?: Date,
): Promise<AuthMetrics> {
  return getAuthMetrics(sql, workspaceId, since);
}
