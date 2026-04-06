/**
 * Span analytics — per-type cost/latency breakdowns, percentiles, error rates.
 */

import type { Sql } from "postgres";

export interface SpanTypeBreakdown {
  span_type: string;
  count: number;
  error_count: number;
  error_rate: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_cost_usd: number;
  total_duration_ms: number;
  avg_duration_ms: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  p99_duration_ms: number;
}

export interface WorkspaceAnalytics {
  workspace_id: string;
  period_start: Date;
  period_end: Date;
  total_traces: number;
  error_traces: number;
  error_rate: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_cost_usd: number;
  total_duration_ms: number;
  by_span_type: SpanTypeBreakdown[];
}

export interface CostBreakdown {
  span_type: string;
  total_cost_usd: number;
  total_calls: number;
  avg_cost_per_call: number;
}

/**
 * Get per-span-type analytics for a workspace over a time period.
 */
export async function getSpanAnalytics(
  sql: Sql,
  workspaceId: string,
  opts: { periodStart?: Date; periodEnd?: Date; limit?: number } = {},
): Promise<SpanTypeBreakdown[]> {
  const { periodStart, periodEnd, limit = 50 } = opts;
  const start = periodStart ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const end = periodEnd ?? new Date();

  return sql<SpanTypeBreakdown[]>`
    SELECT
      s.type                                                AS span_type,
      COUNT(*)                                               AS count,
      COUNT(*) FILTER (WHERE s.status = 'error')            AS error_count,
      ROUND(
        COUNT(*) FILTER (WHERE s.status = 'error')::numeric
        / NULLIF(COUNT(*), 0) * 100, 2
      )                                                     AS error_rate,
      COALESCE(SUM(s.tokens_in), 0)                         AS total_tokens_in,
      COALESCE(SUM(s.tokens_out), 0)                        AS total_tokens_out,
      COALESCE(SUM(s.cost_usd), 0)::numeric                AS total_cost_usd,
      COALESCE(SUM(s.duration_ms), 0)                       AS total_duration_ms,
      ROUND(
        COALESCE(AVG(s.duration_ms), 0)::numeric, 2
      )                                                     AS avg_duration_ms,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY s.duration_ms) AS p50_duration_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY s.duration_ms) AS p95_duration_ms,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY s.duration_ms) AS p99_duration_ms
    FROM traces.spans s
    INNER JOIN traces.traces t ON s.trace_id = t.id
    WHERE t.workspace_id = ${workspaceId}
      AND s.started_at >= ${start}
      AND s.started_at <= ${end}
    GROUP BY s.type
    ORDER BY count DESC
    LIMIT ${limit}
  `;
}

/**
 * Get full workspace analytics summary.
 */
export async function getWorkspaceAnalytics(
  sql: Sql,
  workspaceId: string,
  opts: { periodStart?: Date; periodEnd?: Date } = {},
): Promise<WorkspaceAnalytics | null> {
  const { periodStart, periodEnd } = opts;
  const start = periodStart ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const end = periodEnd ?? new Date();

  const [summary] = await sql<any[]>`
    SELECT
      ${workspaceId}::uuid                    AS workspace_id,
      ${start}::timestamptz                   AS period_start,
      ${end}::timestamptz                     AS period_end,
      COUNT(*)                                AS total_traces,
      COUNT(*) FILTER (WHERE status = 'error') AS error_traces,
      ROUND(
        COUNT(*) FILTER (WHERE status = 'error')::numeric
        / NULLIF(COUNT(*), 0) * 100, 2
      )                                      AS error_rate,
      COALESCE(SUM(total_tokens), 0)          AS total_tokens_in,
      0                                       AS total_tokens_out,
      COALESCE(SUM(total_cost_usd), 0)::numeric AS total_cost_usd,
      COALESCE(SUM(total_duration_ms), 0)     AS total_duration_ms
    FROM traces.traces
    WHERE workspace_id = ${workspaceId}
      AND started_at >= ${start}
      AND started_at <= ${end}
  `;

  if (!summary || summary.total_traces === 0) return null;

  const bySpanType = await getSpanAnalytics(sql, workspaceId, { periodStart: start, periodEnd: end });

  return { ...summary, by_span_type: bySpanType };
}

/**
 * Get cost breakdown by span type.
 */
export async function getCostBreakdown(
  sql: Sql,
  workspaceId: string,
  opts: { periodStart?: Date; periodEnd?: Date } = {},
): Promise<CostBreakdown[]> {
  const { periodStart, periodEnd } = opts;
  const start = periodStart ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const end = periodEnd ?? new Date();

  return sql<CostBreakdown[]>`
    SELECT
      s.type                                      AS span_type,
      COALESCE(SUM(s.cost_usd), 0)::numeric       AS total_cost_usd,
      COUNT(*)                                    AS total_calls,
      ROUND(
        COALESCE(AVG(s.cost_usd), 0)::numeric, 6
      )                                          AS avg_cost_per_call
    FROM traces.spans s
    INNER JOIN traces.traces t ON s.trace_id = t.id
    WHERE t.workspace_id = ${workspaceId}
      AND s.started_at >= ${start}
      AND s.started_at <= ${end}
    GROUP BY s.type
    ORDER BY total_cost_usd DESC
  `;
}

/**
 * Get latency distribution histogram buckets for a span type.
 */
export async function getLatencyHistogram(
  sql: Sql,
  workspaceId: string,
  spanType: string,
  opts: { periodStart?: Date; periodEnd?: Date; buckets?: number } = {},
): Promise<{ bucket_ms: number; count: number }[]> {
  const { periodStart, periodEnd, buckets = 10 } = opts;
  const start = periodStart ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const end = periodEnd ?? new Date();

  // Use width_bucket to create equal-width histogram buckets
  const [minRow] = await sql<[{ min_ms: number }]>`
    SELECT MIN(duration_ms) AS min_ms FROM traces.spans s
    INNER JOIN traces.traces t ON s.trace_id = t.id
    WHERE t.workspace_id = ${workspaceId}
      AND s.type = ${spanType}
      AND s.duration_ms IS NOT NULL
      AND s.started_at >= ${start}
      AND s.started_at <= ${end}
  `;
  const [maxRow] = await sql<[{ max_ms: number }]>`
    SELECT MAX(duration_ms) AS max_ms FROM traces.spans s
    INNER JOIN traces.traces t ON s.trace_id = t.id
    WHERE t.workspace_id = ${workspaceId}
      AND s.type = ${spanType}
      AND s.duration_ms IS NOT NULL
      AND s.started_at >= ${start}
      AND s.started_at <= ${end}
  `;

  if (!minRow || !maxRow || minRow.min_ms === null || maxRow.max_ms === null) {
    return [];
  }

  const minMs = minRow.min_ms;
  const maxMs = maxRow.max_ms;
  const bucketWidth = Math.max(1, Math.ceil((maxMs - minMs) / buckets));

  return sql<{ bucket_ms: number; count: number }[]>`
    SELECT
      (WIDTH_BUCKET(s.duration_ms, ${minMs}, ${maxMs}, ${buckets})) * ${bucketWidth} AS bucket_ms,
      COUNT(*)                                                                          AS count
    FROM traces.spans s
    INNER JOIN traces.traces t ON s.trace_id = t.id
    WHERE t.workspace_id = ${workspaceId}
      AND s.type = ${spanType}
      AND s.duration_ms IS NOT NULL
      AND s.started_at >= ${start}
      AND s.started_at <= ${end}
    GROUP BY bucket_ms
    ORDER BY bucket_ms
  `;
}

// ---------------------------------------------------------------------------
// Per-operation span analytics
// ---------------------------------------------------------------------------

export interface OperationAnalytics {
  operation_name: string;
  call_count: number;
  total_duration_ms: number;
  avg_duration_ms: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  p99_duration_ms: number;
  error_count: number;
  error_rate_pct: number;
}

/**
 * Get per-operation (span name) analytics for a workspace.
 */
export async function get_span_analytics(
  sql: Sql,
  workspaceId: string,
  since?: Date,
): Promise<OperationAnalytics[]> {
  const start = since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  return sql<OperationAnalytics[]>`
    SELECT
      s.name                                               AS operation_name,
      COUNT(*)                                               AS call_count,
      COALESCE(SUM(s.duration_ms), 0)                       AS total_duration_ms,
      ROUND(COALESCE(AVG(s.duration_ms), 0)::numeric, 2)    AS avg_duration_ms,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY s.duration_ms) AS p50_duration_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY s.duration_ms) AS p95_duration_ms,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY s.duration_ms) AS p99_duration_ms,
      COUNT(*) FILTER (WHERE s.status = 'error')            AS error_count,
      ROUND(
        COUNT(*) FILTER (WHERE s.status = 'error')::numeric
        / NULLIF(COUNT(*), 0) * 100, 2
      )                                                     AS error_rate_pct
    FROM traces.spans s
    INNER JOIN traces.traces t ON s.trace_id = t.id
    WHERE t.workspace_id = ${workspaceId}
      AND s.started_at >= ${start}
    GROUP BY s.name
    ORDER BY call_count DESC
  `;
}

// ---------------------------------------------------------------------------
// Slowest spans
// ---------------------------------------------------------------------------

export interface SlowestSpan {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  type: string;
  status: string;
  duration_ms: number;
  started_at: Date;
  error: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
}

/**
 * Get the top N slowest spans for a workspace.
 */
export async function get_slowest_spans(
  sql: Sql,
  workspaceId: string,
  limit: number = 10,
  since?: Date,
): Promise<SlowestSpan[]> {
  const start = since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const n = Math.min(Math.max(1, limit), 100);

  return sql<SlowestSpan[]>`
    SELECT
      s.id,
      s.trace_id,
      s.parent_span_id,
      s.name,
      s.type,
      s.status,
      s.duration_ms,
      s.started_at,
      s.error,
      s.model,
      s.tokens_in,
      s.tokens_out,
      s.cost_usd
    FROM traces.spans s
    INNER JOIN traces.traces t ON s.trace_id = t.id
    WHERE t.workspace_id = ${workspaceId}
      AND s.started_at >= ${start}
      AND s.duration_ms IS NOT NULL
    ORDER BY s.duration_ms DESC
    LIMIT ${n}
  `;
}

// ---------------------------------------------------------------------------
// Error spans
// ---------------------------------------------------------------------------

export interface ErrorSpan {
  span_id: string;
  trace_id: string;
  trace_name: string;
  name: string;
  type: string;
  status: string;
  error: string;
  started_at: Date;
  duration_ms: number | null;
}

/**
 * Get all spans with errors for a workspace.
 */
export async function get_error_spans(
  sql: Sql,
  workspaceId: string,
  since?: Date,
): Promise<ErrorSpan[]> {
  const start = since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  return sql<ErrorSpan[]>`
    SELECT
      s.id                                                 AS span_id,
      s.trace_id,
      t.name                                               AS trace_name,
      s.name,
      s.type,
      s.status,
      s.error,
      s.started_at,
      s.duration_ms
    FROM traces.spans s
    INNER JOIN traces.traces t ON s.trace_id = t.id
    WHERE t.workspace_id = ${workspaceId}
      AND s.started_at >= ${start}
      AND s.status = 'error'
      AND s.error IS NOT NULL
    ORDER BY s.started_at DESC
  `;
}

/**
 * Upsert rolling span analytics into the analytics table.
 */
export async function upsertSpanAnalytics(
  sql: Sql,
  traceId: string,
  workspaceId: string,
): Promise<void> {
  await sql`
    INSERT INTO traces.span_analytics (
      workspace_id, trace_id, span_type,
      total_count, error_count,
      total_tokens_in, total_tokens_out,
      total_cost_usd, total_duration_ms,
      avg_duration_ms, period_start, period_end
    )
    SELECT
      ${workspaceId}::uuid,
      ${traceId}::uuid,
      s.type,
      COUNT(*),
      COUNT(*) FILTER (WHERE s.status = 'error'),
      COALESCE(SUM(s.tokens_in), 0),
      COALESCE(SUM(s.tokens_out), 0),
      COALESCE(SUM(s.cost_usd), 0)::numeric,
      COALESCE(SUM(s.duration_ms), 0),
      ROUND(COALESCE(AVG(s.duration_ms), 0)::numeric, 2),
      NOW() - INTERVAL '1 hour',
      NOW()
    FROM traces.spans s
    WHERE s.trace_id = ${traceId}
    GROUP BY s.type
    ON CONFLICT (workspace_id, trace_id, span_type, period_start)
    DO UPDATE SET
      total_count     = EXCLUDED.total_count,
      error_count     = EXCLUDED.error_count,
      total_tokens_in = EXCLUDED.total_tokens_in,
      total_tokens_out = EXCLUDED.total_tokens_out,
      total_cost_usd  = EXCLUDED.total_cost_usd,
      total_duration_ms = EXCLUDED.total_duration_ms,
      avg_duration_ms = EXCLUDED.avg_duration_ms,
      period_end       = EXCLUDED.period_end
  `;
}

// ---------------------------------------------------------------------------
// Latency trend — time-series of percentiles per operation
// ---------------------------------------------------------------------------

export interface LatencyTrendPoint {
  bucket_start: Date;
  bucket_end: Date;
  operation_name: string;
  span_type: string | null;
  count: number;
  p50_ms: number | null;
  p75_ms: number | null;
  p90_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  avg_ms: number | null;
}

/**
 * Get latency percentile trend over time, bucketed by interval.
 * Useful for observing latency degradation or improvement over time.
 */
export async function getSpanLatencyTrend(
  sql: Sql,
  workspaceId: string,
  opts: {
    intervalMinutes?: number;
    periodStart?: Date;
    periodEnd?: Date;
    operationName?: string;
    spanType?: string;
  } = {},
): Promise<LatencyTrendPoint[]> {
  const {
    intervalMinutes = 60,
    periodStart,
    periodEnd,
    operationName,
    spanType,
  } = opts;
  const start = periodStart ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const end = periodEnd ?? new Date();
  const interval = `INTERVAL '${intervalMinutes} minutes'`;

  let operationFilter = "";
  let params: any[] = [workspaceId, start, end];
  let paramIdx = 4;

  if (operationName) {
    operationFilter = `AND s.name = $${paramIdx}`;
    params.push(operationName);
    paramIdx++;
  }
  if (spanType) {
    operationFilter += ` AND s.type = $${paramIdx}`;
    params.push(spanType);
    paramIdx++;
  }

  return sql<LatencyTrendPoint[]>`
    SELECT
      date_bin(${interval}, s.started_at, ${start}) AS bucket_start,
      date_bin(${interval}, s.started_at, ${start}) + ${interval} AS bucket_end,
      s.name                                                                AS operation_name,
      s.type                                                                AS span_type,
      COUNT(*)                                                              AS count,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY s.duration_ms)          AS p50_ms,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY s.duration_ms)          AS p75_ms,
      PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY s.duration_ms)          AS p90_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY s.duration_ms)          AS p95_ms,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY s.duration_ms)          AS p99_ms,
      ROUND(AVG(s.duration_ms)::numeric, 2)                                AS avg_ms
    FROM traces.spans s
    INNER JOIN traces.traces t ON s.trace_id = t.id
    WHERE t.workspace_id = ${workspaceId}
      AND s.started_at >= ${start}
      AND s.started_at <= ${end}
      AND s.duration_ms IS NOT NULL
      ${sql.unsafe(operationFilter, operationName ? [operationName] : spanType ? [spanType] : [])}
    GROUP BY date_bin(${interval}, s.started_at, ${start}), s.name, s.type
    ORDER BY bucket_start ASC
  `;
}

// ---------------------------------------------------------------------------
// Latency comparison between two periods
// ---------------------------------------------------------------------------

export interface LatencyPeriodComparison {
  operation_name: string;
  span_type: string | null;
  // Period A (older)
  count_a: number;
  avg_ms_a: number | null;
  p50_ms_a: number | null;
  p95_ms_a: number | null;
  p99_ms_a: number | null;
  // Period B (newer)
  count_b: number;
  avg_ms_b: number | null;
  p50_ms_b: number | null;
  p95_ms_b: number | null;
  p99_ms_b: number | null;
  // Deltas
  avg_delta_ms: number | null;
  avg_delta_pct: number | null;
  p50_delta_ms: number | null;
  p50_delta_pct: number | null;
  p95_delta_ms: number | null;
  p95_delta_pct: number | null;
  p99_delta_ms: number | null;
  p99_delta_pct: number | null;
}

/**
 * Compare latency percentiles between two time periods to detect regressions/improvements.
 */
export async function compareLatencyBetweenPeriods(
  sql: Sql,
  workspaceId: string,
  opts: {
    periodAStart: Date;
    periodAEnd: Date;
    periodBStart: Date;
    periodBEnd: Date;
    operationName?: string;
    spanType?: string;
  },
): Promise<LatencyPeriodComparison[]> {
  const {
    periodAStart,
    periodAEnd,
    periodBStart,
    periodBEnd,
    operationName,
    spanType,
  } = opts;

  let operationFilter = "";
  if (operationName) operationFilter = `AND s.name = '${operationName.replace(/'/g, "''")}'`;
  if (spanType) operationFilter += ` AND s.type = '${spanType.replace(/'/g, "''")}'`;

  const queryA = await sql<any[]>`
    SELECT
      s.name                                                                          AS operation_name,
      s.type                                                                          AS span_type,
      COUNT(*)                                                                         AS count_a,
      ROUND(AVG(s.duration_ms)::numeric, 2)                                            AS avg_ms_a,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY s.duration_ms)                      AS p50_ms_a,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY s.duration_ms)                      AS p95_ms_a,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY s.duration_ms)                      AS p99_ms_a
    FROM traces.spans s
    INNER JOIN traces.traces t ON s.trace_id = t.id
    WHERE t.workspace_id = ${workspaceId}
      AND s.started_at >= ${periodAStart}
      AND s.started_at <= ${periodAEnd}
      AND s.duration_ms IS NOT NULL
      ${sql.unsafe(operationFilter)}
    GROUP BY s.name, s.type
  `;

  const queryB = await sql<any[]>`
    SELECT
      s.name                                                                          AS operation_name,
      s.type                                                                          AS span_type,
      COUNT(*)                                                                         AS count_b,
      ROUND(AVG(s.duration_ms)::numeric, 2)                                            AS avg_ms_b,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY s.duration_ms)                      AS p50_ms_b,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY s.duration_ms)                      AS p95_ms_b,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY s.duration_ms)                      AS p99_ms_b
    FROM traces.spans s
    INNER JOIN traces.traces t ON s.trace_id = t.id
    WHERE t.workspace_id = ${workspaceId}
      AND s.started_at >= ${periodBStart}
      AND s.started_at <= ${periodBEnd}
      AND s.duration_ms IS NOT NULL
      ${sql.unsafe(operationFilter)}
    GROUP BY s.name, s.type
  `;

  const mapB = new Map(
    queryB.rows.map((r) => [`${r.operation_name}|${r.span_type}`, r]),
  );

  const result: LatencyPeriodComparison[] = [];
  for (const rowA of queryA.rows) {
    const key = `${rowA.operation_name}|${rowA.span_type}`;
    const rowB = mapB.get(key);
    if (!rowB) continue;

    const avgDelta =
      rowA.avg_ms_a && rowB.avg_ms_b
        ? rowB.avg_ms_b - rowA.avg_ms_a
        : null;
    const avgDeltaPct =
      rowA.avg_ms_a && rowA.avg_ms_a > 0
        ? ((rowB.avg_ms_b - rowA.avg_ms_a) / rowA.avg_ms_a) * 100
        : null;
    const p50Delta =
      rowA.p50_ms_a && rowB.p50_ms_b ? rowB.p50_ms_b - rowA.p50_ms_a : null;
    const p50DeltaPct =
      rowA.p50_ms_a && rowA.p50_ms_a > 0
        ? ((rowB.p50_ms_b - rowA.p50_ms_a) / rowA.p50_ms_a) * 100
        : null;
    const p95Delta =
      rowA.p95_ms_a && rowB.p95_ms_b ? rowB.p95_ms_b - rowA.p95_ms_a : null;
    const p95DeltaPct =
      rowA.p95_ms_a && rowA.p95_ms_a > 0
        ? ((rowB.p95_ms_b - rowA.p95_ms_a) / rowA.p95_ms_a) * 100
        : null;
    const p99Delta =
      rowA.p99_ms_a && rowB.p99_ms_b ? rowB.p99_ms_b - rowA.p99_ms_a : null;
    const p99DeltaPct =
      rowA.p99_ms_a && rowA.p99_ms_a > 0
        ? ((rowB.p99_ms_b - rowA.p99_ms_a) / rowA.p99_ms_a) * 100
        : null;

    result.push({
      operation_name: rowA.operation_name,
      span_type: rowA.span_type,
      count_a: rowA.count_a,
      avg_ms_a: rowA.avg_ms_a,
      p50_ms_a: rowA.p50_ms_a,
      p95_ms_a: rowA.p95_ms_a,
      p99_ms_a: rowA.p99_ms_a,
      count_b: rowB.count_b,
      avg_ms_b: rowB.avg_ms_b,
      p50_ms_b: rowB.p50_ms_b,
      p95_ms_b: rowB.p95_ms_b,
      p99_ms_b: rowB.p99_ms_b,
      avg_delta_ms: avgDelta,
      avg_delta_pct: avgDeltaPct,
      p50_delta_ms: p50Delta,
      p50_delta_pct: p50DeltaPct,
      p95_delta_ms: p95Delta,
      p95_delta_pct: p95DeltaPct,
      p99_delta_ms: p99Delta,
      p99_delta_pct: p99DeltaPct,
    });
  }

  return result;
}
