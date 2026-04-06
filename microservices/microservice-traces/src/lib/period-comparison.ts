/**
 * Period-over-period comparison — compares trace analytics between two time windows.
 * Useful for understanding whether changes improved or degraded performance,
 * cost, or reliability.
 *
 * Supports: week-over-week, month-over-month, or arbitrary window comparison.
 */

import type { Sql } from "postgres";

export interface PeriodMetrics {
  period_start: Date;
  period_end: Date;
  total_traces: number;
  error_traces: number;
  error_rate: number;
  total_cost_usd: number;
  total_tokens_in: number;
  total_tokens_out: number;
  avg_duration_ms: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  p99_duration_ms: number;
  llm_span_count: number;
  llm_cost_usd: number;
  llm_tokens_in: number;
  llm_tokens_out: number;
}

export interface PeriodDelta {
  metric: string;
  current: number;
  previous: number;
  delta: number;
  delta_pct: number | null; // null if previous is 0
  direction: "up" | "down" | "unchanged";
}

export interface PeriodComparison {
  workspace_id: string;
  current_period: PeriodMetrics;
  previous_period: PeriodMetrics;
  deltas: PeriodDelta[];
  improvement_score: number; // positive = improved, negative = degraded
}

/**
 * Get aggregated metrics for a time period.
 */
async function getPeriodMetrics(
  sql: Sql,
  workspaceId: string,
  start: Date,
  end: Date,
): Promise<PeriodMetrics> {
  const [summary] = await sql<{
    total_traces: string;
    error_traces: string;
    total_cost: string;
    total_tokens_in: string;
    total_tokens_out: string;
    avg_dur: string;
    p50_dur: string;
    p95_dur: string;
    p99_dur: string;
  }[]>`
    SELECT
      COUNT(*)::text AS total_traces,
      COUNT(*) FILTER (WHERE status = 'error')::text AS error_traces,
      COALESCE(SUM(total_cost_usd), 0)::text AS total_cost,
      COALESCE(SUM(total_tokens), 0)::text AS total_tokens_in,
      0::text AS total_tokens_out,
      COALESCE(AVG(total_duration_ms), 0)::text AS avg_dur,
      COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_duration_ms), 0)::text AS p50_dur,
      COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_duration_ms), 0)::text AS p95_dur,
      COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY total_duration_ms), 0)::text AS p99_dur
    FROM traces.traces
    WHERE workspace_id = ${workspaceId}
      AND started_at >= ${start}
      AND started_at <= ${end}
  `;

  const [llmRow] = await sql<{
    llm_count: string;
    llm_cost: string;
    llm_tokens_in: string;
    llm_tokens_out: string;
  }[]>`
    SELECT
      COUNT(*)::text AS llm_count,
      COALESCE(SUM(COALESCE(s.cost_usd, 0)), 0)::text AS llm_cost,
      COALESCE(SUM(COALESCE(s.tokens_in, 0)), 0)::text AS llm_tokens_in,
      COALESCE(SUM(COALESCE(s.tokens_out, 0)), 0)::text AS llm_tokens_out
    FROM traces.spans s
    JOIN traces.traces t ON t.id = s.trace_id
    WHERE t.workspace_id = ${workspaceId}
      AND s.type = 'llm'
      AND t.started_at >= ${start}
      AND t.started_at <= ${end}
  `;

  const totalTraces = parseInt(summary?.total_traces ?? "0", 10);
  const errorTraces = parseInt(summary?.error_traces ?? "0", 10);

  return {
    period_start: start,
    period_end: end,
    total_traces: totalTraces,
    error_traces: errorTraces,
    error_rate: totalTraces > 0 ? parseFloat(((errorTraces / totalTraces) * 100).toFixed(4)) : 0,
    total_cost_usd: parseFloat(summary?.total_cost ?? "0"),
    total_tokens_in: parseInt(summary?.total_tokens_in ?? "0", 10),
    total_tokens_out: parseInt(summary?.total_tokens_out ?? "0", 10),
    avg_duration_ms: Math.round(parseFloat(summary?.avg_dur ?? "0")),
    p50_duration_ms: Math.round(parseFloat(summary?.p50_dur ?? "0")),
    p95_duration_ms: Math.round(parseFloat(summary?.p95_dur ?? "0")),
    p99_duration_ms: Math.round(parseFloat(summary?.p99_dur ?? "0")),
    llm_span_count: parseInt(llmRow?.llm_count ?? "0", 10),
    llm_cost_usd: parseFloat(llmRow?.llm_cost ?? "0"),
    llm_tokens_in: parseInt(llmRow?.llm_tokens_in ?? "0", 10),
    llm_tokens_out: parseInt(llmRow?.llm_tokens_out ?? "0", 10),
  };
}

/**
 * Compute delta between two values (for metrics where lower is better).
 */
function deltaLowerIsBetter(current: number, previous: number): PeriodDelta {
  const delta = current - previous;
  const deltaPct = previous !== 0 ? parseFloat((((current - previous) / previous) * 100).toFixed(2)) : null;
  let direction: "up" | "down" | "unchanged" = "unchanged";
  if (delta < 0) direction = "down"; // improvement (lower is better)
  else if (delta > 0) direction = "up"; // degradation

  return { metric: "", current, previous, delta, delta_pct: deltaPct, direction };
}

/**
 * Compute delta between two values (for metrics where higher is better).
 */
function deltaHigherIsBetter(current: number, previous: number): PeriodDelta {
  const delta = current - previous;
  const deltaPct = previous !== 0 ? parseFloat((((current - previous) / previous) * 100).toFixed(2)) : null;
  let direction: "up" | "down" | "unchanged" = "unchanged";
  if (delta > 0) direction = "up"; // improvement (higher is better)
  else if (delta < 0) direction = "down"; // degradation

  return { metric: "", current, previous, delta, delta_pct: deltaPct, direction };
}

/**
 * Compare two time periods for a workspace.
 * Returns metrics for both periods plus deltas and an overall improvement score.
 *
 * @param sql - Database connection
 * @param workspaceId - Workspace to analyze
 * @param currentStart - Start of current period
 * @param currentEnd - End of current period
 * @param previousStart - Start of comparison period
 * @param previousEnd - End of comparison period
 */
export async function comparePeriods(
  sql: Sql,
  workspaceId: string,
  currentStart: Date,
  currentEnd: Date,
  previousStart: Date,
  previousEnd: Date,
): Promise<PeriodComparison> {
  const [current, previous] = await Promise.all([
    getPeriodMetrics(sql, workspaceId, currentStart, currentEnd),
    getPeriodMetrics(sql, workspaceId, previousStart, previousEnd),
  ]);

  const deltas: PeriodDelta[] = [];

  // Trace volume (higher is generally better = more usage)
  const traceDelta = deltaHigherIsBetter(current.total_traces, previous.total_traces);
  traceDelta.metric = "total_traces";
  deltas.push(traceDelta);

  // Error rate (lower is better)
  const errorRateDelta = deltaLowerIsBetter(current.error_rate, previous.error_rate);
  errorRateDelta.metric = "error_rate";
  deltas.push(errorRateDelta);

  // Cost (lower is better)
  const costDelta = deltaLowerIsBetter(current.total_cost_usd, previous.total_cost_usd);
  costDelta.metric = "total_cost_usd";
  deltas.push(costDelta);

  // LLM cost (lower is better)
  const llmCostDelta = deltaLowerIsBetter(current.llm_cost_usd, previous.llm_cost_usd);
  llmCostDelta.metric = "llm_cost_usd";
  deltas.push(llmCostDelta);

  // P50 latency (lower is better)
  const p50Delta = deltaLowerIsBetter(current.p50_duration_ms, previous.p50_duration_ms);
  p50Delta.metric = "p50_duration_ms";
  deltas.push(p50Delta);

  // P95 latency (lower is better)
  const p95Delta = deltaLowerIsBetter(current.p95_duration_ms, previous.p95_duration_ms);
  p95Delta.metric = "p95_duration_ms";
  deltas.push(p95Delta);

  // P99 latency (lower is better)
  const p99Delta = deltaLowerIsBetter(current.p99_duration_ms, previous.p99_duration_ms);
  p99Delta.metric = "p99_duration_ms";
  deltas.push(p99Delta);

  // Total tokens in (context: higher might mean more context being used)
  const tokensInDelta = deltaHigherIsBetter(current.total_tokens_in, previous.total_tokens_in);
  tokensInDelta.metric = "total_tokens_in";
  deltas.push(tokensInDelta);

  // LLM tokens out (higher might mean more output generated)
  const tokensOutDelta = deltaHigherIsBetter(current.llm_tokens_out, previous.llm_tokens_out);
  tokensOutDelta.metric = "llm_tokens_out";
  deltas.push(tokensOutDelta);

  // Compute improvement score:
  // +1 for each metric that improved (lower for cost/latency/error, higher for throughput)
  // -1 for each that degraded
  // Normalized to -100 to +100 scale
  let score = 0;
  // Cost/error/latency: lower is better
  score += costDelta.direction === "down" ? 1 : costDelta.direction === "up" ? -1 : 0;
  score += errorRateDelta.direction === "down" ? 1 : errorRateDelta.direction === "up" ? -1 : 0;
  score += p50Delta.direction === "down" ? 1 : p50Delta.direction === "up" ? -1 : 0;
  score += p95Delta.direction === "down" ? 1 : p95Delta.direction === "up" ? -1 : 0;
  score += p99Delta.direction === "down" ? 1 : p99Delta.direction === "up" ? -1 : 0;
  // Volume: higher is better
  score += traceDelta.direction === "up" ? 1 : traceDelta.direction === "down" ? -1 : 0;

  const maxScore = 6;
  const improvementScore = parseFloat(((score / maxScore) * 100).toFixed(1));

  return {
    workspace_id: workspaceId,
    current_period: current,
    previous_period: previous,
    deltas,
    improvement_score: improvementScore,
  };
}

/**
 * Quick week-over-week comparison.
 */
export async function compareWeekOverWeek(
  sql: Sql,
  workspaceId: string,
  weekEndDate?: Date,
): Promise<PeriodComparison> {
  const end = weekEndDate ?? new Date();
  const currentStart = new Date(end.getTime() - 7 * 86400000);
  const previousStart = new Date(currentStart.getTime() - 7 * 86400000);
  const previousEnd = new Date(currentStart.getTime() - 1);

  return comparePeriods(sql, workspaceId, currentStart, end, previousStart, previousEnd);
}

/**
 * Quick month-over-month comparison.
 */
export async function compareMonthOverMonth(
  sql: Sql,
  workspaceId: string,
  monthEndDate?: Date,
): Promise<PeriodComparison> {
  const end = monthEndDate ?? new Date();
  const currentStart = new Date(end.getTime() - 30 * 86400000);
  const previousStart = new Date(currentStart.getTime() - 30 * 86400000);
  const previousEnd = new Date(currentStart.getTime() - 1);

  return comparePeriods(sql, workspaceId, currentStart, end, previousStart, previousEnd);
}
