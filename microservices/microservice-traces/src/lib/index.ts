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
// Analytics
export {
  getCostBreakdown,
  getLatencyHistogram,
  getSpanAnalytics,
  getWorkspaceAnalytics,
  upsertSpanAnalytics,
  get_span_analytics,
  get_slowest_spans,
  get_error_spans,
  getSpanLatencyTrend,
  compareLatencyBetweenPeriods,
  type CostBreakdown,
  type SpanTypeBreakdown,
  type WorkspaceAnalytics,
  type OperationAnalytics,
  type SlowestSpan,
  type ErrorSpan,
  type LatencyTrendPoint,
  type LatencyPeriodComparison,
} from "./analytics.js";
// Export
export {
  exportTraceAsOTel,
  exportTraceAsZipkin,
  exportTraceAsJaeger,
  exportTracesAsOTel,
  export_trace_otlp,
  export_traces_jaeger,
  export_traces_zipkin,
  type OTelExport,
  type OTelSpan,
  type ZipkinExport,
  type ZipkinSpan,
  type JaegerTrace,
  type JaegerSpan,
} from "./export.js";
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
// Compare
export {
  compare_traces,
  get_trace_timeline,
  getTraceDiffSummary,
  type TraceDiff,
  type TraceTimeline,
  type TraceTimelineSpan,
  type TraceDiffSpan,
  type TraceDiffSummary,
} from "./compare.js";
// Tags
export {
  add_span_tag,
  add_span_annotation,
  get_span_tags,
  get_span_annotations,
  delete_span_tag,
  type SpanTag,
  type SpanAnnotation,
} from "./tags.js";
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
// Sampling
export {
  type SamplingPolicy,
  type SamplingType,
  upsertSamplingPolicy,
  listSamplingPolicies,
  deleteSamplingPolicy,
  shouldSample,
  shouldKeepTrace,
} from "./sampling.js";
// Correlation
export {
  type TraceCorrelation,
  linkTrace,
  getTracesBySession,
  getTracesByUser,
  getTraceByExternalRequestId,
  getCorrelation,
  getTracesByExternalTraceId,
} from "./correlation.js";
// Retention
export {
  type RetentionPolicy,
  type RetentionType,
  upsertRetentionPolicy,
  listRetentionPolicies,
  deleteRetentionPolicy,
  pruneByTTL,
  pruneByCount,
  runRetentionPolicies,
  getRetentionStats,
} from "./retention.js";
// Sampling analytics
export {
  recordSamplingDecision,
  getSamplingStats,
  listSamplingDecisions,
  evaluateSampling,
  bulkEvaluateSampling,
  getOverallSamplingRate,
  type SamplingDecision,
  type SamplingPolicyStats,
  type BulkSamplingResult,
} from "./sampling-analytics.js";
// Trace analytics
export {
  getTraceLatencyPercentiles,
  getErrorRateTimeline,
  getTraceDurationHistogram,
  buildFlameGraph,
  buildTraceFlameGraph,
  getTraceTimeSeries,
  type LatencyPercentile,
  type ErrorRatePoint,
  type FlameGraphNode,
  type TraceFlameGraph,
  type LatencyBreakdown,
  type TraceTimeSeriesPoint,
} from "./trace-analytics.js";
// Grafana dashboard
export {
  generateGrafanaDashboard,
  type GrafanaDashboard,
  type GrafanaPanel,
} from "./grafana-dashboard.js";
// Prometheus / OpenMetrics export
export {
  toPrometheusTextFormat,
  getTraceCountGauge,
  getErrorRateGauge,
  getTraceLatencyHistogram,
  getSpanTypeMetrics,
  exportPrometheusMetrics,
  type PrometheusMetric,
  type PrometheusExport,
  type PrometheusMetricType,
} from "./prometheus-export.js";
// Datadog APM export
export {
  exportTraceAsDatadog,
  exportTracesAsDatadogPayload,
  getDatadogStatsForWorkspace,
  type DatadogSpan,
  type DatadogTracePayload,
  type DatadogSpanPriority,
} from "./datadog-export.js";
// Span anomaly detection
export {
  refreshAnomalyBaseline,
  refreshAllBaselines,
  getSpanTypeBaseline,
  detectSpanAnomalies,
  getAnomalySummary,
  type SpanAnomaly,
  type AnomalyBaseline,
  type AnomalyType,
} from "./span-anomaly.js";
// Span dependency matrix — caller/callee analysis
export {
  getSpanDependencyMatrix,
  getHotPaths,
  getCriticalPath,
  type SpanDependency,
  type DependencyMatrix,
  type SpanTypeNode,
} from "./span-dependency-matrix.js";
// Trace session export — bundled debugging package
export {
  exportTraceSession,
  exportSingleTrace,
  exportTraceAsHTML,
  type TraceSessionExport,
  type TraceExport,
  type SpanExport,
  type FlameGraphNodeExport,
} from "./trace-session-export.js";
// Period-over-period comparison
export {
  comparePeriods,
  compareWeekOverWeek,
  compareMonthOverMonth,
  type PeriodMetrics,
  type PeriodDelta,
  type PeriodComparison,
} from "./period-comparison.js";
// OTel ingestion
export {
  ingestOtelTraces,
  type OtelIngestResult,
} from "./otel-ingest.js";
// Flame graph export (Speedscope / collapsed stack formats)
export {
  exportFlameGraphAsSpeedscope,
  exportFlameGraphAsCollapsedStack,
  exportTraceFlameGraphAsSpeedscope,
  type SpeedscopeProfile,
  type CollapsedStackLine,
} from "./flame-graph-export.js";
// AI root cause analysis
export {
  analyzeTraceRootCause,
  explainTraceAnomaly,
  getTraceSelfHealingSuggestions,
  type RootCauseFinding,
  type RootCauseAnalysisResult,
  type AnomalyExplanationResult,
} from "./root-cause.js";
