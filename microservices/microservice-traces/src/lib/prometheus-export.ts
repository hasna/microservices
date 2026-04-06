/**
 * Prometheus / OpenMetrics export for traces.
 *
 * Converts trace and span data into Prometheus metric families
 * that can be served from a /metrics endpoint.
 */

import type { Sql } from "postgres";

export type PrometheusMetricType = "counter" | "gauge" | "histogram" | "summary";

export interface PrometheusMetric {
  name: string;
  help: string;
  type: PrometheusMetricType;
  labels: Record<string, string>;
  value: number;
  buckets?: number[];   // for histogram
  quantiles?: number[];  // for summary
}

export interface PrometheusExport {
  workspace_id: string;
  metrics: PrometheusMetric[];
  generated_at: Date;
}

/**
 * Generate Prometheus-format string from metrics array.
 */
export function toPrometheusTextFormat(metrics: PrometheusMetric[]): string {
  const lines: string[] = [];

  for (const m of metrics) {
    lines.push(`# HELP ${m.name} ${m.help}`);
    lines.push(`# TYPE ${m.name} ${m.type}`);

    if (m.type === "histogram" && m.buckets) {
      const labelStr = labelsToString(m.labels);
      const bucketSuffixes = [0.5, 0.9, 0.95, 0.99, 1.0];
      for (let i = 0; i < m.buckets.length; i++) {
        const le = bucketSuffixes[i] ?? 1.0;
        lines.push(`${m.name}_bucket{le="${le}"${labelStr}} ${m.buckets[i]}`);
      }
      lines.push(`${m.name}_bucket{le="+Inf"${labelStr}} ${m.value}`);
      lines.push(`${m.name}_sum${labelStr} ${m.value}`);
      lines.push(`${m.name}_count${labelStr} ${m.buckets[m.buckets.length - 1] ?? m.value}`);
    } else if (m.type === "summary" && m.quantiles) {
      const labelStr = labelsToString(m.labels);
      for (const q of m.quantiles) {
        lines.push(`${m.name}{quantile="${q}"${labelStr}} ${m.value * q}`);
      }
      lines.push(`${m.name}_sum${labelStr} ${m.value}`);
      lines.push(`${m.name}_count${labelStr} ${m.value}`);
    } else {
      const labelStr = labelsToString(m.labels);
      lines.push(`${m.name}${labelStr} ${m.value}`);
    }
  }

  return lines.join("\n");
}

function labelsToString(labels: Record<string, string>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(labels)) {
    parts.push(`${k}="${escapeLabelValue(v)}"`);
  }
  return parts.length > 0 ? `{${parts.join(",")}}` : "";
}

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/**
 * Get trace count gauge for a workspace.
 */
export async function getTraceCountGauge(
  sql: Sql,
  workspaceId: string,
): Promise<PrometheusMetric> {
  const [row] = await sql<{ count: string }>`
    SELECT COUNT(*)::text as count FROM traces.traces
    WHERE workspace_id = ${workspaceId}
  `;
  return {
    name: "traces_total",
    help: "Total number of traces in workspace",
    type: "counter",
    labels: { workspace_id: workspaceId },
    value: parseInt(row?.count ?? "0", 10),
  };
}

/**
 * Get error rate gauge for a workspace.
 */
export async function getErrorRateGauge(
  sql: Sql,
  workspaceId: string,
  since?: Date,
): Promise<PrometheusMetric> {
  const sinceDate = since ?? new Date(Date.now() - 7 * 86400000);
  const [row] = await sql<{ error_rate: string }>`
    SELECT
      COALESCE(
        COUNT(*) FILTER (WHERE status = 'error')::numeric /
        NULLIF(COUNT(*), 0) * 100, 0
      )::text as error_rate
    FROM traces.traces
    WHERE workspace_id = ${workspaceId}
      AND started_at >= ${sinceDate}
  `;
  return {
    name: "traces_error_rate_percent",
    help: "Error rate as percentage over the lookback window",
    type: "gauge",
    labels: { workspace_id: workspaceId },
    value: parseFloat(row?.error_rate ?? "0"),
  };
}

/**
 * Get latency histogram for traces.
 */
export async function getTraceLatencyHistogram(
  sql: Sql,
  workspaceId: string,
  since?: Date,
): Promise<PrometheusMetric> {
  const sinceDate = since ?? new Date(Date.now() - 7 * 86400000);
  const rows = await sql<{ bucket: string; count: string }[]>`
    SELECT
      WIDTH_BUCKET(total_duration_ms, 0, 60000, 20) as bucket,
      COUNT(*)::text as count
    FROM traces.traces
    WHERE workspace_id = ${workspaceId}
      AND started_at >= ${sinceDate}
      AND total_duration_ms IS NOT NULL
    GROUP BY 1
    ORDER BY 1
  `;

  const buckets = new Array(21).fill(0);
  for (const r of rows) {
    const idx = Math.max(0, Math.min(20, parseInt(r.bucket, 10)));
    buckets[idx] += parseInt(r.count, 10);
  }

  return {
    name: "traces_latency_ms",
    help: "Trace duration histogram in milliseconds",
    type: "histogram",
    labels: { workspace_id: workspaceId },
    value: buckets.reduce((a, b) => a + b, 0),
    buckets,
  };
}

/**
 * Get per-span-type counters and gauges.
 */
export async function getSpanTypeMetrics(
  sql: Sql,
  workspaceId: string,
  since?: Date,
): Promise<PrometheusMetric[]> {
  const sinceDate = since ?? new Date(Date.now() - 7 * 86400000);
  const rows = await sql<{
    span_type: string;
    count: string;
    errors: string;
    total_cost: string;
    total_tokens_in: string;
    total_tokens_out: string;
    avg_duration_ms: string;
    p95_duration_ms: string;
  }[]>`
    SELECT
      s.type AS span_type,
      COUNT(*)::text AS count,
      COUNT(*) FILTER (WHERE s.status = 'error')::text AS errors,
      COALESCE(SUM(COALESCE(s.cost_usd, 0)), 0)::text AS total_cost,
      COALESCE(SUM(COALESCE(s.tokens_in, 0)), 0)::text AS total_tokens_in,
      COALESCE(SUM(COALESCE(s.tokens_out, 0)), 0)::text AS total_tokens_out,
      COALESCE(AVG(s.duration_ms), 0)::text AS avg_duration_ms,
      COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY s.duration_ms), 0)::text AS p95_duration_ms
    FROM traces.spans s
    JOIN traces.traces t ON t.id = s.trace_id
    WHERE t.workspace_id = ${workspaceId}
      AND t.started_at >= ${sinceDate}
    GROUP BY 1
  `;

  return rows.map((r) => {
    const labels = { workspace_id: workspaceId, span_type: r.span_type };
    const count = parseInt(r.count, 10);
    const errors = parseInt(r.errors, 10);

    return [
      {
        name: "spans_total",
        help: `Total number of ${r.span_type} spans`,
        type: "counter" as const,
        labels,
        value: count,
      },
      {
        name: "spans_errors_total",
        help: `Total errors for ${r.span_type} spans`,
        type: "counter" as const,
        labels,
        value: errors,
      },
      {
        name: "spans_cost_usd_total",
        help: `Total cost for ${r.span_type} spans in USD`,
        type: "counter" as const,
        labels,
        value: parseFloat(r.total_cost),
      },
      {
        name: "spans_tokens_in_total",
        help: `Total input tokens for ${r.span_type} spans`,
        type: "counter" as const,
        labels,
        value: parseInt(r.total_tokens_in, 10),
      },
      {
        name: "spans_tokens_out_total",
        help: `Total output tokens for ${r.span_type} spans`,
        type: "counter" as const,
        labels,
        value: parseInt(r.total_tokens_out, 10),
      },
      {
        name: "spans_latency_ms_avg",
        help: `Average duration for ${r.span_type} spans in ms`,
        type: "gauge" as const,
        labels,
        value: Math.round(parseFloat(r.avg_duration_ms)),
      },
      {
        name: "spans_latency_ms_p95",
        help: `P95 duration for ${r.span_type} spans in ms`,
        type: "gauge" as const,
        labels,
        value: Math.round(parseFloat(r.p95_duration_ms)),
      },
    ];
  }).flat();
}

/**
 * Generate all Prometheus metrics for a workspace.
 */
export async function exportPrometheusMetrics(
  sql: Sql,
  workspaceId: string,
  since?: Date,
): Promise<PrometheusExport> {
  const [count, errorRate, latencyHist, spanMetrics] = await Promise.all([
    getTraceCountGauge(sql, workspaceId),
    getErrorRateGauge(sql, workspaceId, since),
    getTraceLatencyHistogram(sql, workspaceId, since),
    getSpanTypeMetrics(sql, workspaceId, since),
  ]);

  return {
    workspace_id: workspaceId,
    metrics: [count, errorRate, latencyHist, ...spanMetrics],
    generated_at: new Date(),
  };
}
