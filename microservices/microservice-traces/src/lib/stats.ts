/**
 * Trace statistics and analytics.
 */

import type { Sql } from "postgres";

export interface SpanTypeStat {
  type: string;
  count: number;
  avg_duration_ms: number;
  total_tokens: number;
  total_cost_usd: number;
}

export interface TraceStats {
  total_traces: number;
  completed: number;
  errored: number;
  avg_duration_ms: number;
  avg_tokens: number;
  avg_cost_usd: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  by_span_type: SpanTypeStat[];
  top_errors: { error: string; count: number }[];
  traces_per_day: { date: string; count: number }[];
}

export async function getTraceStats(
  sql: Sql,
  workspaceId: string,
  since?: Date
): Promise<TraceStats> {
  const sinceDate = since ?? new Date(Date.now() - 30 * 86400000);

  // Basic counts
  const [counts] = await sql<[{ total: string; completed: string; errored: string }]>`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COUNT(*) FILTER (WHERE status = 'error') as errored
    FROM traces.traces
    WHERE workspace_id = ${workspaceId} AND started_at >= ${sinceDate}
  `;

  // Averages
  const [avgs] = await sql<[{ avg_duration: string; avg_tokens: string; avg_cost: string }]>`
    SELECT
      COALESCE(AVG(total_duration_ms), 0) as avg_duration,
      COALESCE(AVG(total_tokens), 0) as avg_tokens,
      COALESCE(AVG(total_cost_usd), 0) as avg_cost
    FROM traces.traces
    WHERE workspace_id = ${workspaceId} AND started_at >= ${sinceDate}
  `;

  // Percentiles
  const [percentiles] = await sql<[{ p50: string; p95: string }]>`
    SELECT
      COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_duration_ms), 0) as p50,
      COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_duration_ms), 0) as p95
    FROM traces.traces
    WHERE workspace_id = ${workspaceId} AND started_at >= ${sinceDate} AND total_duration_ms IS NOT NULL
  `;

  // By span type
  const bySpanType = await sql<{ type: string; count: string; avg_duration: string; total_tokens: string; total_cost: string }[]>`
    SELECT
      s.type,
      COUNT(*) as count,
      COALESCE(AVG(s.duration_ms), 0) as avg_duration,
      COALESCE(SUM(COALESCE(s.tokens_in, 0) + COALESCE(s.tokens_out, 0)), 0) as total_tokens,
      COALESCE(SUM(COALESCE(s.cost_usd, 0)), 0) as total_cost
    FROM traces.spans s
    JOIN traces.traces t ON t.id = s.trace_id
    WHERE t.workspace_id = ${workspaceId} AND t.started_at >= ${sinceDate}
    GROUP BY s.type
    ORDER BY count DESC
  `;

  // Top errors
  const topErrors = await sql<{ error: string; count: string }[]>`
    SELECT error, COUNT(*) as count
    FROM traces.traces
    WHERE workspace_id = ${workspaceId} AND started_at >= ${sinceDate} AND error IS NOT NULL
    GROUP BY error ORDER BY count DESC LIMIT 10
  `;

  // Traces per day
  const tracesPerDay = await sql<{ date: string; count: string }[]>`
    SELECT DATE(started_at)::text as date, COUNT(*) as count
    FROM traces.traces
    WHERE workspace_id = ${workspaceId} AND started_at >= ${sinceDate}
    GROUP BY DATE(started_at) ORDER BY date
  `;

  return {
    total_traces: parseInt(counts.total),
    completed: parseInt(counts.completed),
    errored: parseInt(counts.errored),
    avg_duration_ms: Math.round(parseFloat(avgs.avg_duration)),
    avg_tokens: Math.round(parseFloat(avgs.avg_tokens)),
    avg_cost_usd: parseFloat(parseFloat(avgs.avg_cost).toFixed(6)),
    p50_duration_ms: Math.round(parseFloat(percentiles.p50)),
    p95_duration_ms: Math.round(parseFloat(percentiles.p95)),
    by_span_type: bySpanType.map(r => ({
      type: r.type,
      count: parseInt(r.count),
      avg_duration_ms: Math.round(parseFloat(r.avg_duration)),
      total_tokens: parseInt(r.total_tokens),
      total_cost_usd: parseFloat(parseFloat(r.total_cost).toFixed(6)),
    })),
    top_errors: topErrors.map(r => ({ error: r.error, count: parseInt(r.count) })),
    traces_per_day: tracesPerDay.map(r => ({ date: r.date, count: parseInt(r.count) })),
  };
}

/**
 * Compute percentile from a sorted array of numbers (pure function for testing).
 */
export function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Compute error rate as percentage (pure function for testing).
 */
export function computeErrorRate(errored: number, total: number): number {
  if (total === 0) return 0;
  return (errored / total) * 100;
}
