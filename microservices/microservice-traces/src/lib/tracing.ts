/**
 * Core tracing operations — start/end traces and spans.
 */

import type { Sql } from "postgres";

export interface Trace {
  id: string;
  workspace_id: string;
  name: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  total_tokens: number;
  total_cost_usd: number;
  total_duration_ms: number | null;
  span_count: number;
  metadata: any;
  started_at: Date;
  ended_at: Date | null;
}

export interface Span {
  id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  type: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  metadata: any;
  started_at: Date;
  ended_at: Date | null;
}

export const VALID_SPAN_TYPES = [
  "llm",
  "tool",
  "retrieval",
  "guardrail",
  "embedding",
  "custom",
] as const;
export type SpanType = (typeof VALID_SPAN_TYPES)[number];

export const VALID_STATUSES = ["running", "completed", "error"] as const;
export type TraceStatus = (typeof VALID_STATUSES)[number];

export interface StartTraceInput {
  workspaceId: string;
  name: string;
  input?: unknown;
  metadata?: any;
}

export interface EndTraceInput {
  status: TraceStatus;
  output?: unknown;
  error?: string;
}

export interface StartSpanInput {
  traceId: string;
  parentSpanId?: string;
  name: string;
  type: SpanType;
  input?: unknown;
  model?: string;
  metadata?: any;
}

export interface EndSpanInput {
  status: TraceStatus;
  output?: unknown;
  error?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
}

export async function startTrace(
  sql: Sql,
  input: StartTraceInput,
): Promise<Trace> {
  const [trace] = await sql<Trace[]>`
    INSERT INTO traces.traces (workspace_id, name, input, metadata)
    VALUES (${input.workspaceId}, ${input.name}, ${JSON.stringify(input.input ?? null)}, ${JSON.stringify(input.metadata ?? {})})
    RETURNING *
  `;
  return trace;
}

export async function endTrace(
  sql: Sql,
  traceId: string,
  input: EndTraceInput,
): Promise<Trace> {
  // Compute totals from child spans
  const [totals] = await sql<
    [{ total_tokens: string; total_cost: string; count: string }]
  >`
    SELECT
      COALESCE(SUM(COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)), 0) as total_tokens,
      COALESCE(SUM(COALESCE(cost_usd, 0)), 0) as total_cost,
      COUNT(*) as count
    FROM traces.spans
    WHERE trace_id = ${traceId}
  `;

  // Get the trace to compute duration
  const [existing] = await sql<
    Trace[]
  >`SELECT * FROM traces.traces WHERE id = ${traceId}`;
  if (!existing) throw new Error(`Trace ${traceId} not found`);

  const now = new Date();
  const totalDurationMs =
    now.getTime() - new Date(existing.started_at).getTime();

  const [trace] = await sql<Trace[]>`
    UPDATE traces.traces SET
      status = ${input.status},
      output = ${JSON.stringify(input.output ?? null)},
      error = ${input.error ?? null},
      total_tokens = ${parseInt(totals.total_tokens, 10)},
      total_cost_usd = ${parseFloat(totals.total_cost)},
      total_duration_ms = ${totalDurationMs},
      span_count = ${parseInt(totals.count, 10)},
      ended_at = ${now}
    WHERE id = ${traceId}
    RETURNING *
  `;
  return trace;
}

export async function startSpan(
  sql: Sql,
  input: StartSpanInput,
): Promise<Span> {
  const [span] = await sql<Span[]>`
    INSERT INTO traces.spans (trace_id, parent_span_id, name, type, input, model, metadata)
    VALUES (
      ${input.traceId},
      ${input.parentSpanId ?? null},
      ${input.name},
      ${input.type},
      ${JSON.stringify(input.input ?? null)},
      ${input.model ?? null},
      ${JSON.stringify(input.metadata ?? {})}
    )
    RETURNING *
  `;
  return span;
}

export async function endSpan(
  sql: Sql,
  spanId: string,
  input: EndSpanInput,
): Promise<Span> {
  // Get the span to compute duration
  const [existing] = await sql<
    Span[]
  >`SELECT * FROM traces.spans WHERE id = ${spanId}`;
  if (!existing) throw new Error(`Span ${spanId} not found`);

  const now = new Date();
  const durationMs = now.getTime() - new Date(existing.started_at).getTime();

  const [span] = await sql<Span[]>`
    UPDATE traces.spans SET
      status = ${input.status},
      output = ${JSON.stringify(input.output ?? null)},
      error = ${input.error ?? null},
      tokens_in = ${input.tokens_in ?? null},
      tokens_out = ${input.tokens_out ?? null},
      cost_usd = ${input.cost_usd ?? null},
      duration_ms = ${durationMs},
      ended_at = ${now}
    WHERE id = ${spanId}
    RETURNING *
  `;

  // Increment trace span_count is handled at endTrace, no need here
  return span;
}
