    // ─── Session Merge ────────────────────────────────────────────────────────────
    {
      name: "sessions_three_way_merge",
      description: "Perform a 3-way merge combining changes from two sessions into a new session",
      inputSchema: {
        type: "object",
        properties: {
          source_session_id: { type: "string" },
          target_session_id: { type: "string" },
          ancestor_session_id: { type: "string" },
          new_session_title: { type: "string" },
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          conflict_strategy: { type: "string", enum: ["source_wins", "target_wins", "keep_both", "skip"] },
          archive_source: { type: "boolean" },
          archive_target: { type: "boolean" },
        },
        required: ["source_session_id", "target_session_id", "ancestor_session_id"],
      },
    },

