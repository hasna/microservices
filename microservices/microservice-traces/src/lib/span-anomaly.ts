/**
 * Span anomaly detection — identifies spans that are statistically anomalous
 * compared to rolling baselines per span-type.
 *
 * Detects:
 * - Latency anomalies (span much slower than typical for its type)
 * - Cost anomalies (unusually expensive for span type)
 * - Error rate anomalies (elevated errors for span type)
 */

import type { Sql } from "postgres";

export type AnomalyType = "latency" | "cost" | "error_rate" | "combined";

export interface SpanAnomaly {
  span_id: string;
  trace_id: string;
  span_name: string;
  span_type: string;
  anomaly_type: AnomalyType;
  anomaly_score: number;    // 0.0 (normal) to 1.0 (highly anomalous)
  current_value: number;
  baseline_p99: number;
  baseline_avg: number;
  deviation_factor: number; // how many std devs from normal
}

export interface AnomalyBaseline {
  span_type: string;
  p50_duration_ms: number;
  p90_duration_ms: number;
  p99_duration_ms: number;
  avg_error_rate: number;
  avg_cost_per_call: number;
  sample_count: number;
  updated_at: Date;
}

/**
 * Update the rolling baseline for a span type in a workspace.
 * Call this periodically (e.g., every hour) to refresh baselines.
 */
export async function refreshAnomalyBaseline(
  sql: Sql,
  workspaceId: string,
  spanType: string,
  windowDays = 7,
): Promise<void> {
  const since = new Date(Date.now() - windowDays * 86400000);

  const [row] = await sql<{
    p50: string;
    p90: string;
    p99: string;
    error_rate: string;
    avg_cost: string;
    count: string;
  }>`
    SELECT
      COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY s.duration_ms), 0)::text AS p50,
      COALESCE(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY s.duration_ms), 0)::text AS p90,
      COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY s.duration_ms), 0)::text AS p99,
      COALESCE(COUNT(*) FILTER (WHERE s.status = 'error')::numeric / NULLIF(COUNT(*), 0), 0)::text AS error_rate,
      COALESCE(AVG(COALESCE(s.cost_usd, 0)), 0)::text AS avg_cost,
      COUNT(*)::text AS count
    FROM traces.spans s
    JOIN traces.traces t ON t.id = s.trace_id
    WHERE t.workspace_id = ${workspaceId}
      AND s.type = ${spanType}
      AND t.started_at >= ${since}
  `;

  await sql`
    INSERT INTO traces.span_anomaly_baselines
      (workspace_id, span_type, p50_duration_ms, p90_duration_ms, p99_duration_ms, avg_error_rate, avg_cost_per_call, sample_count, updated_at)
    VALUES
      (${workspaceId}, ${spanType}, ${parseFloat(row?.p50 ?? "0")}, ${parseFloat(row?.p90 ?? "0")}, ${parseFloat(row?.p99 ?? "0")}, ${parseFloat(row?.error_rate ?? "0")}, ${parseFloat(row?.avg_cost ?? "0")}, ${parseInt(row?.count ?? "0", 10)}, NOW())
    ON CONFLICT (workspace_id, span_type) DO UPDATE SET
      p50_duration_ms = EXCLUDED.p50_duration_ms,
      p90_duration_ms = EXCLUDED.p90_duration_ms,
      p99_duration_ms = EXCLUDED.p99_duration_ms,
      avg_error_rate = EXCLUDED.avg_error_rate,
      avg_cost_per_call = EXCLUDED.avg_cost_per_call,
      sample_count = EXCLUDED.sample_count,
      updated_at = NOW()
  `;
}

/**
 * Refresh all baselines for a workspace (call periodically).
 */
export async function refreshAllBaselines(
  sql: Sql,
  workspaceId: string,
): Promise<void> {
  const spanTypes = await sql<{ span_type: string }[]>`
    SELECT DISTINCT type AS span_type FROM traces.spans s
    JOIN traces.traces t ON t.id = s.trace_id
    WHERE t.workspace_id = ${workspaceId}
  `;

  for (const { span_type } of spanTypes) {
    await refreshAnomalyBaseline(sql, workspaceId, span_type);
  }
}

/**
 * Get baseline for a specific span type.
 */
export async function getSpanTypeBaseline(
  sql: Sql,
  workspaceId: string,
  spanType: string,
): Promise<AnomalyBaseline | null> {
  const [row] = await sql<{
    span_type: string;
    p50_duration_ms: string;
    p90_duration_ms: string;
    p99_duration_ms: string;
    avg_error_rate: string;
    avg_cost_per_call: string;
    sample_count: string;
    updated_at: Date;
  }>`
    SELECT * FROM traces.span_anomaly_baselines
    WHERE workspace_id = ${workspaceId} AND span_type = ${spanType}
  `;

  if (!row) return null;
  return {
    span_type: row.span_type,
    p50_duration_ms: parseFloat(row.p50_duration_ms),
    p90_duration_ms: parseFloat(row.p90_duration_ms),
    p99_duration_ms: parseFloat(row.p99_duration_ms),
    avg_error_rate: parseFloat(row.avg_error_rate),
    avg_cost_per_call: parseFloat(row.avg_cost_per_call),
    sample_count: parseInt(row.sample_count, 10),
    updated_at: row.updated_at,
  };
}

/**
 * Score how anomalous a single span is (0.0 = normal, 1.0 = highly anomalous).
 */
function scoreAnomaly(
  current: number,
  baselineP99: number,
  baselineAvg: number,
): { score: number; type: AnomalyType; deviationFactor: number } {
  if (baselineP99 <= 0) return { score: 0, type: "latency", deviationFactor: 0 };

  const deviation = current - baselineAvg;
  const stdDev = (baselineP99 - baselineAvg) / 3; // approximate from p99
  const deviationFactor = stdDev > 0 ? Math.abs(deviation) / stdDev : 0;
  const score = Math.min(1.0, deviationFactor / 4); // normalize to 0-1, 4 std devs = max

  return { score, type: "latency" as AnomalyType, deviationFactor };
}

/**
 * Detect anomalies for recent spans in a workspace.
 */
export async function detectSpanAnomalies(
  sql: Sql,
  workspaceId: string,
  opts: {
    since?: Date;
    minScore?: number;
    spanTypes?: string[];
    limit?: number;
  } = {},
): Promise<SpanAnomaly[]> {
  const since = opts.since ?? new Date(Date.now() - 1 * 86400000);
  const minScore = opts.minScore ?? 0.5;
  const limit = opts.limit ?? 100;

  const typeFilter = opts.spanTypes && opts.spanTypes.length > 0
    ? `AND s.type = ANY(${JSON.stringify(opts.spanTypes)})`
    : "";

  const spans = await sql<any[]>`
    SELECT
      s.id AS span_id,
      s.trace_id,
      s.name AS span_name,
      s.type AS span_type,
      s.duration_ms,
      s.cost_usd,
      s.status,
      t.status AS trace_status
    FROM traces.spans s
    JOIN traces.traces t ON t.id = s.trace_id
    WHERE t.workspace_id = ${workspaceId}
      AND t.started_at >= ${since}
      ${sql.unsafe(typeFilter)}
    ORDER BY t.started_at DESC
    LIMIT 500
  `;

  const anomalies: SpanAnomaly[] = [];

  for (const span of spans) {
    const baseline = await getSpanTypeBaseline(sql, workspaceId, span.span_type);
    if (!baseline || baseline.sample_count < 10) continue; // need minimum samples

    const { score: latencyScore, deviationFactor } = scoreAnomaly(
      span.duration_ms ?? 0,
      baseline.p99_duration_ms,
      baseline.p50_duration_ms,
    );

    const errorScore = span.status === "error" && baseline.avg_error_rate < 0.5
      ? Math.min(1.0, baseline.avg_error_rate < 0.1 ? 0.8 : 0.4)
      : 0;

    const costScore = span.cost_usd
      ? scoreAnomaly(span.cost_usd, baseline.avg_cost_per_call * 5, baseline.avg_cost_per_call).score
      : 0;

    const combinedScore = Math.max(latencyScore, errorScore, costScore);

    if (combinedScore >= minScore) {
      let anomalyType: AnomalyType = "combined";
      if (latencyScore >= combinedScore * 0.8) anomalyType = "latency";
      else if (errorScore >= combinedScore * 0.8) anomalyType = "error_rate";
      else if (costScore >= combinedScore * 0.8) anomalyType = "cost";

      anomalies.push({
        span_id: span.span_id,
        trace_id: span.trace_id,
        span_name: span.span_name,
        span_type: span.span_type,
        anomaly_type: anomalyType,
        anomaly_score: Math.round(combinedScore * 10000) / 10000,
        current_value: span.duration_ms ?? 0,
        baseline_p99: baseline.p99_duration_ms,
        baseline_avg: baseline.p50_duration_ms,
        deviation_factor: Math.round(deviationFactor * 100) / 100,
      });

      // Mark span as anomalous in DB
      await sql`
        UPDATE traces.spans SET
          is_anomalous = true,
          anomaly_score = ${combinedScore},
          anomaly_type = ${anomalyType}
        WHERE id = ${span.span_id}
      `;
    }
  }

  return anomalies.slice(0, limit);
}

/**
 * Get anomaly summary for a workspace.
 */
export async function getAnomalySummary(
  sql: Sql,
  workspaceId: string,
  since?: Date,
): Promise<{
  total_spans_checked: number;
  anomalous_spans: number;
  by_type: Record<string, number>;
  avg_score: number;
}> {
  const sinceDate = since ?? new Date(Date.now() - 7 * 86400000);

  const [countRow] = await sql<{ total: string; anomalous: string; avg_score: string }[]>`
    SELECT
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE is_anomalous = true)::text AS anomalous,
      COALESCE(AVG(anomaly_score) FILTER (WHERE is_anomalous = true), 0)::text AS avg_score
    FROM traces.spans s
    JOIN traces.traces t ON t.id = s.trace_id
    WHERE t.workspace_id = ${workspaceId}
      AND t.started_at >= ${sinceDate}
  `;

  const byTypeRows = await sql<{ span_type: string; count: string }[]>`
    SELECT s.type AS span_type, COUNT(*)::text AS count
    FROM traces.spans s
    JOIN traces.traces t ON t.id = s.trace_id
    WHERE t.workspace_id = ${workspaceId}
      AND t.started_at >= ${sinceDate}
      AND s.is_anomalous = true
    GROUP BY 1
  `;

  const by_type: Record<string, number> = {};
  for (const r of byTypeRows) {
    by_type[r.span_type] = parseInt(r.count, 10);
  }

  return {
    total_spans_checked: parseInt(countRow?.total ?? "0", 10),
    anomalous_spans: parseInt(countRow?.anomalous ?? "0", 10),
    by_type,
    avg_score: parseFloat(countRow?.avg_score ?? "0"),
  };
}
