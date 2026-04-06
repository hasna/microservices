/**
 * Trace export utilities — converts internal traces to standard formats.
 * Currently supports OpenTelemetry JSON (OTLP / Zipkin-compatible).
 */

import type { Sql } from "postgres";
import { buildSpanTree } from "./query.js";
import type { TraceWithSpans } from "./query.js";

/**
 * OpenTelemetry span kinds
 */
export type OTelSpanKind =
  | "SPAN_KIND_INTERNAL"
  | "SPAN_KIND_SERVER"
  | "SPAN_KIND_CLIENT"
  | "SPAN_KIND_PRODUCER"
  | "SPAN_KIND_CONSUMER";

/**
 * OpenTelemetry resource span (one per trace)
 */
export interface OTelResourceSpan {
  resource: {
    attributes: { key: string; value: { stringValue: string } }[];
  };
  scopeSpans: {
    scope: { name: string; version: string };
    spans: OTelSpan[];
  }[];
}

/**
 * OpenTelemetry span
 */
export interface OTelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: OTelSpanKind;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: { key: string; value: { stringValue: string } | { intValue: string } | { doubleValue: string } | { boolValue: boolean } }[];
  status: { code: 0 | 1 | 2; message?: string };
}

/**
 * OpenTelemetry export document
 */
export interface OTelExport {
  resourceSpans: OTelResourceSpan[];
}

/**
 * Convert internal span type to OpenTelemetry kind
 */
function spanTypeToKind(
  type: string,
): OTelSpanKind {
  switch (type) {
    case "llm": return "SPAN_KIND_INTERNAL";
    case "tool": return "SPAN_KIND_CLIENT";
    case "retrieval": return "SPAN_KIND_CLIENT";
    case "guardrail": return "SPAN_KIND_INTERNAL";
    case "embedding": return "SPAN_KIND_INTERNAL";
    default: return "SPAN_KIND_INTERNAL";
  }
}

/**
 * Convert a timestamp to Unix nanoseconds
 */
function toUnixNano(ts: string | Date): string {
  const ms = new Date(ts).getTime();
  return String(ms * 1_000_000);
}

/**
 * Convert an internal span to OTel format
 */
function toOTelSpan(span: any, traceId: string): OTelSpan {
  const attrs: OTelSpan["attributes"] = [
    { key: "span.type", value: { stringValue: span.type } },
    { key: "span.status", value: { stringValue: span.status } },
  ];
  if (span.model) attrs.push({ key: "llm.model", value: { stringValue: span.model } });
  if (span.tokens_in != null) attrs.push({ key: "tokens.in", value: { intValue: String(span.tokens_in) } });
  if (span.tokens_out != null) attrs.push({ key: "tokens.out", value: { intValue: String(span.tokens_out) } });
  if (span.cost_usd != null) attrs.push({ key: "cost.usd", value: { doubleValue: Number(span.cost_usd) } });
  if (span.error) attrs.push({ key: "error.message", value: { stringValue: span.error } });
  if (span.tags && span.tags.length > 0) {
    attrs.push({ key: "trace.tags", value: { stringValue: span.tags.join(",") } });
  }

  return {
    traceId,
    spanId: span.id.replace(/-/g, ""),
    parentSpanId: span.parent_span_id ? span.parent_span_id.replace(/-/g, "") : undefined,
    name: span.name,
    kind: spanTypeToKind(span.type),
    startTimeUnixNano: toUnixNano(span.started_at),
    endTimeUnixNano: span.ended_at ? toUnixNano(span.ended_at) : toUnixNano(span.started_at),
    attributes: attrs,
    status: span.status === "error"
      ? { code: 2 as const, message: span.error ?? "error" }
      : span.status === "completed"
        ? { code: 1 as const }
        : { code: 0 as const },
  };
}

/**
 * Export a single trace as OpenTelemetry JSON.
 */
export function exportTraceAsOTel(trace: TraceWithSpans): OTelExport {
  const traceId = trace.id.replace(/-/g, "");
  const spans = buildSpanTree(trace.spans);

  // Flatten tree back to spans list with depth info
  function flattenTree(nodes: any[], depth = 0): any[] {
    const result: any[] = [];
    for (const node of nodes) {
      result.push({ ...node, depth });
      if (node.children) result.push(...flattenTree(node.children, depth + 1));
    }
    return result;
  }

  const flatSpans = flattenTree(spans);

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "hasna-agent" } },
            { key: "workspace.id", value: { stringValue: trace.workspace_id } },
            ...(trace.user_id ? [{ key: "user.id", value: { stringValue: trace.user_id } }] : []),
          ],
        },
        scopeSpans: [
          {
            scope: { name: "hasna/microservice-traces", version: "0.0.1" },
            spans: flatSpans.map((s) => toOTelSpan(s, traceId)),
          },
        ],
      },
    ],
  };
}

/**
 * Export multiple traces as a combined OpenTelemetry batch.
 */
export function exportTracesAsOTel(traces: TraceWithSpans[]): OTelExport {
  return {
    resourceSpans: traces.map((t) => exportTraceAsOTel(t).resourceSpans[0]),
  };
}

/**
 * Export a trace as Zipkin JSON (v2)
 */
export interface ZipkinSpan {
  id: string;
  traceId: string;
  parentId?: string;
  name: string;
  kind: "CLIENT" | "SERVER" | "PRODUCER" | "CONSUMER" | "UNLOCALIZED";
  timestamp: number;
  duration: number;
  localEndpoint?: { serviceName: string; ipv4: string; port: number };
  remoteEndpoint?: { serviceName: string; ipv4: string; port: number };
  tags: Record<string, string>;
  debug: boolean;
}

export interface ZipkinExport {
  traces: ZipkinSpan[][];
}

export function exportTraceAsZipkin(trace: TraceWithSpans): ZipkinSpan[] {
  const traceId = trace.id.replace(/-/g, "");
  const spans = buildSpanTree(trace.spans);

  function flatten(nodes: any[]): any[] {
    const result: any[] = [];
    for (const node of nodes) {
      result.push(node);
      if (node.children) result.push(...flatten(node.children));
    }
    return result;
  }

  return flatten(spans).map((span) => {
    const startMs = new Date(span.started_at).getTime() * 1000;
    const endMs = span.ended_at ? new Date(span.ended_at).getTime() * 1000 : startMs;
    return {
      id: span.id.replace(/-/g, ""),
      traceId,
      parentId: span.parent_span_id ? span.parent_span_id.replace(/-/g, "") : undefined,
      name: span.name,
      kind: span.type === "llm" ? "CLIENT" : "CLIENT",
      timestamp: startMs,
      duration: Math.max(0, endMs - startMs),
      localEndpoint: { serviceName: "hasna-agent", ipv4: "", port: 0 },
      tags: {
        "span.type": span.type,
        "span.status": span.status,
        ...(span.model ? { "llm.model": span.model } : {}),
        ...(span.tokens_in != null ? { "tokens.in": String(span.tokens_in) } : {}),
        ...(span.tokens_out != null ? { "tokens.out": String(span.tokens_out) } : {}),
        ...(span.error ? { "error": span.error } : {}),
      },
      debug: false,
    };
  });
}

// ---------------------------------------------------------------------------
// Jaeger trace format types
// ---------------------------------------------------------------------------

export interface JaegerSpan {
  traceId: string;
  spanID: string;
  parentSpanID: string;
  operationName: string;
  flags: number;
  startTime: number;
  duration: number;
  tags: { key: string; vStr?: string; vInt64?: number; vFloat64?: number; vBool?: boolean }[];
  logs: { timestamp: number; fields: { key: string; vStr?: string }[] }[];
  references?: { refType: string; traceID: string; spanID: string }[];
}

export interface JaegerProcess {
  serviceName: string;
  tags?: { key: string; value: string }[];
}

export interface JaegerTrace {
  traceID: string;
  spanCount: number;
  process: JaegerProcess;
  spans: JaegerSpan[];
}

function spanToJaegerSpan(span: any, traceId: string): JaegerSpan {
  const startUs = new Date(span.started_at).getTime() * 1000;
  const endUs = span.ended_at
    ? new Date(span.ended_at).getTime() * 1000
    : startUs;

  const tags: JaegerSpan["tags"] = [
    { key: "span.type", vStr: span.type },
    { key: "span.status", vStr: span.status },
  ];
  if (span.model) tags.push({ key: "llm.model", vStr: span.model });
  if (span.tokens_in != null) tags.push({ key: "tokens.in", vInt64: span.tokens_in });
  if (span.tokens_out != null) tags.push({ key: "tokens.out", vInt64: span.tokens_out });
  if (span.cost_usd != null) tags.push({ key: "cost.usd", vFloat64: Number(span.cost_usd) });
  if (span.error) tags.push({ key: "error", vStr: span.error });

  const logs: JaegerSpan["logs"] = [];
  if (span.error) {
    logs.push({
      timestamp: startUs,
      fields: [{ key: "error", vStr: span.error }],
    });
  }

  return {
    traceId: traceId.replace(/-/g, ""),
    spanID: span.id.replace(/-/g, ""),
    parentSpanID: span.parent_span_id ? span.parent_span_id.replace(/-/g, "") : "",
    operationName: span.name,
    flags: span.status === "error" ? 1 : 0,
    startTime: startUs,
    duration: Math.max(0, endUs - startUs),
    tags,
    logs,
  };
}

/**
 * Export a trace as Jaeger JSON format.
 */
export function exportTraceAsJaeger(trace: TraceWithSpans): JaegerTrace {
  const traceId = trace.id.replace(/-/g, "");
  const spans = buildSpanTree(trace.spans);

  function flatten(nodes: any[]): any[] {
    const result: any[] = [];
    for (const node of nodes) {
      result.push(node);
      if (node.children) result.push(...flatten(node.children));
    }
    return result;
  }

  const flatSpans = flatten(spans);

  return {
    traceID: traceId,
    spanCount: flatSpans.length,
    process: {
      serviceName: "hasna-agent",
      tags: [
        { key: "workspace.id", value: trace.workspace_id },
        ...(trace.user_id ? [{ key: "user.id", value: String(trace.user_id) }] : []),
      ],
    },
    spans: flatSpans.map((s) => spanToJaegerSpan(s, traceId)),
  };
}

// ---------------------------------------------------------------------------
// SQL-backed export functions (fetch trace by ID)
// ---------------------------------------------------------------------------

/**
 * Export a single trace as OTLP JSON by fetching from the database.
 */
export async function export_trace_otlp(
  sql: Sql,
  traceId: string,
): Promise<OTelExport | null> {
  const { getTrace } = await import("./query.js");
  const trace = await getTrace(sql, traceId);
  if (!trace) return null;
  return exportTraceAsOTel(trace);
}

/**
 * Export a single trace as Jaeger JSON by fetching from the database.
 */
export async function export_traces_jaeger(
  sql: Sql,
  traceId: string,
): Promise<JaegerTrace | null> {
  const { getTrace } = await import("./query.js");
  const trace = await getTrace(sql, traceId);
  if (!trace) return null;
  return exportTraceAsJaeger(trace);
}

/**
 * Export a single trace as Zipkin JSON v2 by fetching from the database.
 */
export async function export_traces_zipkin(
  sql: Sql,
  traceId: string,
): Promise<{ traces: ZipkinSpan[] } | null> {
  const { getTrace } = await import("./query.js");
  const trace = await getTrace(sql, traceId);
  if (!trace) return null;
  return { traces: exportTraceAsZipkin(trace) };
}
