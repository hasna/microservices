    // ─── Bulk Pin ────────────────────────────────────────────────────────────────
    {
      name: "sessions_bulk_pin",
      description: "Pin multiple sessions at once so they are protected from auto-archival or deletion",
      inputSchema: {
        type: "object",
        properties: {
          session_ids: { type: "array", items: { type: "string" } },
        },
        required: ["session_ids"],
      },
    },

