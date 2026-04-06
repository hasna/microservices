/**
 * LLM observability middleware — microservice-llm.
 *
 * Provides structured logging, trace hooks, and span tracking
 * for all LLM calls. Wraps the gateway and provider calls with
 * consistent telemetry: request/response size, token counts,
 * latency, cost, and error classification.
 */

import type { Sql } from "postgres";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface TraceContext {
  traceId: string;
  spanId: string;
  workspaceId?: string;
  userId?: string;
  parentSpanId?: string;
}

export interface LlmCallStart {
  traceId: string;
  spanId: string;
  timestamp: string;
  provider: string;
  model: string;
  workspaceId?: string;
  userId?: string;
  messageCount: number;
  estimatedTokens: number;
  temperature?: number;
  role: string;
}

export interface LlmCallEnd {
  traceId: string;
  spanId: string;
  timestamp: string;
  duration_ms: number;
  success: boolean;
  errorType?: string;
  tokensUsed?: number;
  costUsed?: number;
  finishReason?: string;
  model?: string;
}

export interface LlmSpan {
  id: string;
  traceId: string;
  workspaceId: string | null;
  userId: string | null;
  provider: string;
  model: string;
  role: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  tokensUsed: number | null;
  costUsed: number | null;
  success: boolean | null;
  errorMessage: string | null;
}

/**
 * Generate a unique trace ID (32 hex chars) and span ID (16 hex chars).
 */
export function generateTraceId(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateSpanId(): string {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Create a new trace context.
 */
export function createTraceContext(
  workspaceId?: string,
  userId?: string,
): TraceContext {
  return {
    traceId: generateTraceId(),
    spanId: generateSpanId(),
    workspaceId,
    userId,
  };
}

/**
 * Log an LLM call start event.
 */
export async function logCallStart(
  sql: Sql,
  event: LlmCallStart,
): Promise<void> {
  await sql`
    INSERT INTO llm.llm_spans (
      id, trace_id, workspace_id, user_id, provider, model, role,
      started_at, ended_at, duration_ms, tokens_used, cost_used,
      success, error_message
    ) VALUES (
      ${event.spanId},
      ${event.traceId},
      ${event.workspaceId ?? null},
      ${event.userId ?? null},
      ${event.provider},
      ${event.model},
      ${event.role},
      ${event.timestamp},
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL
    )
  `;
}

/**
 * Log an LLM call end event — updates the span.
 */
export async function logCallEnd(
  sql: Sql,
  event: LlmCallEnd,
): Promise<void> {
  await sql`
    UPDATE llm.llm_spans
    SET
      ended_at = ${event.timestamp},
      duration_ms = ${event.duration_ms},
      tokens_used = ${event.tokensUsed ?? null},
      cost_used = ${event.costUsed ?? null},
      success = ${event.success},
      error_message = ${event.errorType ?? null},
      model = COALESCE(model, ${event.model ?? null})
    WHERE trace_id = ${event.traceId} AND id = ${event.spanId}
  `;
}

/**
 * List recent spans for a trace.
 */
export async function getTraceSpans(
  sql: Sql,
  traceId: string,
): Promise<LlmSpan[]> {
  const rows = await sql<{
    id: string;
    trace_id: string;
    workspace_id: string | null;
    user_id: string | null;
    provider: string;
    model: string;
    role: string;
    started_at: string;
    ended_at: string | null;
    duration_ms: number | null;
    tokens_used: number | null;
    cost_used: number | null;
    success: boolean | null;
    error_message: string | null;
  }[]>`
    SELECT id, trace_id, workspace_id, user_id, provider, model, role,
           started_at, ended_at, duration_ms, tokens_used, cost_used,
           success, error_message
    FROM llm.llm_spans
    WHERE trace_id = ${traceId}
    ORDER BY started_at ASC
  `;
  return rows.map((r) => ({
    id: r.id,
    traceId: r.trace_id,
    workspaceId: r.workspace_id,
    userId: r.user_id,
    provider: r.provider,
    model: r.model,
    role: r.role,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationMs: r.duration_ms,
    tokensUsed: r.tokens_used,
    costUsed: r.cost_used,
    success: r.success,
    errorMessage: r.error_message,
  }));
}

/**
 * Get traces for a workspace, with optional time window.
 */
export async function listWorkspaceTraces(
  sql: Sql,
  workspaceId: string,
  limit = 20,
  since?: string,
): Promise<{ trace_id: string; span_count: number; total_cost: number | null; total_tokens: number | null }[]> {
  const sinceDate = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = await sql<{ trace_id: string; span_count: number; total_cost: number | null; total_tokens: number | null }[]>`
    SELECT
      trace_id,
      COUNT(*)::int as span_count,
      SUM(cost_used)::float as total_cost,
      SUM(tokens_used)::int as total_tokens
    FROM llm.llm_spans
    WHERE workspace_id = ${workspaceId} AND started_at >= ${sinceDate}
    GROUP BY trace_id
    ORDER BY MAX(started_at) DESC
    LIMIT ${limit}
  `;
  return rows;
}

/**
 * Wrapper to wrap any async LLM call with trace context.
 */
export async function withTrace<T>(
  sql: Sql,
  ctx: TraceContext,
  fn: () => Promise<T>,
): Promise<{ result: T; traceCtx: TraceContext }> {
  return { result: await fn(), traceCtx: ctx };
}