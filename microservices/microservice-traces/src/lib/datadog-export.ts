/**
 * Datadog APM trace export — produces traces in Datadog APM intake format.
 *
 * Datadog expects a specific JSON payload for the trace intake API.
 * Each span becomes a Datadog span with resource, service, name, and meta.
 */

import type { Sql } from "postgres";
import { buildSpanTree } from "./query.js";
import type { TraceWithSpans } from "./query.js";

/**
 * Datadog span priority values
 */
export type DatadogSpanPriority = -1 | 0 | 1 | 2;

/**
 * Datadog span type (maps from our internal span types)
 */
const SPAN_TYPE_MAP: Record<string, string> = {
  llm: "llm",
  tool: "custom",
  retrieval: "web",
  guardrail: "custom",
  embedding: "llm",
  custom: "custom",
};

/**
 * Datadog span payload
 */
export interface DatadogSpan {
  trace_id: string;
  span_id: string;
  parent_id: string | null;
  name: string;
  resource: string;
  service: string;
  type: string;
  start: number;          // nanoseconds since epoch
  duration: number;       // nanoseconds
  error: number;          // 0 or 1
  meta: Record<string, string>;
  metrics: Record<string, number>;
}

/**
 * Datadog trace payload (list of spans with metadata)
 */
export interface DatadogTracePayload {
  traces: DatadogSpan[][];
  metadata: {
    env: string;
    version: string;
    runtime_ids: string[];
  };
}

/**
 * Convert a single internal span to Datadog format.
 */
function toDatadogSpan(
  span: any,
  traceId: string,
  serviceName = "hasna-agent",
): DatadogSpan {
  const startNs = new Date(span.started_at).getTime() * 1_000_000;
  const endNs = span.ended_at
    ? new Date(span.ended_at).getTime() * 1_000_000
    : startNs;
  const durationNs = Math.max(0, endNs - startNs);

  const meta: Record<string, string> = {
    "span.type": span.type,
    "span.status": span.status,
  };
  if (span.model) meta["llm.model"] = span.model;
  if (span.error) meta["error.msg"] = span.error;
  if (span.name) meta["span.name"] = span.name;

  const metrics: Record<string, number> = {};
  if (span.duration_ms) metrics["span.duration"] = span.duration_ms;
  if (span.tokens_in != null) metrics["llm.tokens.in"] = span.tokens_in;
  if (span.tokens_out != null) metrics["llm.tokens.out"] = span.tokens_out;
  if (span.cost_usd != null) metrics["llm.cost.usd"] = parseFloat(String(span.cost_usd));

  return {
    trace_id: traceId.replace(/-/g, ""),
    span_id: span.id.replace(/-/g, ""),
    parent_id: span.parent_span_id ? span.parent_span_id.replace(/-/g, "") : null,
    name: span.name,
    resource: span.name,
    service: serviceName,
    type: SPAN_TYPE_MAP[span.type] ?? "custom",
    start: startNs,
    duration: durationNs,
    error: span.status === "error" ? 1 : 0,
    meta,
    metrics,
  };
}

/**
 * Export a single trace as Datadog APM spans.
 */
export function exportTraceAsDatadog(
  trace: TraceWithSpans,
  opts: { serviceName?: string; priority?: DatadogSpanPriority } = {},
): DatadogSpan[] {
  const { serviceName = "hasna-agent", priority = 1 } = opts;
  const traceId = trace.id;
  const spans = buildSpanTree(trace.spans);

  // Flatten tree
  function flatten(nodes: any[], result: any[] = []): any[] {
    for (const node of nodes) {
      result.push(node);
      if (node.children) flatten(node.children, result);
    }
    return result;
  }

  const flatSpans = flatten(spans);
  void priority; // would be set on trace-level metadata in real intake

  return flatSpans.map((s) => toDatadogSpan(s, traceId, serviceName));
}

/**
 * Export multiple traces as a combined Datadog payload.
 */
export function exportTracesAsDatadogPayload(
  traces: TraceWithSpans[],
  opts: { serviceName?: string; env?: string; version?: string } = {},
): DatadogTracePayload {
  const { serviceName = "hasna-agent", env = "production", version = "0.0.1" } = opts;
  const tracesSpans = traces.map((t) => exportTraceAsDatadog(t, { serviceName }));

  return {
    traces: tracesSpans,
    metadata: {
      env,
      version,
      runtime_ids: [],
    },
  };
}

/**
 * Get Datadog APM-compatible stats for a workspace (used for APM intake v2).
 */
export async function getDatadogStatsForWorkspace(
  sql: Sql,
  workspaceId: string,
  since?: Date,
): Promise<{
  trace_count: number;
  error_count: number;
  total_cost_usd: number;
  total_tokens_in: number;
  total_tokens_out: number;
  avg_duration_ms: number;
}> {
  const sinceDate = since ?? new Date(Date.now() - 7 * 86400000);

  const [row] = await sql<{
    trace_count: string;
    error_count: string;
    total_cost: string;
    total_tokens_in: string;
    total_tokens_out: string;
    avg_duration: string;
  }>`
    SELECT
      COUNT(*)::text AS trace_count,
      COUNT(*) FILTER (WHERE status = 'error')::text AS error_count,
      COALESCE(SUM(COALESCE(total_cost_usd, 0)), 0)::text AS total_cost,
      COALESCE(SUM(COALESCE(total_tokens, 0)), 0)::text AS total_tokens_in,
      0::text AS total_tokens_out,
      COALESCE(AVG(total_duration_ms), 0)::text AS avg_duration
    FROM traces.traces
    WHERE workspace_id = ${workspaceId}
      AND started_at >= ${sinceDate}
  `;

  return {
    trace_count: parseInt(row?.trace_count ?? "0", 10),
    error_count: parseInt(row?.error_count ?? "0", 10),
    total_cost_usd: parseFloat(row?.total_cost ?? "0"),
    total_tokens_in: parseInt(row?.total_tokens_in ?? "0", 10),
    total_tokens_out: parseInt(row?.total_tokens_out ?? "0", 10),
    avg_duration_ms: Math.round(parseFloat(row?.avg_duration ?? "0")),
  };
}
