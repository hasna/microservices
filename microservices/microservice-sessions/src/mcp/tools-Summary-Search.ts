    // ─── Summary Search ──────────────────────────────────────────────────────────
    {
      name: "sessions_search_summaries",
      description: "Full-text search across stored session summaries — helps discover sessions by what was summarized about them",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          query: { type: "string" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["workspace_id", "query"],
      },
    },

