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
