/**
 * @hasna/microservice-traces — LLM trace and span tracking library.
 *
 * Usage in your app:
 *   import { migrate, startTrace, startSpan, endSpan, endTrace } from '@hasna/microservice-traces'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   const trace = await startTrace(sql, { workspaceId: 'ws-1', name: 'chat' })
 *   const span = await startSpan(sql, { traceId: trace.id, name: 'llm-call', type: 'llm' })
 *   await endSpan(sql, span.id, { status: 'completed', tokens_in: 100, tokens_out: 50 })
 *   await endTrace(sql, trace.id, { status: 'completed' })
 */

export { migrate } from "../db/migrations.js";
export { getDb, closeDb } from "../db/client.js";

// Tracing
export {
  startTrace,
  endTrace,
  startSpan,
  endSpan,
  VALID_SPAN_TYPES,
  VALID_STATUSES,
  type Trace,
  type Span,
  type SpanType,
  type TraceStatus,
  type StartTraceInput,
  type EndTraceInput,
  type StartSpanInput,
  type EndSpanInput,
} from "./tracing.js";

// Query
export {
  getTrace,
  getTraceTree,
  buildSpanTree,
  listTraces,
  getSpan,
  listSpans,
  type TraceWithSpans,
  type SpanWithChildren,
  type TraceTree,
  type ListTracesOpts,
  type ListSpansOpts,
} from "./query.js";

// Stats
export {
  getTraceStats,
  computePercentile,
  computeErrorRate,
  type TraceStats,
  type SpanTypeStat,
} from "./stats.js";
