/**
 * Provider health tracking — aggregate latency, error rates, and uptime
 * from the requests table.
 */

import type { Sql } from "postgres";

export interface ProviderHealthMetrics {
  provider: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  avgCostUsd: number;
  uptimePct: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface ProviderCircuitStatus {
  provider: string;
  state: "closed" | "open" | "half_open";
  failureCount: number;
  successCount: number;
  lastFailureAt: Date | null;
  lastSuccessAt: Date | null;
  openedAt: Date | null;
}

export async function getProviderHealth(
  sql: Sql,
  opts: {
    provider: string;
    periodHours?: number;
  },
): Promise<ProviderHealthMetrics | null> {
  const hours = opts.periodHours ?? 24;
  const since = new Date(Date.now() - hours * 3_600_000);

  const [stats] = await sql`
    SELECT
      provider,
      COUNT(*)::int AS total_requests,
      COUNT(*) FILTER (WHERE error IS NULL)::int AS successful_requests,
      COUNT(*) FILTER (WHERE error IS NOT NULL)::int AS failed_requests,
      ROUND(
        COUNT(*) FILTER (WHERE error IS NOT NULL)::numeric / NULLIF(COUNT(*), 0) * 100,
        2
      )::numeric AS error_rate,
      ROUND(AVG(latency_ms)::numeric, 2)::numeric AS avg_latency_ms,
      ROUND(
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms)
      )::int AS p50_latency_ms,
      ROUND(
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)
      )::int AS p95_latency_ms,
      ROUND(
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)
      )::int AS p99_latency_ms,
      ROUND(SUM(cost_usd)::numeric, 6)::numeric AS avg_cost_usd,
      MIN(created_at) AS period_start,
      MAX(created_at) AS period_end
    FROM llm.requests
    WHERE provider = ${opts.provider}
      AND created_at >= ${since}
    GROUP BY provider
  `;

  if (!stats) return null;

  // Compute uptime: requests with latency > 0 and no error / total requests
  const [uptimeRow] = await sql`
    SELECT
      ROUND(
        COUNT(*) FILTER (WHERE latency_ms > 0 AND error IS NULL)::numeric /
        NULLIF(COUNT(*), 0) * 100,
        2
      )::numeric AS uptime_pct
    FROM llm.requests
    WHERE provider = ${opts.provider}
      AND created_at >= ${since}
  `;

  return {
    provider: stats.provider,
    totalRequests: stats.total_requests,
    successfulRequests: stats.successful_requests,
    failedRequests: stats.failed_requests,
    errorRate: Number(stats.error_rate ?? 0),
    avgLatencyMs: Number(stats.avg_latency_ms ?? 0),
    p50LatencyMs: Number(stats.p50_latency_ms ?? 0),
    p95LatencyMs: Number(stats.p95_latency_ms ?? 0),
    p99LatencyMs: Number(stats.p99_latency_ms ?? 0),
    avgCostUsd: Number(stats.avg_cost_usd ?? 0),
    uptimePct: Number(uptimeRow?.uptime_pct ?? 100),
    periodStart: stats.period_start,
    periodEnd: stats.period_end,
  };
}

export async function listProviderHealth(
  sql: Sql,
  opts?: { periodHours?: number },
): Promise<ProviderHealthMetrics[]> {
  const hours = opts?.periodHours ?? 24;
  const since = new Date(Date.now() - hours * 3_600_000);

  const rows = await sql`
    SELECT
      provider,
      COUNT(*)::int AS total_requests,
      COUNT(*) FILTER (WHERE error IS NULL)::int AS successful_requests,
      COUNT(*) FILTER (WHERE error IS NOT NULL)::int AS failed_requests,
      ROUND(
        COUNT(*) FILTER (WHERE error IS NOT NULL)::numeric / NULLIF(COUNT(*), 0) * 100,
        2
      )::numeric AS error_rate,
      ROUND(AVG(latency_ms)::numeric, 2)::numeric AS avg_latency_ms,
      ROUND(
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms)
      )::int AS p50_latency_ms,
      ROUND(
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)
      )::int AS p95_latency_ms,
      ROUND(
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)
      )::int AS p99_latency_ms,
      ROUND(SUM(cost_usd)::numeric, 6)::numeric AS total_cost,
      MIN(created_at) AS period_start,
      MAX(created_at) AS period_end
    FROM llm.requests
    WHERE created_at >= ${since}
    GROUP BY provider
    ORDER BY provider
  `;

  return rows.map((stats) => ({
    provider: stats.provider,
    totalRequests: stats.total_requests,
    successfulRequests: stats.successful_requests,
    failedRequests: stats.failed_requests,
    errorRate: Number(stats.error_rate ?? 0),
    avgLatencyMs: Number(stats.avg_latency_ms ?? 0),
    p50LatencyMs: Number(stats.p50_latency_ms ?? 0),
    p95LatencyMs: Number(stats.p95_latency_ms ?? 0),
    p99LatencyMs: Number(stats.p99_latency_ms ?? 0),
    avgCostUsd: Number(stats.total_cost ?? 0),
    uptimePct: 100, // per-provider uptime computed in getProviderHealth
    periodStart: stats.period_start,
    periodEnd: stats.period_end,
  }));
}

export async function getProviderCircuitStatus(
  sql: Sql,
  provider: string,
): Promise<ProviderCircuitStatus | null> {
  const [row] = await sql`
    SELECT provider, state, failure_count, success_count,
           last_failure_at, last_success_at, opened_at
    FROM llm.provider_circuits
    WHERE provider = ${provider}
  `;

  if (!row) return null;

  return {
    provider: row.provider,
    state: row.state as "closed" | "open" | "half_open",
    failureCount: row.failure_count,
    successCount: row.success_count,
    lastFailureAt: row.last_failure_at,
    lastSuccessAt: row.last_success_at,
    openedAt: row.opened_at,
  };
}

export async function getAllCircuitStates(
  sql: Sql,
): Promise<ProviderCircuitStatus[]> {
  const rows = await sql`
    SELECT provider, state, failure_count, success_count,
           last_failure_at, last_success_at, opened_at
    FROM llm.provider_circuits
    ORDER BY provider
  `;

  return rows.map((r) => ({
    provider: r.provider,
    state: r.state as "closed" | "open" | "half_open",
    failureCount: r.failure_count,
    successCount: r.success_count,
    lastFailureAt: r.last_failure_at,
    lastSuccessAt: r.last_success_at,
    openedAt: r.opened_at,
  }));
}

export async function resetProviderCircuit(
  sql: Sql,
  provider: string,
): Promise<void> {
  await sql`
    UPDATE llm.provider_circuits
    SET state = 'closed',
        failure_count = 0,
        success_count = 0,
        opened_at = NULL,
        updated_at = NOW()
    WHERE provider = ${provider}
  `;
}
