    // ─── Auto summarization ────────────────────────────────────────────────────
    {
      name: "sessions_get_sessions_needing_summarization",
      description: "Find sessions approaching their context window limit that would benefit from auto-summarization",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          min_tokens: { type: "number", description: "Minimum token count to include (default 3000)" },
          limit: { type: "number", description: "Max sessions to return (default 20)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_process_auto_summarization",
      description: "Run auto-summarization on sessions that need it, up to a batch limit",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          batch_limit: { type: "number", description: "Max sessions to summarize in this run (default 10)" },
          min_tokens: { type: "number", description: "Minimum token threshold (default 3000)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_get_context_window_fill",
      description: "Get the current token fill percentage for a session's context window",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          max_tokens: { type: "number", description: "Override max tokens for model (default auto-detect)" },
        },
        required: ["session_id"],
      },
    },

