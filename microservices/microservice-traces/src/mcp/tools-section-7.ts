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
