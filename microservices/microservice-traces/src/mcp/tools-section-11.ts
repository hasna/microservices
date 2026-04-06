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
