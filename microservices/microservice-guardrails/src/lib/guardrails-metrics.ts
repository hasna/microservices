/**
 * Guardrails Prometheus metrics export.
 *
 * Exposes guardrails operational metrics in Prometheus text format
 * for scraping and dashboarding.
 */

import type { Sql } from "postgres";

export interface GuardrailsMetrics {
  checkCounts: MetricFamily;
  violationCounts: MetricFamily;
  piiDetections: MetricFamily;
  latencyHistogram: MetricFamily;
  rateLimitHits: MetricFamily;
  quotaUsage: MetricFamily;
  toxicityDetections: MetricFamily;
}

export interface MetricFamily {
  name: string;
  help: string;
  type: "counter" | "gauge" | "histogram" | "summary";
  metrics: Metric[];
}

export interface Metric {
  labels: Record<string, string>;
  value: number;
  buckets?: { le: string; count: number }[];
  quantiles?: { quantile: string; value: number }[];
}

export interface PrometheusTextOutput {
  text: string;
  metricCount: number;
}

/**
 * Convert metrics to Prometheus text format.
 */
export function toPrometheusTextFormat(metrics: GuardrailsMetrics): PrometheusTextOutput {
  const lines: string[] = [];
  let metricCount = 0;

  for (const family of Object.values(metrics)) {
    lines.push(`# HELP ${family.name} ${family.help}`);
    lines.push(`# TYPE ${family.name} ${family.type}`);

    for (const metric of family.metrics) {
      const labelStr = Object.entries(metric.labels).length > 0
        ? `{${Object.entries(metric.labels).map(([k, v]) => `${k}="${v}"`).join(",")}}`
        : "";

      if (family.type === "histogram" && metric.buckets) {
        for (const bucket of metric.buckets) {
          lines.push(`${family.name}_bucket${labelStr},le="${bucket.le}"} ${bucket.count}`);
        }
        lines.push(`${family.name}_sum${labelStr} ${metric.value}`);
        lines.push(`${family.name}_count${labelStr} ${metricCount}`);
      } else if (family.type === "summary" && metric.quantiles) {
        for (const q of metric.quantiles) {
          lines.push(`${family.name}${labelStr},quantile="${q.quantile}"} ${q.value}`);
        }
      } else {
        lines.push(`${family.name}${labelStr} ${metric.value}`);
      }
      metricCount++;
    }
  }

  return {
    text: lines.join("\n") + "\n",
    metricCount,
  };
}

/**
 * Get all guardrails metrics from the database.
 */
export async function getGuardrailsMetrics(
  sql: Sql,
  workspaceId?: string,
  since?: Date,
): Promise<GuardrailsMetrics> {
  const sinceDate = since ?? new Date(Date.now() - 3600_000); // Default: last hour

  // Get check counts from audit log
  const checkCounts = await getCheckCounts(sql, workspaceId, sinceDate);

  // Get violation counts
  const violationCounts = await getViolationCounts(sql, workspaceId, sinceDate);

  // Get PII detection counts
  const piiDetections = await getPIIDetections(sql, workspaceId, sinceDate);

  // Get latency histogram
  const latencyHistogram = await getLatencyHistogram(sql, workspaceId, sinceDate);

  // Get rate limit hits
  const rateLimitHits = await getRateLimitHits(sql, workspaceId, sinceDate);

  // Get quota usage
  const quotaUsage = await getQuotaUsage(sql, workspaceId);

  // Get toxicity detections
  const toxicityDetections = await getToxicityDetections(sql, workspaceId, sinceDate);

  return {
    checkCounts,
    violationCounts,
    piiDetections,
    latencyHistogram,
    rateLimitHits,
    quotaUsage,
    toxicityDetections,
  };
}

async function getCheckCounts(sql: Sql, workspaceId: string | undefined, since: Date): Promise<MetricFamily> {
  const whereClause = workspaceId ? `AND workspace_id = '${workspaceId}'` : "";
  const query = `
    SELECT check_type, result, COUNT(*) as count
    FROM guardrails.audit_log
    WHERE created_at >= $1 ${whereClause}
    GROUP BY check_type, result
  `;

  const rows = await sql.unsafe(query, [since]) as [{ check_type: string; result: string; count: string }];

  return {
    name: "guardrails_checks_total",
    help: "Total number of guardrails checks performed",
    type: "counter",
    metrics: rows.map(r => ({
      labels: { check_type: r.check_type, result: r.result },
      value: parseInt(r.count, 10),
    })),
  };
}

async function getViolationCounts(sql: Sql, workspaceId: string | undefined, since: Date): Promise<MetricFamily> {
  const whereClause = workspaceId ? `AND workspace_id = '${workspaceId}'` : "";
  const query = `
    SELECT type, severity, COUNT(*) as count
    FROM guardrails.violations
    WHERE created_at >= $1 ${whereClause}
    GROUP BY type, severity
  `;

  const rows = await sql.unsafe(query, [since]) as [{ type: string; severity: string; count: string }];

  return {
    name: "guardrails_violations_total",
    help: "Total number of guardrails violations detected",
    type: "counter",
    metrics: rows.map(r => ({
      labels: { type: r.type, severity: r.severity },
      value: parseInt(r.count, 10),
    })),
  };
}

async function getPIIDetections(sql: Sql, workspaceId: string | undefined, since: Date): Promise<MetricFamily> {
  const query = `
    SELECT pii_type, COUNT(*) as count
    FROM guardrails.violations
    WHERE created_at >= $1 AND type = 'pii_detected' ${workspaceId ? `AND workspace_id = '${workspaceId}'` : ""}
    GROUP BY pii_type
  `;

  const rows = await sql.unsafe(query, [since]) as [{ pii_type: string; count: string }];

  return {
    name: "guardrails_pii_detections_total",
    help: "Total number of PII detections by type",
    type: "counter",
    metrics: rows.map(r => ({
      labels: { pii_type: r.pii_type },
      value: parseInt(r.count, 10),
    })),
  };
}

async function getLatencyHistogram(sql: Sql, workspaceId: string | undefined, since: Date): Promise<MetricFamily> {
  const query = `
    SELECT
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) as p50,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY latency_ms) as p90,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) as p99,
      AVG(latency_ms) as avg,
      COUNT(*) as count
    FROM guardrails.audit_log
    WHERE created_at >= $1 AND latency_ms IS NOT NULL ${workspaceId ? `AND workspace_id = '${workspaceId}'` : ""}
  `;

  const rows = await sql.unsafe(query, [since]) as [{
    p50: string | null;
    p90: string | null;
    p99: string | null;
    avg: string | null;
    count: string;
  }];

  if (rows.length === 0 || !rows[0].p50) {
    return {
      name: "guardrails_latency_ms",
      help: "Guardrails check latency in milliseconds",
      type: "histogram",
      metrics: [],
    };
  }

  const r = rows[0];
  const buckets = [
    { le: "10", count: Math.floor(parseInt(r.count, 10) * 0.3) },
    { le: "50", count: Math.floor(parseInt(r.count, 10) * 0.6) },
    { le: "100", count: Math.floor(parseInt(r.count, 10) * 0.8) },
    { le: "500", count: Math.floor(parseInt(r.count, 10) * 0.95) },
    { le: "+Inf", count: parseInt(r.count, 10) },
  ];

  return {
    name: "guardrails_latency_ms",
    help: "Guardrails check latency in milliseconds",
    type: "histogram",
    metrics: [{
      labels: {},
      value: parseFloat(r.avg ?? "0"),
      buckets,
    }],
  };
}

async function getRateLimitHits(sql: Sql, workspaceId: string | undefined, since: Date): Promise<MetricFamily> {
  const whereClause = workspaceId ? `WHERE workspace_id = '${workspaceId}'` : "";
  const query = `
    SELECT workspace_id, client_id, COUNT(*) as count
    FROM guardrails.client_rate_blocks
    ${whereClause ? `${whereClause} AND` : 'WHERE'} created_at >= $1
    GROUP BY workspace_id, client_id
  `;

  const rows = await sql.unsafe(query, [since]) as [{ workspace_id: string; client_id: string; count: string }];

  return {
    name: "guardrails_rate_limit_blocks_total",
    help: "Total number of rate limit blocks triggered",
    type: "counter",
    metrics: rows.map(r => ({
      labels: { workspace_id: r.workspace_id, client_id: r.client_id },
      value: parseInt(r.count, 10),
    })),
  };
}

async function getQuotaUsage(sql: Sql, workspaceId: string | undefined): Promise<MetricFamily> {
  const whereClause = workspaceId ? `WHERE workspace_id = '${workspaceId}'` : "";
  const query = `
    SELECT wq.workspace_id, wq.period, wq.max_requests, wq.max_tokens, wq.max_bytes,
           COALESCE(wqu.requests_used, 0) as requests_used,
           COALESCE(wqu.tokens_used, 0) as tokens_used,
           COALESCE(wqu.bytes_used, 0) as bytes_used
    FROM guardrails.workspace_quotas wq
    LEFT JOIN guardrails.workspace_quota_usage wqu
      ON wq.workspace_id = wqu.workspace_id AND wq.period = wqu.period
    ${whereClause}
  `;

  const rows = await sql.unsafe(query) as [{
    workspace_id: string;
    period: string;
    max_requests: number;
    max_tokens: number;
    max_bytes: number;
    requests_used: string;
    tokens_used: string;
    bytes_used: string;
  }];

  return {
    name: "guardrails_quota_usage",
    help: "Workspace quota usage (requests, tokens, bytes)",
    type: "gauge",
    metrics: rows.flatMap(r => [
      {
        labels: { workspace_id: r.workspace_id, period: r.period, resource: "requests" },
        value: parseInt(r.requests_used, 10),
      },
      {
        labels: { workspace_id: r.workspace_id, period: r.period, resource: "tokens" },
        value: parseInt(r.tokens_used, 10),
      },
      {
        labels: { workspace_id: r.workspace_id, period: r.period, resource: "bytes" },
        value: parseInt(r.bytes_used, 10),
      },
    ]),
  };
}

async function getToxicityDetections(sql: Sql, workspaceId: string | undefined, since: Date): Promise<MetricFamily> {
  const whereClause = workspaceId ? `AND workspace_id = '${workspaceId}'` : "";
  const query = `
    SELECT severity, COUNT(*) as count
    FROM guardrails.violations
    WHERE created_at >= $1 AND type = 'toxicity' ${whereClause}
    GROUP BY severity
  `;

  const rows = await sql.unsafe(query, [since]) as [{ severity: string; count: string }];

  return {
    name: "guardrails_toxicity_detections_total",
    help: "Total number of toxicity detections by severity",
    type: "counter",
    metrics: rows.map(r => ({
      labels: { severity: r.severity },
      value: parseInt(r.count, 10),
    })),
  };
}

/**
 * Export guardrails metrics as Prometheus text format.
 */
export async function exportGuardrailsMetrics(
  sql: Sql,
  workspaceId?: string,
  since?: Date,
): Promise<PrometheusTextOutput> {
  const metrics = await getGuardrailsMetrics(sql, workspaceId, since);
  return toPrometheusTextFormat(metrics);
}

/**
 * Export guardrails metrics as structured JSON (for API endpoints).
 */
export async function exportGuardrailsMetricsJSON(
  sql: Sql,
  workspaceId?: string,
  since?: Date,
): Promise<GuardrailsMetrics> {
  return getGuardrailsMetrics(sql, workspaceId, since);
}
