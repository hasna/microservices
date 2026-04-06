    // --- Session bookmarks ---
    {
      name: "sessions_bookmark_message",
      description: "Bookmark a message within a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          message_id: { type: "string" },
          label: { type: "string" },
          note: { type: "string" },
          created_by: { type: "string" },
        },
        required: ["session_id", "message_id"],
      },
    },
    {
      name: "sessions_remove_bookmark",
      description: "Remove a bookmark from a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          message_id: { type: "string" },
        },
        required: ["session_id", "message_id"],
      },
    },
    {
      name: "sessions_list_bookmarks",
      description: "List all bookmarks in a session",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_is_message_bookmarked",
      description: "Check whether a specific message is bookmarked in a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          message_id: { type: "string" },
        },
        required: ["session_id", "message_id"],
      },
    },
    {
      name: "sessions_bookmark_count",
      description: "Count bookmarks in a session",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
      },
    },
