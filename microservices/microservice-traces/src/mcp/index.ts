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

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "traces_start_trace",
      description: "Start a new trace for tracking an LLM operation",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          name: {
            type: "string",
            description: "Trace name (e.g. chat, completion)",
          },
          input: { type: "object", description: "Input data" },
          metadata: { type: "object", description: "Arbitrary metadata" },
        },
        required: ["workspace_id", "name"],
      },
    },
    {
      name: "traces_end_trace",
      description:
        "End a trace and compute aggregated metrics from child spans",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Trace ID" },
          status: { type: "string", enum: ["completed", "error"] },
          output: { type: "object", description: "Output data" },
          error: {
            type: "string",
            description: "Error message if status is error",
          },
        },
        required: ["id", "status"],
      },
    },
    {
      name: "traces_start_span",
      description: "Start a new span within a trace",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string", description: "Parent trace ID" },
          parent_span_id: {
            type: "string",
            description: "Parent span ID for nesting",
          },
          name: { type: "string", description: "Span name" },
          type: {
            type: "string",
            enum: [
              "llm",
              "tool",
              "retrieval",
              "guardrail",
              "embedding",
              "custom",
            ],
            description: "Span type",
          },
          input: { type: "object", description: "Input data" },
          model: { type: "string", description: "Model name (for llm spans)" },
          metadata: { type: "object", description: "Arbitrary metadata" },
        },
        required: ["trace_id", "name", "type"],
      },
    },
    {
      name: "traces_end_span",
      description: "End a span with results and token usage",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Span ID" },
          status: { type: "string", enum: ["completed", "error"] },
          output: { type: "object", description: "Output data" },
          error: { type: "string", description: "Error message" },
          tokens_in: { type: "number", description: "Input tokens" },
          tokens_out: { type: "number", description: "Output tokens" },
          cost_usd: { type: "number", description: "Cost in USD" },
        },
        required: ["id", "status"],
      },
    },
    {
      name: "traces_get_trace",
      description: "Get a trace with all its spans (flat list)",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Trace ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "traces_list_traces",
      description: "List traces for a workspace with optional filters",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          status: { type: "string", enum: ["running", "completed", "error"] },
          name: { type: "string", description: "Filter by name (ILIKE)" },
          since: { type: "string", description: "ISO date string" },
          until: { type: "string", description: "ISO date string" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_get_stats",
      description: "Get trace statistics for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: {
            type: "string",
            description: "ISO date string (default: 30 days ago)",
          },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_get_trace_tree",
      description:
        "Get a trace with spans nested as a tree (children[] on each span)",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Trace ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "traces_export_otel",
      description: "Export a trace as OpenTelemetry JSON (OTLP-compatible)",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Trace ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "traces_export_zipkin",
      description: "Export a trace as Zipkin JSON (v2)",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Trace ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "traces_get_workspace_analytics",
      description: "Get full workspace analytics (error rates, costs, latency percentiles by span type)",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          period_start: { type: "string", description: "ISO date (default: 7 days ago)" },
          period_end: { type: "string", description: "ISO date (default: now)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_get_span_analytics",
      description: "Get per-span-type analytics breakdown for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          period_start: { type: "string" },
          period_end: { type: "string" },
          limit: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_get_cost_breakdown",
      description: "Get cost breakdown by span type for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          period_start: { type: "string" },
          period_end: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_export_otlp",
      description: "Export a trace as OTLP JSON format (OpenTelemetry-compatible)",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Trace ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "traces_export_jaeger",
      description: "Export a trace as Jaeger JSON format",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Trace ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "traces_export_zipkin",
      description: "Export a trace as Zipkin JSON v2 format",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Trace ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "traces_export_session",
      description: "Export a session: multiple traces bundled as a self-contained debugging package",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          time_start: { type: "string", description: "ISO date string (default: 1 hour ago)" },
          time_end: { type: "string", description: "ISO date string (default: now)" },
          trace_ids: { type: "array", items: { type: "string" }, description: "Specific trace IDs to include (optional)" },
          max_traces: { type: "number", description: "Max traces to include (default 100)" },
          description: { type: "string", description: "Session description" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_export_single_trace",
      description: "Export a single trace as a compact JSON for quick sharing",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string", description: "Trace ID" },
        },
        required: ["trace_id"],
      },
    },
    {
      name: "traces_span_dependency_matrix",
      description: "Get the dependency matrix: which span types call which other span types",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          period_start: { type: "string", description: "ISO date string (default: 24 hours ago)" },
          period_end: { type: "string", description: "ISO date string (default: now)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_hot_paths",
      description: "Get top N hot paths (most frequently called caller->callee chains)",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          limit: { type: "number", description: "Max paths to return (default 20)" },
          period_start: { type: "string", description: "ISO date string (default: 24 hours ago)" },
          period_end: { type: "string", description: "ISO date string (default: now)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_critical_path",
      description: "Get the critical path for a trace: the chain of spans contributing most to total duration",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          trace_id: { type: "string", description: "Trace ID" },
        },
        required: ["workspace_id", "trace_id"],
      },
    },
    {
      name: "traces_span_analytics",
      description: "Get per-operation span analytics (call count, duration percentiles, error rates)",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: { type: "string", description: "ISO date string (default: 7 days ago)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_slowest_spans",
      description: "Get top N slowest spans with full context",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          limit: { type: "number", description: "Max spans to return (default 10, max 100)" },
          since: { type: "string", description: "ISO date string (default: 7 days ago)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_error_spans",
      description: "Get all errored spans for a workspace with error messages",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: { type: "string", description: "ISO date string (default: 7 days ago)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_compare",
      description: "Compare two traces and return a diff report",
      inputSchema: {
        type: "object",
        properties: {
          trace_id_a: { type: "string", description: "First trace ID" },
          trace_id_b: { type: "string", description: "Second trace ID" },
        },
        required: ["trace_id_a", "trace_id_b"],
      },
    },
    {
      name: "traces_get_timeline",
      description: "Get a flat list of spans in execution order with start offset from trace start",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Trace ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "traces_add_span_tag",
      description: "Add a custom key-value tag to a span",
      inputSchema: {
        type: "object",
        properties: {
          span_id: { type: "string", description: "Span ID" },
          key: { type: "string", description: "Tag key" },
          value: { type: "string", description: "Tag value" },
        },
        required: ["span_id", "key", "value"],
      },
    },
    {
      name: "traces_get_span_tags",
      description: "Get all tags for a span",
      inputSchema: {
        type: "object",
        properties: {
          span_id: { type: "string", description: "Span ID" },
        },
        required: ["span_id"],
      },
    },
    {
      name: "traces_delete_span_tag",
      description: "Delete a tag from a span by key",
      inputSchema: {
        type: "object",
        properties: {
          span_id: { type: "string", description: "Span ID" },
          key: { type: "string", description: "Tag key" },
        },
        required: ["span_id", "key"],
      },
    },
    {
      name: "traces_add_span_annotation",
      description: "Add a text annotation to a span",
      inputSchema: {
        type: "object",
        properties: {
          span_id: { type: "string", description: "Span ID" },
          text: { type: "string", description: "Annotation text" },
          timestamp: { type: "string", description: "ISO date string (optional, defaults to now)" },
        },
        required: ["span_id", "text"],
      },
    },
    {
      name: "traces_get_span_annotations",
      description: "Get all annotations for a span",
      inputSchema: {
        type: "object",
        properties: {
          span_id: { type: "string", description: "Span ID" },
        },
        required: ["span_id"],
      },
    },
    // Sampling tools
    {
      name: "traces_upsert_sampling_policy",
      description: "Upsert a trace sampling policy (head or tail based)",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID (optional for global policy)" },
          name: { type: "string", description: "Policy name (must be unique)" },
          type: { type: "string", enum: ["head_rate", "head_probabilistic", "tail_error_only", "tail_slow_trace", "tail_high_cost"] },
          rate: { type: "number", description: "Sampling rate (0.0-1.0)" },
          span_types: { type: "array", items: { type: "string" }, description: "Optional span types to filter" },
          threshold_ms: { type: "number", description: "Threshold for tail_slow_trace (ms)" },
          threshold_usd: { type: "number", description: "Threshold for tail_high_cost ($)" },
          enabled: { type: "boolean" },
          priority: { type: "number" },
        },
        required: ["name", "type", "rate"],
      },
    },
    {
      name: "traces_list_sampling_policies",
      description: "List all sampling policies for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
        },
      },
    },
    {
      name: "traces_delete_sampling_policy",
      description: "Delete a sampling policy by ID",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Policy ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "traces_should_sample",
      description: "Check if a trace should be sampled based on active head policies",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          span_type: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    // Correlation tools
    {
      name: "traces_link_trace",
      description: "Link a trace to a session, user, or external request ID",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string", description: "Trace ID" },
          session_id: { type: "string", description: "Session ID" },
          user_id: { type: "string", description: "User ID" },
          external_request_id: { type: "string", description: "External request ID (e.g. from API gateway)" },
          external_trace_id: { type: "string", description: "Cross-service trace ID" },
        },
        required: ["trace_id"],
      },
    },
    {
      name: "traces_get_by_session",
      description: "Get all traces for a given session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["session_id"],
      },
    },
    {
      name: "traces_get_by_user",
      description: "Get all traces for a given user",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["user_id"],
      },
    },
    {
      name: "traces_get_by_external_request_id",
      description: "Get a trace by external request ID",
      inputSchema: {
        type: "object",
        properties: {
          external_request_id: { type: "string" },
        },
        required: ["external_request_id"],
      },
    },
    // Retention tools
    {
      name: "traces_upsert_retention_policy",
      description: "Upsert a trace retention policy (TTL or max-count based)",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          name: { type: "string" },
          type: { type: "string", enum: ["ttl_days", "max_count"] },
          days: { type: "number" },
          max_count: { type: "number" },
          enabled: { type: "boolean" },
        },
        required: ["name", "type"],
      },
    },
    {
      name: "traces_list_retention_policies",
      description: "List retention policies for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
        },
      },
    },
    {
      name: "traces_run_retention",
      description: "Run all active retention policies for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_retention_stats",
      description: "Get retention statistics for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    // Grafana dashboard export
    {
      name: "traces_generate_grafana_dashboard",
      description: "Generate a Grafana dashboard JSON for a workspace's traces — import into Grafana to get a full trace overview dashboard",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          title: { type: "string", description: "Dashboard title (default: Hasna Traces Overview)" },
          uid: { type: "string", description: "Dashboard UID (default: auto-generated)" },
          refresh_interval: { type: "string", description: "Refresh interval (default: 5m)" },
        },
        required: ["workspace_id"],
      },
    },
    // Trace analytics
    {
      name: "traces_latency_percentiles",
      description: "Get per-trace latency percentiles (p50/p75/p90/p95/p99/p999) for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: { type: "string", description: "ISO date string (default: 7 days ago)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_duration_histogram",
      description: "Get a histogram of trace durations grouped into latency buckets for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: { type: "string", description: "ISO date string (default: 7 days ago)" },
          bucket_count: { type: "number", description: "Number of histogram buckets (default: 20)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_error_rate_timeline",
      description: "Get error rate over time in configurable buckets",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: { type: "string", description: "ISO date string (default: 7 days ago)" },
          bucket_minutes: { type: "number", description: "Bucket size in minutes (default: 60)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_latency_histogram",
      description: "Get a histogram of trace durations for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: { type: "string", description: "ISO date string (default: 7 days ago)" },
          bucket_count: { type: "number", description: "Number of buckets (default: 20)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_flame_graph",
      description: "Get flame-graph data for a trace (hierarchical span durations for visualization)",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string" },
        },
        required: ["trace_id"],
      },
    },
    {
      name: "traces_time_series",
      description: "Get a time-series of trace metrics (count, latency, cost, tokens) in configurable buckets",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: { type: "string", description: "ISO date string (default: 7 days ago)" },
          bucket_minutes: { type: "number", description: "Bucket size in minutes (default: 60)" },
        },
        required: ["workspace_id"],
      },
    },
    // Sampling analytics
    {
      name: "traces_record_sampling_decision",
      description: "Record that a trace was evaluated against sampling policies",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string", description: "Trace ID (optional — omit for hypothetical)" },
          workspace_id: { type: "string" },
          policy_id: { type: "string" },
          policy_name: { type: "string" },
          policy_type: { type: "string" },
          decision: { type: "string", enum: ["sampled", "dropped"] },
          reason: { type: "string" },
        },
        required: ["workspace_id", "policy_type", "decision", "reason"],
      },
    },
    {
      name: "traces_sampling_stats",
      description: "Get per-policy sampling statistics (sampled vs dropped) for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: { type: "string", description: "ISO date string (default: 24 hours ago)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_list_sampling_decisions",
      description: "List all sampling decisions for a workspace (paginated)",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          limit: { type: "number" },
          offset: { type: "number" },
          decision: { type: "string", enum: ["sampled", "dropped"] },
          since: { type: "string", description: "ISO date string (default: 7 days ago)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_evaluate_sampling",
      description: "Evaluate which sampling policy would apply to a hypothetical trace (head-based only, does not record)",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          span_type: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_bulk_evaluate_sampling",
      description: "Make bulk sampling decisions for multiple trace IDs",
      inputSchema: {
        type: "object",
        properties: {
          trace_ids: { type: "array", items: { type: "string" } },
        },
        required: ["trace_ids"],
      },
    },
    {
      name: "traces_overall_sampling_rate",
      description: "Get overall sampling rate (sampled vs dropped) for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: { type: "string", description: "ISO date string (default: 24 hours ago)" },
        },
        required: ["workspace_id"],
      },
    },
    // Prometheus / OpenMetrics export
    {
      name: "traces_export_prometheus_text",
      description: "Export workspace traces as Prometheus/OpenMetrics text format for /metrics endpoint",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: { type: "string", description: "ISO date string (default: 7 days ago)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_prometheus_metrics",
      description: "Get all Prometheus metrics for a workspace as structured JSON",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: { type: "string", description: "ISO date string (default: 7 days ago)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_get_count_gauge",
      description: "Get a single trace count gauge metric for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_get_error_rate_gauge",
      description: "Get a single error rate gauge metric (percent) for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: { type: "string", description: "ISO date string (default: 7 days ago)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_get_span_type_metrics",
      description: "Get per-span-type counters, error counts, cost, token, and latency metrics for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: { type: "string", description: "ISO date string (default: 7 days ago)" },
        },
        required: ["workspace_id"],
      },
    },
    // Datadog APM export
    {
      name: "traces_export_datadog",
      description: "Export a trace as Datadog APM JSON format",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Trace ID" },
          service_name: { type: "string", description: "Service name for Datadog (default: hasna-agent)" },
        },
        required: ["id"],
      },
    },
    {
      name: "traces_datadog_stats",
      description: "Get Datadog APM-compatible stats for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: { type: "string", description: "ISO date string (default: 7 days ago)" },
        },
        required: ["workspace_id"],
      },
    },
    // Span anomaly detection
    {
      name: "traces_refresh_anomaly_baselines",
      description: "Refresh rolling baselines for span anomaly detection for all span types",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_detect_anomalies",
      description: "Detect anomalous spans in a workspace (spans that are statistical outliers for their type)",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: { type: "string", description: "ISO date string (default: 24 hours ago)" },
          min_score: { type: "number", description: "Minimum anomaly score 0.0-1.0 (default: 0.5)" },
          span_types: { type: "array", items: { type: "string" }, description: "Filter by span types" },
          limit: { type: "number", description: "Max anomalies to return (default: 100)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_anomaly_summary",
      description: "Get anomaly detection summary for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          since: { type: "string", description: "ISO date string (default: 7 days ago)" },
        },
        required: ["workspace_id"],
      },
    },
    // Period-over-period comparison
    {
      name: "traces_compare_periods",
      description: "Compare trace analytics between two time windows with delta scoring",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          current_start: { type: "string", description: "Start of current period (ISO date)" },
          current_end: { type: "string", description: "End of current period (ISO date)" },
          previous_start: { type: "string", description: "Start of comparison period (ISO date)" },
          previous_end: { type: "string", description: "End of comparison period (ISO date)" },
        },
        required: ["workspace_id", "current_start", "current_end", "previous_start", "previous_end"],
      },
    },
    {
      name: "traces_compare_week_over_week",
      description: "Quick week-over-week comparison of trace analytics",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          week_end_date: { type: "string", description: "End of current week as ISO date string (default: now)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_compare_month_over_month",
      description: "Quick month-over-month comparison of trace analytics",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          month_end_date: { type: "string", description: "End of current month as ISO date string (default: now)" },
        },
        required: ["workspace_id"],
      },
    },
    // Trace diff summary — human-readable comparison
    {
      name: "traces_diff_summary",
      description: "Get a human-readable summary of differences between two traces",
      inputSchema: {
        type: "object",
        properties: {
          trace_id_a: { type: "string", description: "First trace ID (older)" },
          trace_id_b: { type: "string", description: "Second trace ID (newer)" },
        },
        required: ["trace_id_a", "trace_id_b"],
      },
    },
    // Span latency trend — time series of percentiles
    {
      name: "traces_latency_trend",
      description: "Get latency percentile trend over time (p50/p75/p90/p95/p99 per time bucket)",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          interval_minutes: { type: "number", description: "Bucket interval in minutes (default: 60)" },
          period_start: { type: "string", description: "Start of period as ISO date (default: 24h ago)" },
          period_end: { type: "string", description: "End of period as ISO date (default: now)" },
          operation_name: { type: "string", description: "Filter by operation (span) name" },
          span_type: { type: "string", description: "Filter by span type (llm, embed, tool, retrieval, guardrail)" },
        },
        required: ["workspace_id"],
      },
    },
    // Compare latency between two periods
    {
      name: "traces_latency_comparison",
      description: "Compare latency percentiles (p50/p95/p99) between two time periods to detect regressions",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          period_a_start: { type: "string", description: "Start of period A as ISO date" },
          period_a_end: { type: "string", description: "End of period A as ISO date" },
          period_b_start: { type: "string", description: "Start of period B as ISO date" },
          period_b_end: { type: "string", description: "End of period B as ISO date" },
          operation_name: { type: "string", description: "Filter by operation (span) name" },
          span_type: { type: "string", description: "Filter by span type (llm, embed, tool, retrieval, guardrail)" },
        },
        required: ["workspace_id", "period_a_start", "period_a_end", "period_b_start", "period_b_end"],
      },
    },
    // Export trace as HTML
    {
      name: "traces_export_html",
      description: "Export a trace as a self-contained HTML page with waterfall, table, and flame graph views",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string", description: "Trace ID to export" },
        },
        required: ["trace_id"],
      },
    },
    // Get traces by user ID
    {
      name: "traces_get_traces_by_user",
      description: "Get all traces for a given user ID",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "User ID to search for" },
          limit: { type: "number", description: "Maximum number of traces to return (default: 50)" },
        },
        required: ["user_id"],
      },
    },
    // Get traces by external trace ID (cross-service)
    {
      name: "traces_get_traces_by_external_trace_id",
      description: "Get all traces matching an external trace ID from another service or system",
      inputSchema: {
        type: "object",
        properties: {
          external_trace_id: { type: "string", description: "External trace ID to search for" },
          limit: { type: "number", description: "Maximum number of traces to return (default: 50)" },
        },
        required: ["external_trace_id"],
      },
    },
    // Sampling — should keep trace
    {
      name: "traces_should_keep_trace",
      description: "Check whether a trace should be retained based on active sampling policies",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          trace_id: { type: "string", description: "Trace ID to evaluate" },
          sample_rate: { type: "number", description: "Current sample rate (0–1)" },
        },
        required: ["workspace_id", "trace_id"],
      },
    },
    // Correlation — get traces by external trace ID
    {
      name: "traces_get_by_external_trace_id",
      description: "Look up traces linked to an external trace ID (e.g. from another tracing system)",
      inputSchema: {
        type: "object",
        properties: {
          external_trace_id: { type: "string", description: "External trace ID to look up" },
        },
        required: ["external_trace_id"],
      },
    },
    // Retention — delete a retention policy
    {
      name: "traces_delete_retention_policy",
      description: "Delete a retention policy by name for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          name: { type: "string", description: "Policy name to delete" },
        },
        required: ["workspace_id", "name"],
      },
    },
    // Retention — prune by TTL
    {
      name: "traces_prune_by_ttl",
      description: "Manually run TTL-based retention pruning for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
        },
        required: ["workspace_id"],
      },
    },
    // Retention — prune by count
    {
      name: "traces_prune_by_count",
      description: "Manually run count-based retention pruning (keep N most recent) for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          keep_count: { type: "number", description: "Number of most recent traces to keep" },
        },
        required: ["workspace_id", "keep_count"],
      },
    },
    // Span anomaly — refresh baseline for a span type
    {
      name: "traces_refresh_span_baseline",
      description: "Recompute the statistical baseline for a specific span type in a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          span_type: { type: "string", description: "Span type (e.g. llm, retrieval, tool)" },
        },
        required: ["workspace_id", "span_type"],
      },
    },
    // Span anomaly — get baseline for a span type
    {
      name: "traces_get_span_type_baseline",
      description: "Get the statistical baseline (p50, p95, p99, z-score threshold) for a span type",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          span_type: { type: "string", description: "Span type" },
        },
        required: ["workspace_id", "span_type"],
      },
    },
    // Trace analytics — build standalone flame graph from spans
    {
      name: "traces_build_flame_graph",
      description: "Build a flame graph from a set of spans without requiring a full trace",
      inputSchema: {
        type: "object",
        properties: {
          spans: {
            type: "array",
            description: "Array of spans with id, parent_span_id, name, duration_ms",
            items: { type: "object" },
          },
        },
        required: ["spans"],
      },
    },
    // Query — list spans for a trace
    {
      name: "traces_list_spans",
      description: "List all spans for a trace with optional type and status filters",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string", description: "Trace ID" },
          type: { type: "string", description: "Filter by span type (e.g. llm, tool, retrieval)" },
          status: { type: "string", description: "Filter by status (running, completed, error)" },
        },
        required: ["trace_id"],
      },
    },
    // Query — build a span tree from flat spans
    {
      name: "traces_build_span_tree",
      description: "Build a nested span tree from a flat list of spans using parent_span_id",
      inputSchema: {
        type: "object",
        properties: {
          spans: {
            type: "array",
            description: "Flat array of spans (each must have id and parent_span_id fields)",
            items: { type: "object" },
          },
        },
        required: ["spans"],
      },
    },
    // Analytics — upsert rolling span analytics for a trace
    {
      name: "traces_upsert_span_analytics",
      description: "Upsert rolling span analytics for a trace into the analytics table",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string", description: "Trace ID" },
          workspace_id: { type: "string", description: "Workspace ID" },
        },
        required: ["trace_id", "workspace_id"],
      },
    },
    // Stats — compute error rate percentage from errored and total counts
    {
      name: "traces_compute_error_rate",
      description: "Compute error rate as a percentage from errored and total trace counts (pure function)",
      inputSchema: {
        type: "object",
        properties: {
          errored: { type: "number", description: "Number of errored traces" },
          total: { type: "number", description: "Total number of traces" },
        },
        required: ["errored", "total"],
      },
    },
    // Stats — compute percentile from a sorted array
    {
      name: "traces_compute_percentile",
      description: "Compute a percentile value from a sorted array of numbers (pure function)",
      inputSchema: {
        type: "object",
        properties: {
          sorted: { type: "array", items: { type: "number" }, description: "Sorted array of numbers" },
          p: { type: "number", description: "Percentile to compute (0-100, e.g. 50 for p50, 95 for p95)" },
        },
        required: ["sorted", "p"],
      },
    },
    // Export — export multiple traces as a combined OpenTelemetry batch
    {
      name: "traces_export_traces_otel",
      description: "Export multiple traces as a combined OpenTelemetry batch",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          trace_ids: { type: "array", items: { type: "string" }, description: "Array of trace IDs to export" },
          since: { type: "string", description: "ISO date string — fetch traces since this time (optional)" },
        },
        required: ["workspace_id"],
      },
    },
    // Correlation — get correlation data for a trace
    {
      name: "traces_get_correlation",
      description: "Get the correlation data (session, user, external IDs) linked to a trace",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string", description: "Trace ID" },
        },
        required: ["trace_id"],
      },
    },
    // Correlation — get traces by external trace ID
    {
      name: "traces_get_by_external_trace_id",
      description: "Get all traces linked to a given external/cross-service trace ID",
      inputSchema: {
        type: "object",
        properties: {
          external_trace_id: { type: "string", description: "External trace ID (e.g. from another service)" },
          limit: { type: "number", description: "Max traces to return (default 50)" },
        },
        required: ["external_trace_id"],
      },
    },
    // Trace analytics — get trace latency percentiles
    {
      name: "traces_latency_percentiles",
      description: "Get per-trace latency percentiles (p50, p75, p90, p95, p99, p999) across a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          since: { type: "string", description: "ISO date string (default: 7 days ago)" },
        },
        required: ["workspace_id"],
      },
    },
    // Trace analytics — error rate timeline
    {
      name: "traces_error_rate_timeline",
      description: "Get error rate over time in configurable buckets",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          since: { type: "string", description: "ISO date string (default: 7 days ago)" },
          bucket_minutes: { type: "number", description: "Bucket size in minutes (default: 60)" },
        },
        required: ["workspace_id"],
      },
    },
    // Span anomaly — anomaly summary (already has handler as traces_anomaly_summary)
    {
      name: "traces_anomaly_summary",
      description: "Get a summary of detected anomalies for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          since: { type: "string", description: "ISO date string (default: 24 hours ago)" },
        },
        required: ["workspace_id"],
      },
    },
    // Dependency matrix — get full matrix as structured JSON (nodes + edges)
    {
      name: "traces_dependency_matrix_json",
      description: "Get the full dependency matrix (nodes and edges) for a workspace as structured JSON — useful for building custom visualizations",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          period_start: { type: "string", description: "ISO date string (default: 24 hours ago)" },
          period_end: { type: "string", description: "ISO date string (default: now)" },
        },
        required: ["workspace_id"],
      },
    },
    // Dependency matrix — identify bottleneck span types (high latency + high calls + errors)
    {
      name: "traces_dependency_hotspot",
      description: "Identify span types that are hotspots — high call counts, high latency, and high error rates — sorted by impact score",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          period_start: { type: "string", description: "ISO date string (default: 24 hours ago)" },
          period_end: { type: "string", description: "ISO date string (default: now)" },
          limit: { type: "number", description: "Max hotspots to return (default 10)" },
        },
        required: ["workspace_id"],
      },
    },
    // Flame graph — build from a trace ID (reuses existing buildTraceFlameGraph)
    {
      name: "traces_flame_graph_for_trace",
      description: "Build a flame graph from an existing trace ID (gets all spans and builds hierarchical duration view)",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string", description: "Trace ID to build flame graph for" },
        },
        required: ["trace_id"],
      },
    },
    // Export — export trace as DOT format for Graphviz rendering
    {
      name: "traces_export_dot",
      description: "Export a trace as DOT (Graphviz) format for visualization as a directed graph",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string", description: "Trace ID to export" },
          direction: { type: "string", enum: ["TB", "LR", "BT", "RL"], description: "Graph direction: TB (top-bottom), LR (left-right), BT, RL (default TB)" },
        },
        required: ["trace_id"],
      },
    },
    // Analytics — full workspace analytics summary
    {
      name: "traces_workspace_analytics",
      description: "Get a comprehensive workspace analytics summary including total traces, error rate, cost, tokens, and per-span-type breakdowns",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          period_start: { type: "string", description: "ISO date string (default: 7 days ago)" },
          period_end: { type: "string", description: "ISO date string (default: now)" },
        },
        required: ["workspace_id"],
      },
    },
    // Analytics — cost breakdown by span type
    {
      name: "traces_cost_breakdown",
      description: "Get cost breakdown by span type for a workspace — shows which operations are most expensive",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          period_start: { type: "string", description: "ISO date string (default: 7 days ago)" },
          period_end: { type: "string", description: "ISO date string (default: now)" },
        },
        required: ["workspace_id"],
      },
    },
    // Analytics — latency histogram for a span type
    {
      name: "traces_latency_histogram_for_type",
      description: "Get latency distribution histogram buckets for a specific span type",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          span_type: { type: "string", description: "Span type (e.g., llm, tool, retrieval)" },
          buckets: { type: "number", description: "Number of histogram buckets (default: 10)" },
          period_start: { type: "string", description: "ISO date string (default: 7 days ago)" },
          period_end: { type: "string", description: "ISO date string (default: now)" },
        },
        required: ["workspace_id", "span_type"],
      },
    },
    // Comparison — structured trace diff between two traces
    {
      name: "traces_trace_diff",
      description: "Get a structured comparison between two traces showing added/removed spans, duration differences, and attribute diffs",
      inputSchema: {
        type: "object",
        properties: {
          trace_id_a: { type: "string", description: "First trace ID" },
          trace_id_b: { type: "string", description: "Second trace ID" },
        },
        required: ["trace_id_a", "trace_id_b"],
      },
    },
    // Period comparison — arbitrary window comparison
    {
      name: "traces_compare_periods",
      description: "Compare trace analytics between two arbitrary time windows — returns delta for each metric (cost, latency, error rate, etc.)",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          current_start: { type: "string", description: "Current period start ISO date" },
          current_end: { type: "string", description: "Current period end ISO date" },
          previous_start: { type: "string", description: "Previous period start ISO date" },
          previous_end: { type: "string", description: "Previous period end ISO date" },
        },
        required: ["workspace_id", "current_start", "current_end", "previous_start", "previous_end"],
      },
    },
    // Export — export trace as OpenTelemetry JSON (OTLP)
    {
      name: "traces_export_trace_otel",
      description: "Export a single trace in OpenTelemetry (OTLP) JSON format",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string", description: "Trace ID to export" },
        },
        required: ["trace_id"],
      },
    },
    // Export — export trace as Zipkin JSON
    {
      name: "traces_export_trace_zipkin",
      description: "Export a single trace in Zipkin JSON format",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string", description: "Trace ID to export" },
        },
        required: ["trace_id"],
      },
    },
    // Export — export trace as Jaeger JSON
    {
      name: "traces_export_trace_jaeger",
      description: "Export a single trace in Jaeger JSON format",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string", description: "Trace ID to export" },
        },
        required: ["trace_id"],
      },
    },
    // Export — Grafana dashboard JSON for a workspace
    {
      name: "traces_grafana_dashboard_json",
      description: "Generate a Grafana dashboard JSON for a workspace that can be imported directly into Grafana — includes trace overview, latency, cost, and error panels",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          title: { type: "string", description: "Dashboard title (default: workspace-traces)" },
          uid: { type: "string", description: "Dashboard UID (default: auto-generated)" },
          refresh_interval: { type: "string", description: "Refresh interval e.g. 30s, 5m (default: 1m)" },
        },
        required: ["workspace_id"],
      },
    },
    // ── Gap tools ──────────────────────────────────────────────────────────────
    // traces_multi_format_export — export a trace in all formats at once
    {
      name: "traces_multi_format_export",
      description: "Export a single trace in all supported formats (OTLP, Zipkin, Jaeger, Datadog, HTML) in one call — useful for integration testing and debugging",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string", description: "Trace ID to export" },
          formats: {
            type: "array",
            items: { type: "string", enum: ["otlp", "zipkin", "jaeger", "datadog", "html"] },
            description: "Formats to include (default: all)" },
        },
        required: ["trace_id"],
      },
    },
    // traces_get_trace_events — flat event sequence for waterfall UIs
    {
      name: "traces_get_trace_events",
      description: "Get a trace as a flat sequence of timestamped events with start/end offsets — ideal for rendering waterfall/timeline UIs",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string", description: "Trace ID" },
        },
        required: ["trace_id"],
      },
    },
    // traces_suggest_retention_policy — ML-free heuristic retention suggestion
    {
      name: "traces_suggest_retention_policy",
      description: "Analyze workspace trace volume and span density to suggest TTL and max-count retention values — does not upsert, only suggests",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          target_storage_gb: { type: "number", description: "Desired max storage in GB (default: 10)" },
        },
        required: ["workspace_id"],
      },
    },
    // traces_detect_span_gaps — find orphaned child spans with missing parents
    {
      name: "traces_detect_span_gaps",
      description: "Detect spans that reference a parent_span_id that does not exist in the trace — signals instrumentation bugs or async lost-context issues",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          since: { type: "string", description: "ISO date string (default: 24 hours ago)" },
          limit: { type: "number", description: "Max gaps to return (default: 50)" },
        },
        required: ["workspace_id"],
      },
    },
    // traces_span_type_summary — quick span type counts
    {
      name: "traces_span_type_summary",
      description: "Get a lightweight summary of all span types and their counts/avg-duration for a workspace — fast overview for capacity planning",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          since: { type: "string", description: "ISO date string (default: 24 hours ago)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "traces_ingest_otlp",
      description: "Ingest traces from external OpenTelemetry (OTLP) agents in JSON format. Accepts OTLP HTTP JSON and stores traces/spans in the database. Use this to receive traces from services using OTel SDK that cannot use the native SDK directly.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Target workspace ID" },
          otlp_json: {
            type: "object",
            description: "OTLP JSON payload (resourceSpans array format)",
          },
        },
        required: ["workspace_id", "otlp_json"],
      },
    },
    {
      name: "traces_export_flame_speedscope",
      description: "Export a flame graph for a trace as Speedscope JSON format. Speedscope is an interactive flame graph visualizer. Returns a Speedscope-compatible profile object that can be uploaded to speedscope.app or used with other flame graph viewers.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          trace_id: { type: "string", description: "Trace ID to export" },
          value_field: {
            type: "string",
            enum: ["duration_ms", "tokens_in", "tokens_out"],
            description: "Which value to use for flame graph widths",
            default: "duration_ms",
          },
        },
        required: ["workspace_id", "trace_id"],
      },
    },
    {
      name: "traces_export_flame_collapsed_stack",
      description: "Export a flame graph as collapsed stack format (.collapsed). Each line is: frame1;frame2;frame3... count. Compatible with FlameGraph, 0x, and other collapsed-format flame graph tools.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          trace_id: { type: "string", description: "Trace ID to export" },
          value_field: {
            type: "string",
            enum: ["duration_ms", "tokens_in", "tokens_out"],
            description: "Which value to use for flame graph widths",
            default: "duration_ms",
          },
        },
        required: ["workspace_id", "trace_id"],
      },
    },
    {
      name: "traces_analyze_root_cause",
      description: "AI-powered root cause analysis for a trace. Identifies why a trace is slow or errored by analyzing span patterns, error distribution, sequential dependencies, and resource usage. Returns actionable findings with suggestions.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          trace_id: { type: "string", description: "Trace ID to analyze" },
        },
        required: ["workspace_id", "trace_id"],
      },
    },
    {
      name: "traces_explain_anomaly",
      description: "Explain why a specific trace is anomalous compared to its baseline. Calculates deviation from historical performance and identifies likely causes of the anomaly.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          trace_id: { type: "string", description: "Trace ID to explain" },
          baseline_hours: {
            type: "number",
            description: "Number of hours to look back for baseline (default: 24)",
            default: 24,
          },
        },
        required: ["workspace_id", "trace_id"],
      },
    },
    {
      name: "traces_self_healing_suggestions",
      description: "Get configuration change suggestions to improve trace performance. Analyzes the trace and returns specific, actionable recommendations for optimization.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          trace_id: { type: "string", description: "Trace ID to get suggestions for" },
        },
        required: ["workspace_id", "trace_id"],
      },
    },
    // Multi-service comparison
    {
      name: "traces_compare_multi",
      description: "Compare trace statistics across multiple workspaces in a single call. Returns a table of metrics (trace count, error rate, latency p95, cost) for each workspace.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_ids: z.array(z.string()).describe("Array of workspace IDs to compare"),
          from_date: z.string().optional().describe("Start date (ISO string, default: 7 days ago)"),
          to_date: z.string().optional().describe("End date (ISO string, default: now)"),
        },
        required: ["workspace_ids"],
      },
    },
    // Trace health score
    {
      name: "traces_get_trace_score",
      description: "Compute a 0-100 health score for a trace based on latency, error rate, cost efficiency, and span structure. Scores above 80 are healthy, below 50 indicate problems.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: z.string().describe("Workspace ID"),
          trace_id: z.string().describe("Trace ID to score"),
        },
        required: ["workspace_id", "trace_id"],
      },
    },
    // Full debug bundle export
    {
      name: "traces_export_full_bundle",
      description: "Export a comprehensive debug bundle for a trace: trace data, full span tree, tags, stats, and flame graph data in a single JSON object.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: z.string().describe("Workspace ID"),
          trace_id: z.string().describe("Trace ID to export"),
          include_spans: z.boolean().optional().default(true).describe("Include full span details"),
          include_flame_graph: z.boolean().optional().default(true).describe("Include flame graph data"),
        },
        required: ["workspace_id", "trace_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb();
  const { name, arguments: args } = req.params;
  const a = args as any;

  const text = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  if (name === "traces_start_trace") {
    return text(
      await startTrace(sql, {
        workspaceId: String(a.workspace_id),
        name: String(a.name),
        input: a.input,
        metadata: a.metadata as any | undefined,
      }),
    );
  }

  if (name === "traces_end_trace") {
    return text(
      await endTrace(sql, String(a.id), {
        status: a.status as "completed" | "error",
        output: a.output,
        error: a.error ? String(a.error) : undefined,
      }),
    );
  }

  if (name === "traces_start_span") {
    return text(
      await startSpan(sql, {
        traceId: String(a.trace_id),
        parentSpanId: a.parent_span_id ? String(a.parent_span_id) : undefined,
        name: String(a.name),
        type: String(a.type) as
          | "llm"
          | "tool"
          | "retrieval"
          | "guardrail"
          | "embedding"
          | "custom",
        input: a.input,
        model: a.model ? String(a.model) : undefined,
        metadata: a.metadata as any | undefined,
      }),
    );
  }

  if (name === "traces_end_span") {
    return text(
      await endSpan(sql, String(a.id), {
        status: a.status as "completed" | "error",
        output: a.output,
        error: a.error ? String(a.error) : undefined,
        tokens_in: a.tokens_in ? Number(a.tokens_in) : undefined,
        tokens_out: a.tokens_out ? Number(a.tokens_out) : undefined,
        cost_usd: a.cost_usd ? Number(a.cost_usd) : undefined,
      }),
    );
  }

  if (name === "traces_get_trace") {
    const trace = await getTrace(sql, String(a.id));
    if (!trace) return text({ error: "Trace not found" });
    return text(trace);
  }

  if (name === "traces_list_traces") {
    return text(
      await listTraces(sql, String(a.workspace_id), {
        status: a.status ? String(a.status) : undefined,
        name: a.name ? String(a.name) : undefined,
        since: a.since ? new Date(String(a.since)) : undefined,
        until: a.until ? new Date(String(a.until)) : undefined,
        limit: a.limit ? Number(a.limit) : undefined,
        offset: a.offset ? Number(a.offset) : undefined,
      }),
    );
  }

  if (name === "traces_get_stats") {
    return text(
      await getTraceStats(
        sql,
        String(a.workspace_id),
        a.since ? new Date(String(a.since)) : undefined,
      ),
    );
  }

  if (name === "traces_get_trace_tree") {
    const trace = await getTraceTree(sql, String(a.id));
    if (!trace) return text({ error: "Trace not found" });
    return text(trace);
  }

  if (name === "traces_export_otel") {
    const { exportTraceAsOTel } = await import("../lib/export.js");
    const { getTrace } = await import("../lib/query.js");
    const trace = await getTrace(sql, String(a.id));
    if (!trace) return text({ error: "Trace not found" });
    return text(exportTraceAsOTel(trace));
  }

  if (name === "traces_export_zipkin") {
    const { exportTraceAsZipkin } = await import("../lib/export.js");
    const { getTrace } = await import("../lib/query.js");
    const trace = await getTrace(sql, String(a.id));
    if (!trace) return text({ error: "Trace not found" });
    return text({ traces: [exportTraceAsZipkin(trace)] });
  }

  if (name === "traces_get_workspace_analytics") {
    const { getWorkspaceAnalytics } = await import("../lib/analytics.js");
    return text(await getWorkspaceAnalytics(
      sql,
      String(a.workspace_id),
      {
        periodStart: a.period_start ? new Date(String(a.period_start)) : undefined,
        periodEnd: a.period_end ? new Date(String(a.period_end)) : undefined,
      },
    ));
  }

  if (name === "traces_get_span_analytics") {
    const { getSpanAnalytics } = await import("../lib/analytics.js");
    return text(await getSpanAnalytics(
      sql,
      String(a.workspace_id),
      {
        periodStart: a.period_start ? new Date(String(a.period_start)) : undefined,
        periodEnd: a.period_end ? new Date(String(a.period_end)) : undefined,
        limit: a.limit ? Number(a.limit) : undefined,
      },
    ));
  }

  if (name === "traces_get_cost_breakdown") {
    const { getCostBreakdown } = await import("../lib/analytics.js");
    return text(await getCostBreakdown(
      sql,
      String(a.workspace_id),
      {
        periodStart: a.period_start ? new Date(String(a.period_start)) : undefined,
        periodEnd: a.period_end ? new Date(String(a.period_end)) : undefined,
      },
    ));
  }

  if (name === "traces_export_otlp") {
    const result = await export_trace_otlp(sql, String(a.id));
    if (!result) return text({ error: "Trace not found" });
    return text(result);
  }

  if (name === "traces_export_jaeger") {
    const result = await export_traces_jaeger(sql, String(a.id));
    if (!result) return text({ error: "Trace not found" });
    return text(result);
  }

  if (name === "traces_export_zipkin") {
    const result = await export_traces_zipkin(sql, String(a.id));
    if (!result) return text({ error: "Trace not found" });
    return text(result);
  }

  if (name === "traces_span_analytics") {
    return text(await get_span_analytics(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

  if (name === "traces_slowest_spans") {
    return text(await get_slowest_spans(
      sql,
      String(a.workspace_id),
      a.limit ? Number(a.limit) : 10,
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

  if (name === "traces_error_spans") {
    return text(await get_error_spans(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

  if (name === "traces_export_session") {
    return text(await exportTraceSession(sql, String(a.workspace_id), {
      timeStart: a.time_start ? new Date(String(a.time_start)) : undefined,
      timeEnd: a.time_end ? new Date(String(a.time_end)) : undefined,
      traceIds: a.trace_ids ? Array.from(a.trace_ids as any).map(String) : undefined,
      maxTraces: a.max_traces ? Number(a.max_traces) : undefined,
      description: a.description ? String(a.description) : undefined,
    }));
  }

  if (name === "traces_export_single_trace") {
    const result = await exportSingleTrace(sql, String(a.trace_id));
    if (!result) return text({ error: "Trace not found" });
    return text(result);
  }

  if (name === "traces_span_dependency_matrix") {
    return text(await getSpanDependencyMatrix(sql, String(a.workspace_id), {
      periodStart: a.period_start ? new Date(String(a.period_start)) : undefined,
      periodEnd: a.period_end ? new Date(String(a.period_end)) : undefined,
    }));
  }

  if (name === "traces_hot_paths") {
    return text(await getHotPaths(sql, String(a.workspace_id), {
      limit: a.limit ? Number(a.limit) : undefined,
      periodStart: a.period_start ? new Date(String(a.period_start)) : undefined,
      periodEnd: a.period_end ? new Date(String(a.period_end)) : undefined,
    }));
  }

  if (name === "traces_critical_path") {
    return text(await getCriticalPath(sql, String(a.workspace_id), String(a.trace_id)));
  }

  if (name === "traces_compare") {
    const result = await compare_traces(sql, String(a.trace_id_a), String(a.trace_id_b));
    if (!result) return text({ error: "One or both traces not found" });
    return text(result);
  }

  if (name === "traces_get_timeline") {
    const result = await get_trace_timeline(sql, String(a.id));
    if (!result) return text({ error: "Trace not found" });
    return text(result);
  }

  if (name === "traces_add_span_tag") {
    return text(await add_span_tag(sql, String(a.span_id), String(a.key), String(a.value)));
  }

  if (name === "traces_get_span_tags") {
    return text(await get_span_tags(sql, String(a.span_id)));
  }

  if (name === "traces_delete_span_tag") {
    const deleted = await delete_span_tag(sql, String(a.span_id), String(a.key));
    return text({ deleted });
  }

  if (name === "traces_add_span_annotation") {
    return text(await add_span_annotation(
      sql,
      String(a.span_id),
      String(a.text),
      a.timestamp ? new Date(String(a.timestamp)) : undefined,
    ));
  }

  if (name === "traces_get_span_annotations") {
    return text(await get_span_annotations(sql, String(a.span_id)));
  }

  // Sampling handlers
  if (name === "traces_upsert_sampling_policy") {
    return text(await upsertSamplingPolicy(sql, {
      workspace_id: a.workspace_id ? String(a.workspace_id) : undefined,
      name: String(a.name),
      type: String(a.type),
      rate: Number(a.rate),
      span_types: a.span_types,
      threshold_ms: a.threshold_ms ? Number(a.threshold_ms) : undefined,
      threshold_usd: a.threshold_usd ? Number(a.threshold_usd) : undefined,
      enabled: a.enabled,
      priority: a.priority ? Number(a.priority) : undefined,
    }));
  }

  if (name === "traces_list_sampling_policies") {
    return text(await listSamplingPolicies(sql, a.workspace_id ? String(a.workspace_id) : undefined));
  }

  if (name === "traces_delete_sampling_policy") {
    return text({ deleted: await deleteSamplingPolicy(sql, String(a.id)) });
  }

  if (name === "traces_should_sample") {
    return text(await shouldSample(
      sql,
      String(a.workspace_id),
      a.span_type ? String(a.span_type) : undefined,
    ));
  }

  // Correlation handlers
  if (name === "traces_link_trace") {
    return text(await linkTrace(sql, {
      trace_id: String(a.trace_id),
      session_id: a.session_id ? String(a.session_id) : undefined,
      user_id: a.user_id ? String(a.user_id) : undefined,
      external_request_id: a.external_request_id ? String(a.external_request_id) : undefined,
      external_trace_id: a.external_trace_id ? String(a.external_trace_id) : undefined,
    }));
  }

  if (name === "traces_get_by_session") {
    return text(await getTracesBySession(sql, String(a.session_id), a.limit ? Number(a.limit) : 50));
  }

  if (name === "traces_get_by_user") {
    return text(await getTracesByUser(sql, String(a.user_id), a.limit ? Number(a.limit) : 50));
  }

  if (name === "traces_get_by_external_request_id") {
    return text(await getTraceByExternalRequestId(sql, String(a.external_request_id)));
  }

  // Retention handlers
  if (name === "traces_upsert_retention_policy") {
    return text(await upsertRetentionPolicy(sql, {
      workspace_id: a.workspace_id ? String(a.workspace_id) : undefined,
      name: String(a.name),
      type: String(a.type),
      days: a.days ? Number(a.days) : undefined,
      max_count: a.max_count ? Number(a.max_count) : undefined,
      enabled: a.enabled,
    }));
  }

  if (name === "traces_list_retention_policies") {
    return text(await listRetentionPolicies(sql, a.workspace_id ? String(a.workspace_id) : undefined));
  }

  if (name === "traces_run_retention") {
    return text(await runRetentionPolicies(sql, String(a.workspace_id)));
  }

  if (name === "traces_retention_stats") {
    return text(await getRetentionStats(sql, String(a.workspace_id)));
  }

  // Grafana dashboard handler
  if (name === "traces_generate_grafana_dashboard") {
    return text(generateGrafanaDashboard({
      workspaceId: String(a.workspace_id),
      title: a.title ? String(a.title) : undefined,
      uid: a.uid ? String(a.uid) : undefined,
      refreshInterval: a.refresh_interval ? String(a.refresh_interval) : undefined,
    }));
  }

  // Trace analytics handlers
  if (name === "traces_latency_percentiles") {
    return text(await getTraceLatencyPercentiles(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

  if (name === "traces_error_rate_timeline") {
    return text(await getErrorRateTimeline(
      sql,
      String(a.workspace_id),
      {
        since: a.since ? new Date(String(a.since)) : undefined,
        bucketMinutes: a.bucket_minutes ? Number(a.bucket_minutes) : undefined,
      },
    ));
  }

  if (name === "traces_latency_histogram") {
    return text(await getTraceDurationHistogram(
      sql,
      String(a.workspace_id),
      {
        since: a.since ? new Date(String(a.since)) : undefined,
        bucketCount: a.bucket_count ? Number(a.bucket_count) : undefined,
      },
    ));
  }

  if (name === "traces_flame_graph") {
    const result = await buildTraceFlameGraph(sql, String(a.trace_id));
    if (!result) return text({ error: "Trace not found" });
    return text(result);
  }

  if (name === "traces_time_series") {
    return text(await getTraceTimeSeries(
      sql,
      String(a.workspace_id),
      {
        since: a.since ? new Date(String(a.since)) : undefined,
        bucketMinutes: a.bucket_minutes ? Number(a.bucket_minutes) : undefined,
      },
    ));
  }

  // Sampling analytics handlers
  if (name === "traces_record_sampling_decision") {
    await recordSamplingDecision(sql, {
      traceId: a.trace_id ? String(a.trace_id) : undefined,
      workspaceId: String(a.workspace_id),
      policyId: a.policy_id ? String(a.policy_id) : undefined,
      policyName: a.policy_name ? String(a.policy_name) : undefined,
      policyType: String(a.policy_type),
      decision: a.decision as "sampled" | "dropped",
      reason: String(a.reason),
    });
    return text({ ok: true });
  }

  if (name === "traces_sampling_stats") {
    return text(await getSamplingStats(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

  if (name === "traces_list_sampling_decisions") {
    return text(await listSamplingDecisions(
      sql,
      String(a.workspace_id),
      {
        limit: a.limit ? Number(a.limit) : undefined,
        offset: a.offset ? Number(a.offset) : undefined,
        decision: a.decision as "sampled" | "dropped" | undefined,
        since: a.since ? new Date(String(a.since)) : undefined,
      },
    ));
  }

  if (name === "traces_evaluate_sampling") {
    return text(await evaluateSampling(
      sql,
      String(a.workspace_id),
      { spanType: a.span_type ? String(a.span_type) : undefined },
    ));
  }

  if (name === "traces_bulk_evaluate_sampling") {
    return text(await bulkEvaluateSampling(sql, a.trace_ids as string[]));
  }

  if (name === "traces_overall_sampling_rate") {
    return text(await getOverallSamplingRate(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

  // Prometheus export handlers
  if (name === "traces_export_prometheus_text") {
    const metrics = await exportPrometheusMetrics(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    );
    return { content: [{ type: "text", text: toPrometheusTextFormat(metrics.metrics) }] };
  }

  if (name === "traces_prometheus_metrics") {
    return text(await exportPrometheusMetrics(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

  if (name === "traces_get_count_gauge") {
    return text(await getTraceCountGauge(sql, String(a.workspace_id)));
  }

  if (name === "traces_get_error_rate_gauge") {
    return text(await getErrorRateGauge(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

  if (name === "traces_get_span_type_metrics") {
    return text(await getSpanTypeMetrics(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

  // Datadog export handlers
  if (name === "traces_export_datadog") {
    const { getTrace } = await import("../lib/query.js");
    const trace = await getTrace(sql, String(a.id));
    if (!trace) return text({ error: "Trace not found" });
    const spans = exportTraceAsDatadog(trace, { serviceName: a.service_name ? String(a.service_name) : undefined });
    return text({ trace_id: a.id, spans });
  }

  if (name === "traces_datadog_stats") {
    return text(await getDatadogStatsForWorkspace(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

  // Anomaly detection handlers
  if (name === "traces_refresh_anomaly_baselines") {
    await refreshAllBaselines(sql, String(a.workspace_id));
    return text({ ok: true, message: "Baselines refreshed for all span types" });
  }

  if (name === "traces_detect_anomalies") {
    return text(await detectSpanAnomalies(
      sql,
      String(a.workspace_id),
      {
        since: a.since ? new Date(String(a.since)) : undefined,
        minScore: a.min_score ? Number(a.min_score) : undefined,
        spanTypes: a.span_types,
        limit: a.limit ? Number(a.limit) : undefined,
      },
    ));
  }

  if (name === "traces_anomaly_summary") {
    return text(await getAnomalySummary(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

  // Period comparison handlers
  if (name === "traces_compare_periods") {
    return text(await comparePeriods(
      sql,
      String(a.workspace_id),
      new Date(String(a.current_start)),
      new Date(String(a.current_end)),
      new Date(String(a.previous_start)),
      new Date(String(a.previous_end)),
    ));
  }

  if (name === "traces_compare_week_over_week") {
    return text(await compareWeekOverWeek(
      sql,
      String(a.workspace_id),
      a.week_end_date ? new Date(String(a.week_end_date)) : undefined,
    ));
  }

  if (name === "traces_compare_month_over_month") {
    return text(await compareMonthOverMonth(
      sql,
      String(a.workspace_id),
      a.month_end_date ? new Date(String(a.month_end_date)) : undefined,
    ));
  }

  // Trace diff summary
  if (name === "traces_diff_summary") {
    const summary = await getTraceDiffSummary(sql, String(a.trace_id_a), String(a.trace_id_b));
    return text({ summary });
  }

  // Span latency trend
  if (name === "traces_latency_trend") {
    return text(await getSpanLatencyTrend(sql, String(a.workspace_id), {
      intervalMinutes: a.interval_minutes ? Number(a.interval_minutes) : 60,
      periodStart: a.period_start ? new Date(String(a.period_start)) : undefined,
      periodEnd: a.period_end ? new Date(String(a.period_end)) : undefined,
      operationName: a.operation_name ? String(a.operation_name) : undefined,
      spanType: a.span_type ? String(a.span_type) : undefined,
    }));
  }

  // Compare latency between two periods
  if (name === "traces_latency_comparison") {
    return text(await compareLatencyBetweenPeriods(sql, String(a.workspace_id), {
      periodAStart: new Date(String(a.period_a_start)),
      periodAEnd: new Date(String(a.period_a_end)),
      periodBStart: new Date(String(a.period_b_start)),
      periodBEnd: new Date(String(a.period_b_end)),
      operationName: a.operation_name ? String(a.operation_name) : undefined,
      spanType: a.span_type ? String(a.span_type) : undefined,
    }));
  }

  // Export trace as HTML
  if (name === "traces_export_html") {
    const html = await exportTraceAsHTML(sql, String(a.trace_id));
    if (!html) return text({ error: "Trace not found" });
    return text({ html });
  }

  // Sampling — should keep trace
  if (name === "traces_should_keep_trace") {
    const result = await shouldKeepTrace(sql, String(a.workspace_id), String(a.trace_id));
    return text({ should_keep: result });
  }

  // Correlation — get traces by external trace ID
  if (name === "traces_get_by_external_trace_id") {
    const traces = await getTracesByExternalTraceId(sql, String(a.external_trace_id));
    return text({ traces });
  }

  // Retention — delete a retention policy
  if (name === "traces_delete_retention_policy") {
    await deleteRetentionPolicy(sql, String(a.workspace_id), String(a.name));
    return text({ deleted: true });
  }

  // Retention — prune by TTL
  if (name === "traces_prune_by_ttl") {
    const pruned = await pruneByTTL(sql, String(a.workspace_id));
    return text({ pruned });
  }

  // Retention — prune by count
  if (name === "traces_prune_by_count") {
    const pruned = await pruneByCount(sql, String(a.workspace_id), Number(a.keep_count));
    return text({ pruned });
  }

  // Span anomaly — refresh baseline for a span type
  if (name === "traces_refresh_span_baseline") {
    await refreshAnomalyBaseline(sql, String(a.workspace_id), String(a.span_type));
    return text({ refreshed: true });
  }

  // Span anomaly — get baseline for a span type
  if (name === "traces_get_span_type_baseline") {
    const baseline = await getSpanTypeBaseline(sql, String(a.workspace_id), String(a.span_type));
    return text(baseline || { error: "Baseline not found" });
  }

  // Trace analytics — build flame graph from raw spans
  if (name === "traces_build_flame_graph") {
    const graph = await buildFlameGraph(a.spans as any[]);
    return text({ flame_graph: graph });
  }

  // Query — list spans for a trace
  if (name === "traces_list_spans") {
    const spans = await listSpans(sql, String(a.trace_id), {
      type: a.type ? String(a.type) : undefined,
      status: a.status ? String(a.status) : undefined,
    });
    return text({ spans });
  }

  // Query — build a span tree from flat spans
  if (name === "traces_build_span_tree") {
    const tree = buildSpanTree(a.spans as any[]);
    return text({ tree });
  }

  // Analytics — upsert span analytics for a trace
  if (name === "traces_upsert_span_analytics") {
    await upsertSpanAnalytics(sql, String(a.trace_id), String(a.workspace_id));
    return text({ ok: true });
  }

  // Stats — compute error rate percentage (pure function)
  if (name === "traces_compute_error_rate") {
    const rate = computeErrorRate(Number(a.errored), Number(a.total));
    return text({ error_rate_pct: rate });
  }

  // Stats — compute percentile from sorted array (pure function)
  if (name === "traces_compute_percentile") {
    const sorted = (a.sorted as number[]).map(Number);
    const p = Number(a.p);
    const value = computePercentile(sorted, p);
    return text({ percentile: value });
  }

  // Export — export multiple traces as OpenTelemetry batch
  if (name === "traces_export_traces_otel") {
    const { getTrace } = await import("../lib/query.js");
    const traceIds = a.trace_ids ? Array.from(a.trace_ids as any).map(String) : undefined;
    let traces: any[] = [];

    if (traceIds && traceIds.length > 0) {
      for (const id of traceIds) {
        const t = await getTrace(sql, id);
        if (t) traces.push(t);
      }
    } else if (a.since) {
      const since = new Date(String(a.since));
      const allTraces = await listTraces(sql, String(a.workspace_id), { since });
      traces = allTraces;
    } else {
      traces = await listTraces(sql, String(a.workspace_id));
    }

    const otel = exportTracesAsOTel(traces);
    return text({ traces: traces.map(t => t.id), otel });
  }

  // Correlation — get correlation data for a trace
  if (name === "traces_get_correlation") {
    const correlation = await getCorrelation(sql, String(a.trace_id));
    return text(correlation || { error: "Correlation not found" });
  }

  // Dependency matrix — get full dependency matrix as structured JSON
  if (name === "traces_dependency_matrix_json") {
    const periodStart = a.period_start ? new Date(String(a.period_start)) : undefined;
    const periodEnd = a.period_end ? new Date(String(a.period_end)) : undefined;
    const matrix = await getSpanDependencyMatrix(sql, String(a.workspace_id), { periodStart, periodEnd });
    return text(matrix);
  }

  // Dependency matrix — identify bottleneck span types (hotspots)
  if (name === "traces_dependency_hotspot") {
    const periodStart = a.period_start ? new Date(String(a.period_start)) : undefined;
    const periodEnd = a.period_end ? new Date(String(a.period_end)) : undefined;
    const limit = a.limit ? Number(a.limit) : 10;
    const paths = await getHotPaths(sql, String(a.workspace_id), { periodStart, periodEnd, limit });
    // Compute impact score: calls * avg_duration_ms * (1 + error_rate/100)
    const hotspots = paths.map(p => ({
      ...p,
      impact_score: Number(p.call_count) * Number(p.avg_duration_ms) * (1 + Number(p.error_rate) / 100),
    }));
    hotspots.sort((a, b) => b.impact_score - a.impact_score);
    return text(hotspots);
  }

  // Flame graph — build flame graph from a trace ID
  if (name === "traces_flame_graph_for_trace") {
    const flameGraph = await buildTraceFlameGraph(sql, String(a.trace_id));
    if (!flameGraph) return text({ error: "Trace not found" });
    return text(flameGraph);
  }

  // Export — export trace as DOT (Graphviz) format
  if (name === "traces_export_dot") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) return text({ error: "Trace not found" });
    const direction = String(a.direction || "TB");
    const lines: string[] = [
      `digraph trace_${trace.id.replace(/[^a-zA-Z0-9]/g, "_")} {`,
      `  rankdir=${direction};`,
      `  label="Trace: ${trace.name}";`,
      `  labelloc="t";`,
      `  fontsize="14";`,
    ];
    for (const span of trace.spans) {
      const label = `${span.name}\\n(${span.type})\\n${span.duration_ms}ms`;
      const color = span.status === "error" ? "red" : span.status === "completed" ? "green" : "gray";
      lines.push(`  "${span.id}" [label="${label}" color=${color}];`);
    }
    for (const span of trace.spans) {
      if (span.parent_span_id) {
        lines.push(`  "${span.parent_span_id}" -> "${span.id}";`);
      }
    }
    lines.push("}");
    return text(lines.join("\n"));
  }

  // Trace timeline — flat list of spans with timing offsets for UI rendering
  if (name === "traces_get_trace_timeline") {
    const { get_trace_timeline } = await import("../lib/compare.js");
    return text(await get_trace_timeline(sql, String(a.trace_id)));
  }

  // Critical path — longest chain of dependent spans (hot path analysis)
  if (name === "traces_get_critical_path") {
    const { getCriticalPath } = await import("../lib/span-dependency-matrix.js");
    return text(await getCriticalPath(sql, String(a.workspace_id), a.trace_id ? String(a.trace_id) : undefined));
  }

  // Trace export as HTML — self-contained debug page for a single trace
  if (name === "traces_export_trace_as_html") {
    const { exportTraceAsHTML } = await import("../lib/trace-session-export.js");
    return text(await exportTraceAsHTML(sql, String(a.trace_id)));
  }

  // Analytics — full workspace analytics summary
  if (name === "traces_workspace_analytics") {
    return text(await getWorkspaceAnalytics(sql, String(a.workspace_id), {
      periodStart: a.period_start ? new Date(String(a.period_start)) : undefined,
      periodEnd: a.period_end ? new Date(String(a.period_end)) : undefined,
    }));
  }

  // Analytics — cost breakdown by span type
  if (name === "traces_cost_breakdown") {
    return text(await getCostBreakdown(sql, String(a.workspace_id), {
      periodStart: a.period_start ? new Date(String(a.period_start)) : undefined,
      periodEnd: a.period_end ? new Date(String(a.period_end)) : undefined,
    }));
  }

  // Analytics — latency histogram for a span type
  if (name === "traces_latency_histogram_for_type") {
    return text(await getLatencyHistogram(sql, String(a.workspace_id), String(a.span_type), {
      buckets: a.buckets ? Number(a.buckets) : undefined,
      periodStart: a.period_start ? new Date(String(a.period_start)) : undefined,
      periodEnd: a.period_end ? new Date(String(a.period_end)) : undefined,
    }));
  }

  // Comparison — structured trace diff
  if (name === "traces_trace_diff") {
    const { compare_traces } = await import("../lib/compare.js");
    const result = await compare_traces(sql, String(a.trace_id_a), String(a.trace_id_b));
    if (!result) return text({ error: "One or both traces not found" });
    return text(result);
  }

  // Period comparison — arbitrary window comparison (uses existing comparePeriods)
  if (name === "traces_compare_periods") {
    return text(await comparePeriods(
      sql,
      String(a.workspace_id),
      new Date(String(a.current_start)),
      new Date(String(a.current_end)),
      new Date(String(a.previous_start)),
      new Date(String(a.previous_end)),
    ));
  }

  // Export — single trace as OpenTelemetry JSON
  if (name === "traces_export_trace_otel") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) return text({ error: "Trace not found" });
    return text(exportTraceAsOTel(trace));
  }

  // Export — single trace as Zipkin JSON
  if (name === "traces_export_trace_zipkin") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) return text({ error: "Trace not found" });
    return text(exportTraceAsZipkin(trace));
  }

  // Export — single trace as Jaeger JSON
  if (name === "traces_export_trace_jaeger") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) return text({ error: "Trace not found" });
    return text(exportTraceAsJaeger(trace));
  }

  // Export — Grafana dashboard JSON for a workspace
  if (name === "traces_grafana_dashboard_json") {
    return text(generateGrafanaDashboard({
      workspaceId: String(a.workspace_id),
      title: a.title ? String(a.title) : undefined,
      uid: a.uid ? String(a.uid) : undefined,
      refreshInterval: a.refresh_interval ? String(a.refresh_interval) : undefined,
    }));
  }

  // ── Gap tool handlers ────────────────────────────────────────────────────────

  // traces_multi_format_export — export a trace in all formats at once
  if (name === "traces_multi_format_export") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) return text({ error: "Trace not found" });
    const formats: string[] = a.formats ?? ["otlp", "zipkin", "jaeger", "datadog", "html"];
    const result: Record<string, unknown> = {};
    if (formats.includes("otlp")) result.otlp = exportTraceAsOTel(trace);
    if (formats.includes("zipkin")) result.zipkin = exportTraceAsZipkin(trace);
    if (formats.includes("jaeger")) result.jaeger = exportTraceAsJaeger(trace);
    if (formats.includes("datadog")) result.datadog = exportTraceAsDatadog(trace, { serviceName: "hasna-agent" });
    if (formats.includes("html")) {
      const { exportTraceAsHTML } = await import("../lib/trace-session-export.js");
      result.html = await exportTraceAsHTML(sql, String(a.trace_id));
    }
    return text(result);
  }

  // traces_get_trace_events — flat timestamped event sequence for waterfall UIs
  if (name === "traces_get_trace_events") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) return text({ error: "Trace not found" });
    const traceStartMs = new Date(trace.started_at).getTime();
    const events = trace.spans.map((s) => ({
      span_id: s.id,
      parent_span_id: s.parent_span_id,
      name: s.name,
      type: s.type,
      status: s.status,
      start_offset_ms: Math.max(0, new Date(s.started_at).getTime() - traceStartMs),
      end_offset_ms: s.ended_at ? Math.max(0, new Date(s.ended_at).getTime() - traceStartMs) : null,
      duration_ms: s.duration_ms,
      error: s.error ?? null,
      tokens_in: s.tokens_in ?? null,
      tokens_out: s.tokens_out ?? null,
      cost_usd: s.cost_usd ?? null,
    }));
    return text({ trace_id: trace.id, trace_name: trace.name, started_at: trace.started_at, total_events: events.length, events });
  }

  // traces_suggest_retention_policy — heuristic retention suggestion
  if (name === "traces_suggest_retention_policy") {
    const since7d = new Date(Date.now() - 7 * 86400000);
    const [row] = await sql<{ total_traces: string; total_spans: string; avg_spans: string; p95_dur_ms: string; traces_90p: string }[]>`
      SELECT
        COUNT(*)::text AS total_traces,
        COALESCE(SUM(s.count), 0)::text AS total_spans,
        ROUND(AVG(s.count)::numeric, 1) AS avg_spans,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY t.total_duration_ms) AS p95_dur_ms,
        PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY t.started_at) AS traces_90p
      FROM traces.traces t
      LEFT JOIN LATERAL (SELECT COUNT(*) AS count FROM traces.spans sp WHERE sp.trace_id = t.id) s ON true
      WHERE t.workspace_id = ${String(a.workspace_id)} AND t.started_at >= ${since7d}
    `;
    const targetGb = Number(a.target_storage_gb ?? 10);
    const traceCount = parseInt(row?.total_traces ?? "0", 10);
    const avgSpans = parseFloat(row?.avg_spans ?? "0");
    // Estimate ~2KB per span, ~500B per trace header
    const bytesPerSpan = 2 * 1024;
    const bytesPerTrace = 512;
    const estimatedGbPerDay = (traceCount * (avgSpans * bytesPerSpan + bytesPerTrace)) / (1024 ** 3);
    // Conservative: keep 30 days if < 5GB/mo, else 7 days
    const suggested_ttl_days = estimatedGbPerDay * 30 < targetGb ? 30 : 7;
    // Suggest max_count = traces_per_day * suggested_ttl_days * 1.5 (safety margin)
    const tracesPerDay = traceCount / 7;
    const suggested_max_count = Math.round(tracesPerDay * suggested_ttl_days * 1.5);
    return text({
      workspace_id: a.workspace_id,
      analysis_period_days: 7,
      estimated_traces_per_day: Math.round(tracesPerDay * 10) / 10,
      estimated_storage_gb_per_month: Math.round(estimatedGbPerDay * 30 * 100) / 100,
      suggested_ttl_days,
      suggested_max_count,
      target_storage_gb: targetGb,
      rationale: estimatedGbPerDay * 30 < targetGb
        ? `Your ~${Math.round(estimatedGbPerDay * 30 * 100) / 100} GB/mo usage is within ${targetGb} GB budget — recommend 30-day TTL`
        : `Your ~${Math.round(estimatedGbPerDay * 30 * 100) / 100} GB/mo exceeds ${targetGb} GB budget — recommend 7-day TTL or reduce max_count`,
    });
  }

  // traces_detect_span_gaps — orphaned child spans with missing parents
  if (name === "traces_detect_span_gaps") {
    const since = a.since ? new Date(String(a.since)) : new Date(Date.now() - 24 * 3600000);
    const limit = Number(a.limit ?? 50);
    const gaps = await sql<any[]>`
      SELECT
        s.id AS child_span_id,
        s.trace_id,
        s.name AS child_name,
        s.type AS child_type,
        s.parent_span_id AS missing_parent_id,
        s.started_at
      FROM traces.spans s
      JOIN traces.traces t ON t.id = s.trace_id
      WHERE t.workspace_id = ${String(a.workspace_id)}
        AND t.started_at >= ${since}
        AND s.parent_span_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM traces.spans p WHERE p.id = s.parent_span_id AND p.trace_id = s.trace_id
        )
      ORDER BY s.started_at DESC
      LIMIT ${limit}
    `;
    return text({
      workspace_id: a.workspace_id,
      period_start: since.toISOString(),
      gaps_found: gaps.length,
      gaps: gaps.map(g => ({
        child_span_id: g.child_span_id,
        trace_id: g.trace_id,
        child_name: g.child_name,
        child_type: g.child_type,
        missing_parent_id: g.missing_parent_id,
        started_at: g.started_at,
      })),
    });
  }

  // traces_span_type_summary — lightweight span type overview
  if (name === "traces_span_type_summary") {
    const since = a.since ? new Date(String(a.since)) : new Date(Date.now() - 24 * 3600000);
    const rows = await sql<any[]>`
      SELECT
        s.type,
        COUNT(*)::int AS total_spans,
        COUNT(*) FILTER (WHERE s.status = 'error')::int AS error_count,
        ROUND(COUNT(*) FILTER (WHERE s.status = 'error')::numeric / NULLIF(COUNT(*), 0) * 100, 2) AS error_rate,
        COALESCE(SUM(s.tokens_in), 0)::bigint AS total_tokens_in,
        COALESCE(SUM(s.tokens_out), 0)::bigint AS total_tokens_out,
        ROUND(COALESCE(AVG(s.duration_ms), 0)::numeric, 2) AS avg_duration_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY s.duration_ms) AS p95_duration_ms
      FROM traces.spans s
      JOIN traces.traces t ON t.id = s.trace_id
      WHERE t.workspace_id = ${String(a.workspace_id)} AND t.started_at >= ${since}
      GROUP BY s.type
      ORDER BY total_spans DESC
    `;
    return text({
      workspace_id: a.workspace_id,
      period_start: since.toISOString(),
      summary: rows.map(r => ({
        span_type: r.type,
        total_spans: r.total_spans,
        error_count: r.error_count,
        error_rate_pct: parseFloat(r.error_rate),
        total_tokens_in: Number(r.total_tokens_in),
        total_tokens_out: Number(r.total_tokens_out),
        avg_duration_ms: parseFloat(r.avg_duration_ms),
        p95_duration_ms: parseFloat(r.p95_duration_ms),
      })),
    });
  }

  // traces_ingest_otlp — ingest traces from external OTel agents
  if (name === "traces_ingest_otlp") {
    const result = await ingestOtelTraces(sql, String(a.workspace_id), a.otlp_json);
    return text(result);
  }

  // traces_export_flame_speedscope — export flame graph as Speedscope JSON
  if (name === "traces_export_flame_speedscope") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) throw new Error(`Trace not found: ${a.trace_id}`);
    const tree = await getTraceTree(sql, String(a.workspace_id), String(a.trace_id));
    const profile = exportTraceFlameGraphAsSpeedscope(tree);
    return text({ format: "speedscope", trace_id: a.trace_id, profile });
  }

  // traces_export_flame_collapsed_stack — export flame graph as collapsed stack format
  if (name === "traces_export_flame_collapsed_stack") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) throw new Error(`Trace not found: ${a.trace_id}`);
    const tree = await getTraceTree(sql, String(a.workspace_id), String(a.trace_id));
    const lines = exportFlameGraphAsCollapsedStack(tree, a.value_field || "duration_ms");
    return text({ format: "collapsed_stack", trace_id: a.trace_id, lines });
  }

  // traces_analyze_root_cause — AI-powered root cause analysis
  if (name === "traces_analyze_root_cause") {
    const result = await analyzeTraceRootCause(sql, String(a.trace_id), String(a.workspace_id));
    return text(result);
  }

  // traces_explain_anomaly — explain why a trace is anomalous
  if (name === "traces_explain_anomaly") {
    const result = await explainTraceAnomaly(sql, String(a.trace_id), String(a.workspace_id), a.baseline_hours || 24);
    return text(result);
  }

  // traces_self_healing_suggestions — get configuration improvement suggestions
  if (name === "traces_self_healing_suggestions") {
    const suggestions = await getTraceSelfHealingSuggestions(sql, String(a.trace_id), String(a.workspace_id));
    return text({ trace_id: a.trace_id, suggestions });
  }

  // traces_compare_multi — compare stats across multiple workspaces
  if (name === "traces_compare_multi") {
    const ids = (a.workspace_ids as string[]).slice(0, 10);
    const fromDate = a.from_date ? new Date(a.from_date) : new Date(Date.now() - 7 * 86400000);
    const toDate = a.to_date ? new Date(a.to_date) : new Date();
    const results = await Promise.all(ids.map(async (wid) => {
      const stats = await getTraceStats(sql, wid, fromDate);
      return { workspace_id: wid, ...stats };
    }));
    return text({ workspaces: results, from: fromDate.toISOString(), to: toDate.toISOString() });
  }

  // traces_get_traces_by_user — get all traces for a user
  if (name === "traces_get_traces_by_user") {
    const traces = await getTracesByUser(sql, String(a.user_id), a.limit ? Number(a.limit) : 50);
    return text({ user_id: a.user_id, traces });
  }

  // traces_get_traces_by_external_trace_id — get traces by external trace ID
  if (name === "traces_get_traces_by_external_trace_id") {
    const traces = await getTracesByExternalTraceId(sql, String(a.external_trace_id), a.limit ? Number(a.limit) : 50);
    return text({ external_trace_id: a.external_trace_id, traces });
  }

  // traces_get_trace_score — compute health score for a trace
  if (name === "traces_get_trace_score") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) throw new Error(`Trace not found: ${a.trace_id}`);
    const tree = await getTraceTree(sql, String(a.workspace_id), String(a.trace_id));
    const stats = await getTraceStats(sql, String(a.workspace_id), new Date(Date.now() - 7 * 86400000));
    const spanCount = tree ? tree.spans.length : 0;
    const errorCount = trace.error ? 1 : 0;
    // Score components (each 0-25, total 0-100)
    const latencyScore = trace.total_duration_ms && stats.p95_duration_ms
      ? Math.max(0, 25 - ((trace.total_duration_ms / stats.p95_duration_ms) - 1) * 25)
      : 25;
    const errorScore = errorCount === 0 ? 25 : errorCount === 1 ? 10 : 0;
    const costScore = trace.total_cost_usd && stats.avg_cost_usd
      ? Math.max(0, 25 - ((trace.total_cost_usd / Math.max(stats.avg_cost_usd, 0.0001)) - 1) * 25)
      : 25;
    const structureScore = spanCount > 0 && spanCount <= 100 ? 25 : spanCount > 100 ? 15 : 5;
    const total = Math.round(latencyScore + errorScore + costScore + structureScore);
    return text({
      trace_id: a.trace_id,
      score: total,
      grade: total >= 80 ? "healthy" : total >= 50 ? "degraded" : "critical",
      breakdown: { latency: Math.round(latencyScore), error: errorScore, cost: Math.round(costScore), structure: structureScore },
      details: { duration_ms: trace.total_duration_ms, cost_usd: trace.total_cost_usd, span_count: spanCount, is_error: !!trace.error },
    });
  }

  // traces_export_full_bundle — comprehensive debug bundle
  if (name === "traces_export_full_bundle") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) throw new Error(`Trace not found: ${a.trace_id}`);
    const bundle: any = {
      version: "1.0",
      exported_at: new Date().toISOString(),
      workspace_id: a.workspace_id,
      trace_id: a.trace_id,
      trace: {
        id: trace.id,
        name: trace.name,
        status: trace.status,
        started_at: trace.started_at,
        completed_at: trace.completed_at,
        duration_ms: trace.total_duration_ms,
        error: trace.error,
        total_tokens: trace.total_tokens,
        total_cost_usd: trace.total_cost_usd,
      },
    };
    if (a.include_spans !== false) {
      const tree = await getTraceTree(sql, String(a.workspace_id), String(a.trace_id));
      bundle.spans = tree?.spans ?? [];
      bundle.span_count = tree?.spans.length ?? 0;
    }
    if (a.include_flame_graph !== false) {
      const tree = await getTraceTree(sql, String(a.workspace_id), String(a.trace_id));
      if (tree?.spans) {
        const fg = buildFlameGraph(tree.spans);
        bundle.flame_graph = { nodes: fg, format: "collapsed_stack" };
      }
    }
    return text(bundle);
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  const sql = getDb();
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
