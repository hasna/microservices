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
