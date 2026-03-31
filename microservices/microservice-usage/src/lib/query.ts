/**
 * Query operations: usage summaries, quota checks, quota management.
 */

import type { Sql } from "postgres";
import { getPeriodStart } from "./track.js";

export interface UsageSummary {
  metric: string;
  total: number;
  unit: string;
  period_start: string;
}

export interface Quota {
  workspace_id: string;
  metric: string;
  limit_value: number;
  period: string;
  hard_limit: boolean;
}

export interface QuotaCheck {
  allowed: boolean;
  current: number;
  limit: number | null;
  remaining: number | null;
}

export const VALID_PERIODS = ["hour", "day", "month", "total"] as const;
export type Period = typeof VALID_PERIODS[number];

export function isValidPeriod(period: string): period is Period {
  return (VALID_PERIODS as readonly string[]).includes(period);
}

/**
 * Get usage summary for a workspace, optionally filtered by metric and since date.
 * Returns aggregates from the aggregates table (day-level granularity).
 */
export async function getUsageSummary(
  sql: Sql,
  workspaceId: string,
  metric?: string,
  since?: Date
): Promise<UsageSummary[]> {
  const conditions: string[] = [`workspace_id = $1`];
  const values: unknown[] = [workspaceId];
  let i = 2;

  if (metric) {
    conditions.push(`metric = $${i++}`);
    values.push(metric);
  }

  if (since) {
    conditions.push(`period_start >= $${i++}`);
    values.push(getPeriodStart(since, "day"));
  }

  const whereClause = `WHERE ${conditions.join(" AND ")} AND period = 'day'`;

  const query = `
    SELECT
      a.metric,
      SUM(a.total)::float AS total,
      COALESCE(MAX(e.unit), 'count') AS unit,
      MIN(a.period_start::text) AS period_start
    FROM usage.aggregates a
    LEFT JOIN usage.events e ON e.workspace_id = a.workspace_id AND e.metric = a.metric
    ${whereClause}
    GROUP BY a.metric
    ORDER BY a.metric
  `;

  return sql.unsafe(query, values) as Promise<UsageSummary[]>;
}

/**
 * Check whether current usage is within the quota for a metric.
 * If no quota is configured, returns { allowed: true, limit: null, remaining: null }.
 */
export async function checkQuota(
  sql: Sql,
  workspaceId: string,
  metric: string,
  period: string = "month"
): Promise<QuotaCheck> {
  // Get quota config
  const quota = await getQuota(sql, workspaceId, metric);

  // Get current usage for this period
  const now = new Date();
  let periodStart: string;

  if (period === "month") {
    periodStart = getPeriodStart(now, "month");
  } else if (period === "day") {
    periodStart = getPeriodStart(now, "day");
  } else if (period === "hour") {
    // For hour period, query raw events from last hour
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const [row] = await sql<[{ total: string }]>`
      SELECT COALESCE(SUM(quantity), 0)::text AS total
      FROM usage.events
      WHERE workspace_id = ${workspaceId}
        AND metric = ${metric}
        AND recorded_at >= ${hourAgo.toISOString()}
    `;
    const current = parseFloat(row?.total ?? "0");
    if (!quota) {
      return { allowed: true, current, limit: null, remaining: null };
    }
    const limit = Number(quota.limit_value);
    const remaining = Math.max(0, limit - current);
    return { allowed: current <= limit, current, limit, remaining };
  } else {
    // total — sum all time
    const [row] = await sql<[{ total: string }]>`
      SELECT COALESCE(SUM(quantity), 0)::text AS total
      FROM usage.events
      WHERE workspace_id = ${workspaceId}
        AND metric = ${metric}
    `;
    const current = parseFloat(row?.total ?? "0");
    if (!quota) {
      return { allowed: true, current, limit: null, remaining: null };
    }
    const limit = Number(quota.limit_value);
    const remaining = Math.max(0, limit - current);
    return { allowed: current <= limit, current, limit, remaining };
  }

  // day / month — query aggregates
  const [row] = await sql<[{ total: string }]>`
    SELECT COALESCE(SUM(total), 0)::text AS total
    FROM usage.aggregates
    WHERE workspace_id = ${workspaceId}
      AND metric = ${metric}
      AND period = ${period}
      AND period_start = ${periodStart}
  `;
  const current = parseFloat(row?.total ?? "0");

  if (!quota) {
    return { allowed: true, current, limit: null, remaining: null };
  }

  const limit = Number(quota.limit_value);
  const remaining = Math.max(0, limit - current);
  return { allowed: current <= limit, current, limit, remaining };
}

/**
 * Get quota configuration for a workspace + metric (returns first matching period, or null).
 */
export async function getQuota(
  sql: Sql,
  workspaceId: string,
  metric: string
): Promise<Quota | null> {
  const [quota] = await sql<Quota[]>`
    SELECT workspace_id, metric, limit_value::float AS limit_value, period, hard_limit
    FROM usage.quotas
    WHERE workspace_id = ${workspaceId}
      AND metric = ${metric}
    LIMIT 1
  `;
  return quota ?? null;
}

/**
 * Upsert a quota for a workspace + metric + period.
 */
export async function setQuota(
  sql: Sql,
  workspaceId: string,
  metric: string,
  limitValue: number,
  period: string = "month",
  hardLimit: boolean = false
): Promise<void> {
  await sql`
    INSERT INTO usage.quotas (workspace_id, metric, limit_value, period, hard_limit)
    VALUES (${workspaceId}, ${metric}, ${limitValue}, ${period}, ${hardLimit})
    ON CONFLICT (workspace_id, metric, period)
    DO UPDATE SET
      limit_value = EXCLUDED.limit_value,
      hard_limit = EXCLUDED.hard_limit
  `;
}

/**
 * List all distinct metrics tracked for a workspace.
 */
export async function listMetrics(
  sql: Sql,
  workspaceId: string
): Promise<string[]> {
  const rows = await sql<{ metric: string }[]>`
    SELECT DISTINCT metric FROM usage.events
    WHERE workspace_id = ${workspaceId}
    ORDER BY metric
  `;
  return rows.map((r) => r.metric);
}
