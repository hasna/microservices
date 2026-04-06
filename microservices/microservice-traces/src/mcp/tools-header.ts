#!/usr/bin/env bun
/**
 * MCP server for microservice-traces.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { compare_traces, get_trace_timeline, getTraceDiffSummary } from "../lib/compare.js";
import { getTrace, getTraceTree, listTraces, listSpans, buildSpanTree } from "../lib/query.js";
import { add_span_annotation, add_span_tag, delete_span_tag, get_span_annotations, get_span_tags } from "../lib/tags.js";
import { get_error_spans, get_span_analytics, get_slowest_spans, getSpanLatencyTrend, compareLatencyBetweenPeriods, upsertSpanAnalytics } from "../lib/analytics.js";
import { getTraceStats, computeErrorRate, computePercentile } from "../lib/stats.js";
import { export_traces_jaeger, export_trace_otlp, export_traces_zipkin, exportTracesAsOTel } from "../lib/export.js";
import { endSpan, endTrace, startSpan, startTrace } from "../lib/tracing.js";
import {
  upsertSamplingPolicy,
  listSamplingPolicies,
  deleteSamplingPolicy,
  shouldSample,
  shouldKeepTrace,
} from "../lib/sampling.js";
import {
  linkTrace,
  getTracesBySession,
  getTracesByUser,
  getTraceByExternalRequestId,
  getTracesByExternalTraceId,
  getCorrelation,
} from "../lib/correlation.js";
import {
  upsertRetentionPolicy,
  listRetentionPolicies,
  deleteRetentionPolicy,
  pruneByTTL,
  pruneByCount,
  runRetentionPolicies,
  getRetentionStats,
} from "../lib/retention.js";
import {
  generateGrafanaDashboard,
} from "../lib/grafana-dashboard.js";
import {
  getTraceLatencyPercentiles,
  getErrorRateTimeline,
  getTraceDurationHistogram,
  buildTraceFlameGraph,
  buildFlameGraph,
  getTraceTimeSeries,
} from "../lib/trace-analytics.js";
import {
  recordSamplingDecision,
  getSamplingStats,
  listSamplingDecisions,
  evaluateSampling,
  bulkEvaluateSampling,
  getOverallSamplingRate,
} from "../lib/sampling-analytics.js";
import {
  toPrometheusTextFormat,
  exportPrometheusMetrics,
  getTraceCountGauge,
  getErrorRateGauge,
  getTraceLatencyHistogram,
  getSpanTypeMetrics,
} from "../lib/prometheus-export.js";
import {
  exportTraceAsDatadog,
  exportTracesAsDatadogPayload,
  getDatadogStatsForWorkspace,
} from "../lib/datadog-export.js";
import {
  refreshAnomalyBaseline,
  refreshAllBaselines,
  getSpanTypeBaseline,
  detectSpanAnomalies,
  getAnomalySummary,
  type SpanAnomaly,
} from "../lib/span-anomaly.js";
import {
  getSpanDependencyMatrix,
  getHotPaths,
  getCriticalPath,
} from "../lib/span-dependency-matrix.js";
import {
  exportTraceSession,
  exportSingleTrace,
  exportTraceAsHTML,
} from "../lib/trace-session-export.js";
import {
  comparePeriods,
  compareWeekOverWeek,
  compareMonthOverMonth,
} from "../lib/period-comparison.js";
import { ingestOtelTraces } from "../lib/otel-ingest.js";
import {
  exportFlameGraphAsSpeedscope,
  exportFlameGraphAsCollapsedStack,
  exportTraceFlameGraphAsSpeedscope,
} from "../lib/flame-graph-export.js";
import {
  analyzeTraceRootCause,
  explainTraceAnomaly,
  getTraceSelfHealingSuggestions,
} from "../lib/root-cause.js";

const server = new Server(
  { name: "microservice-traces", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

