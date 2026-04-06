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
