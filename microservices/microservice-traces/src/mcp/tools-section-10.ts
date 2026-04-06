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
