/**
 * Trace-level analytics beyond basic stats — latency percentiles, error rate
 * timelines, and flame-graph data.
 */

import type { Sql } from "postgres";
import { buildSpanTree } from "./query.js";
import type { TraceWithSpans } from "./query.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LatencyPercentile {
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
}

export interface ErrorRatePoint {
  bucket: Date;
  total: number;
  errors: number;
  error_rate: number;
}

export interface FlameGraphNode {
  name: string;
  value: number;       // duration_ms
  count: number;
  type: string;
  children?: FlameGraphNode[];
}

export interface TraceFlameGraph {
  trace_id: string;
  root_span_id: string;
  total_duration_ms: number;
  nodes: FlameGraphNode[];
}

export interface LatencyBreakdown {
  bucket_ms: number;
  bucket_label: string;
  count: number;
  pct_of_total: number;
}

export interface TraceTimeSeriesPoint {
  time: Date;
  count: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  total_cost: number;
  total_tokens: number;
  error_count: number;
}

// ─── Latency Percentiles ───────────────────────────────────────────────────

/**
 * Get per-trace latency percentiles across a workspace within a time window.
 */
export async function getTraceLatencyPercentiles(
  sql: Sql,
  workspaceId: string,
  since?: Date,
): Promise<LatencyPercentile> {
  const sinceDate = since ?? new Date(Date.now() - 7 * 86400000);

  const [row] = await sql<[{ p50: string; p75: string; p90: string; p95: string; p99: string; p999: string }]>`
    SELECT
      COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_duration_ms), 0) as p50,
      COALESCE(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY total_duration_ms), 0) as p75,
      COALESCE(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY total_duration_ms), 0) as p90,
      COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_duration_ms), 0) as p95,
      COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY total_duration_ms), 0) as p99,
      COALESCE(PERCENTILE_CONT(0.999) WITHIN GROUP (ORDER BY total_duration_ms), 0) as p999
    FROM traces.traces
    WHERE workspace_id = ${workspaceId}
      AND started_at >= ${sinceDate}
      AND total_duration_ms IS NOT NULL
  `;

  return {
    p50: Math.round(parseFloat(row.p50)),
    p75: Math.round(parseFloat(row.p75)),
    p90: Math.round(parseFloat(row.p90)),
    p95: Math.round(parseFloat(row.p95)),
    p99: Math.round(parseFloat(row.p99)),
    p999: Math.round(parseFloat(row.p999)),
  };
}

// ─── Error Rate Timeline ───────────────────────────────────────────────────

/**
 * Get error rate over time in configurable buckets (default: 1-hour buckets).
 */
export async function getErrorRateTimeline(
  sql: Sql,
  workspaceId: string,
  opts: { since?: Date; bucketMinutes?: number } = {},
): Promise<ErrorRatePoint[]> {
  const sinceDate = opts.since ?? new Date(Date.now() - 7 * 86400000);
  const bucket = opts.bucketMinutes ?? 60;

  const rows = await sql<{ bucket: string; total: string; errors: string }[]>`
    SELECT
      DATE_TRUNC('minute', started_at) - (EXTRACT(MINUTE FROM started_at)::int % ${bucket}) * interval '1 minute' AS bucket,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'error')::int AS errors
    FROM traces.traces
    WHERE workspace_id = ${workspaceId}
      AND started_at >= ${sinceDate}
    GROUP BY 1
    ORDER BY 1
  `;

  return rows.map((r) => ({
    bucket: new Date(r.bucket),
    total: parseInt(r.total, 10),
    errors: parseInt(r.errors, 10),
    error_rate: parseFloat(((parseInt(r.errors, 10) / Math.max(parseInt(r.total, 10), 1)) * 100).toFixed(2)),
  }));
}

// ─── Latency Histogram ─────────────────────────────────────────────────────

/**
 * Get a histogram of trace durations (bucketed) for a workspace.
 */
export async function getTraceDurationHistogram(
  sql: Sql,
  workspaceId: string,
  opts: { since?: Date; bucketCount?: number } = {},
): Promise<LatencyBreakdown[]> {
  const sinceDate = opts.since ?? new Date(Date.now() - 7 * 86400000);
  const bucketCount = opts.bucketCount ?? 20;

  const [minRow] = await sql<[{ min_dur: string }]>`
    SELECT COALESCE(MIN(total_duration_ms), 0)::int as min_dur FROM traces.traces
    WHERE workspace_id = ${workspaceId} AND started_at >= ${sinceDate}
  `;
  const [maxRow] = await sql<[{ max_dur: string }]>`
    SELECT COALESCE(MAX(total_duration_ms), 0)::int as max_dur FROM traces.traces
    WHERE workspace_id = ${workspaceId} AND started_at >= ${sinceDate}
  `;

  const min = parseInt(minRow.min_dur, 10);
  const max = Math.max(parseInt(maxRow.max_dur, 10), min + 1);
  const bucketSize = Math.max(1, Math.ceil((max - min) / bucketCount));

  const buckets: LatencyBreakdown[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const lo = min + i * bucketSize;
    const hi = lo + bucketSize;
    const label = i === bucketCount - 1
      ? `>${lo}ms`
      : `${lo}–${hi}ms`;
    buckets.push({ bucket_ms: lo, bucket_label: label, count: 0, pct_of_total: 0 });
  }

  // Fetch raw durations and bin them
  const durations = await sql<{ duration: string }[]>`
    SELECT total_duration_ms::text as duration FROM traces.traces
    WHERE workspace_id = ${workspaceId}
      AND started_at >= ${sinceDate}
      AND total_duration_ms IS NOT NULL
  `;

  const total = durations.length;
  for (const { duration } of durations) {
    const d = parseInt(duration, 10);
    const idx = Math.min(Math.floor((d - min) / bucketSize), bucketCount - 1);
    if (idx >= 0) buckets[idx].count++;
  }

  return buckets.map((b) => ({
    ...b,
    pct_of_total: total > 0 ? parseFloat(((b.count / total) * 100).toFixed(2)) : 0,
  }));
}

// ─── Flame Graph ────────────────────────────────────────────────────────────

/**
 * Build a flame-graph-compatible tree from a single trace.
 * Each node has name, value (duration), type, and optional children.
 */
export function buildFlameGraph(trace: TraceWithSpans): TraceFlameGraph {
  const tree = buildSpanTree(trace.spans);

  function nodeToFlame(node: any): FlameGraphNode {
    const duration = node.duration_ms ?? 0;
    const children = (node.children ?? []).map(nodeToFlame);

    return {
      name: node.name,
      value: duration,
      count: 1,
      type: node.type,
      children: children.length > 0 ? children : undefined,
    };
  }

  const totalDuration = trace.total_duration_ms ?? 0;

  // Handle case where no spans
  if (tree.length === 0) {
    return {
      trace_id: trace.id,
      root_span_id: "",
      total_duration_ms: totalDuration,
      nodes: [],
    };
  }

  // Find root spans (no parent)
  const roots = tree.filter((s: any) => !s.parent_span_id);
  const nodes = roots.map(nodeToFlame);

  return {
    trace_id: trace.id,
    root_span_id: roots[0]?.id ?? "",
    total_duration_ms: totalDuration,
    nodes,
  };
}

/**
 * Build flame graph from a trace ID (DB lookup).
 */
export async function buildTraceFlameGraph(
  sql: Sql,
  traceId: string,
): Promise<TraceFlameGraph | null> {
  const { getTrace } = await import("./query.js");
  const trace = await getTrace(sql, traceId);
  if (!trace) return null;
  return buildFlameGraph(trace);
}

// ─── Trace Time Series ─────────────────────────────────────────────────────

/**
 * Get a time-series of trace metrics in configurable buckets.
 */
export async function getTraceTimeSeries(
  sql: Sql,
  workspaceId: string,
  opts: { since?: Date; bucketMinutes?: number } = {},
): Promise<TraceTimeSeriesPoint[]> {
  const sinceDate = opts.since ?? new Date(Date.now() - 7 * 86400000);
  const bucket = opts.bucketMinutes ?? 60;

  const rows = await sql<{
    bucket: string;
    count: string;
    avg_dur: string;
    p95_dur: string;
    total_cost: string;
    total_tokens: string;
    error_count: string;
  }[]>`
    SELECT
      DATE_TRUNC('minute', started_at) - (EXTRACT(MINUTE FROM started_at)::int % ${bucket}) * interval '1 minute' AS bucket,
      COUNT(*)::int AS count,
      COALESCE(AVG(total_duration_ms), 0) AS avg_dur,
      COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_duration_ms), 0) AS p95_dur,
      COALESCE(SUM(total_cost_usd), 0) AS total_cost,
      COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
      COUNT(*) FILTER (WHERE status = 'error')::int AS error_count
    FROM traces.traces
    WHERE workspace_id = ${workspaceId}
      AND started_at >= ${sinceDate}
    GROUP BY 1
    ORDER BY 1
  `;

  return rows.map((r) => ({
    time: new Date(r.bucket),
    count: parseInt(r.count, 10),
    avg_duration_ms: Math.round(parseFloat(r.avg_dur)),
    p95_duration_ms: Math.round(parseFloat(r.p95_dur)),
    total_cost: parseFloat(r.total_cost),
    total_tokens: parseInt(r.total_tokens, 10),
    error_count: parseInt(r.error_count, 10),
  }));
}
