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

export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";
// Query
export {
  buildSpanTree,
  getSpan,
  getTrace,
  getTraceTree,
  type ListSpansOpts,
  type ListTracesOpts,
  listSpans,
  listTraces,
  type SpanWithChildren,
  type TraceTree,
  type TraceWithSpans,
} from "./query.js";
// Stats
export {
  computeErrorRate,
  computePercentile,
  getTraceStats,
  type SpanTypeStat,
  type TraceStats,
} from "./stats.js";
// Tracing
export {
  type EndSpanInput,
  type EndTraceInput,
  endSpan,
  endTrace,
  type Span,
  type SpanType,
  type StartSpanInput,
  type StartTraceInput,
  startSpan,
  startTrace,
  type Trace,
  type TraceStatus,
  VALID_SPAN_TYPES,
  VALID_STATUSES,
} from "./tracing.js";
