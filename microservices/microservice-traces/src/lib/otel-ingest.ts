/**
 * OpenTelemetry (OTLP) trace ingestion — accepts traces in OTel format
 * and stores them in our trace database. This enables external services
 * using OTel SDK to submit traces without needing our native SDK.
 */

import type { Sql } from "postgres";
import type { OTelExport, OTelSpan } from "./export.js";

export interface OtelIngestResult {
  traces_created: number;
  spans_created: number;
  errors: string[];
}

/**
 * Map OTel span kind to our span type
 */
function otelKindToSpanType(kind: string): string {
  switch (kind) {
    case "SPAN_KIND_SERVER": return "custom";
    case "SPAN_KIND_CLIENT": return "tool";
    case "SPAN_KIND_PRODUCER": return "custom";
    case "SPAN_KIND_CONSUMER": return "custom";
    default: return "custom";
  }
}

/**
 * Map OTel status code to our status
 */
function otelStatusToStatus(code: number): "completed" | "error" {
  return code === 2 ? "error" : "completed";
}

/**
 * Convert OTel timestamp (unix nano) to Date
 */
function otelTimeToDate(nano: string): Date {
  return new Date(Math.floor(Number(nano) / 1_000_000));
}

/**
 * Extract attributes as a plain object
 */
function extractAttributes(
  attrs: { key: string; value: { stringValue?: string; intValue?: string; doubleValue?: string; boolValue?: boolean } }[],
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const attr of attrs) {
    if (attr.value.stringValue !== undefined) result[attr.key] = attr.value.stringValue;
    else if (attr.value.intValue !== undefined) result[attr.key] = Number(attr.value.intValue);
    else if (attr.value.doubleValue !== undefined) result[attr.key] = Number(attr.value.doubleValue);
    else if (attr.value.boolValue !== undefined) result[attr.key] = attr.value.boolValue;
  }
  return result;
}

/**
 * Ingest traces from OTel JSON format.
 * Returns the number of traces/spans created and any errors encountered.
 */
export async function ingestOtelTraces(
  sql: Sql,
  workspaceId: string,
  otelData: OTelExport,
): Promise<OtelIngestResult> {
  const result: OtelIngestResult = {
    traces_created: 0,
    spans_created: 0,
    errors: [],
  };

  for (const resourceSpan of otelData.resourceSpans) {
    // Extract workspace_id from resource attributes, fallback to parameter
    const resourceAttrs = extractAttributes(resourceSpan.resource?.attributes ?? []);
    const effectiveWorkspaceId = String(resourceAttrs["workspace.id"] ?? workspaceId);

    for (const scopeSpan of resourceSpan.scopeSpans) {
      for (const otelSpan of scopeSpan.spans) {
        try {
          // Convert OTel span to our format
          const traceId = otelSpan.traceId;
          const spanId = otelSpan.spanId || crypto.randomUUID();
          const parentSpanId = otelSpan.parentSpanId || null;

          const startedAt = otelTimeToDate(otelSpan.startTimeUnixNano);
          const endedAt = otelTimeToDate(otelSpan.endTimeUnixNano);
          const durationMs = endedAt.getTime() - startedAt.getTime();

          const spanType = otelKindToSpanType(otelSpan.kind);
          const status = otelStatusToStatus(otelSpan.status?.code ?? 1);
          const attributes = extractAttributes(otelSpan.attributes ?? []);

          // Extract model from attributes (common for LLM spans)
          const model = attributes["llm.model"] as string | undefined
            ?? attributes["model"] as string | undefined
            ?? null;

          // Extract tokens from attributes
          const tokensIn = attributes["tokens.in"] as number | undefined
            ?? attributes["llm.tokens_in"] as number | undefined
            ?? null;
          const tokensOut = attributes["tokens.out"] as number | undefined
            ?? attributes["llm.tokens_out"] as number | undefined
            ?? null;

          // Extract cost from attributes
          const costUsd = attributes["cost.usd"] as number | undefined
            ?? attributes["llm.cost"] as number | undefined
            ?? null;

          // Get or create trace
          let [trace] = await sql<[{ id: string }]>`
            SELECT id FROM traces.traces WHERE id = ${traceId}
          `;

          if (!trace) {
            // Create trace
            [trace] = await sql<[{ id: string }]>`
              INSERT INTO traces.traces (id, workspace_id, name, status, metadata)
              VALUES (
                ${traceId},
                ${effectiveWorkspaceId},
                ${otelSpan.name},
                ${status},
                ${JSON.stringify({ source: "otel", scope: scopeSpan.scope?.name })}
              )
              RETURNING id
            `;
            result.traces_created++;
          }

          // Create span
          await sql`
            INSERT INTO traces.spans (
              id, trace_id, parent_span_id, name, type, status,
              started_at, ended_at, duration_ms,
              model, tokens_in, tokens_out, cost_usd,
              metadata
            ) VALUES (
              ${spanId},
              ${traceId},
              ${parentSpanId},
              ${otelSpan.name},
              ${spanType},
              ${status},
              ${startedAt},
              ${endedAt},
              ${durationMs},
              ${model},
              ${tokensIn},
              ${tokensOut},
              ${costUsd},
              ${JSON.stringify({ attributes, scope: scopeSpan.scope?.name })}
            )
            ON CONFLICT (id) DO NOTHING
          `;
          result.spans_created++;
        } catch (err) {
          result.errors.push(`Span error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  return result;
}
