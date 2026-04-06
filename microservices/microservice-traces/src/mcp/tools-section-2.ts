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
