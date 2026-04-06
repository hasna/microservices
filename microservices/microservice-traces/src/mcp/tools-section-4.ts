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
