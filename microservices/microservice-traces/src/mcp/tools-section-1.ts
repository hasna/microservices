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
