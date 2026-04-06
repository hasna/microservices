    // --- Session tags ---
    {
      name: "sessions_tag_session",
      description: "Add one or more tags to a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          created_by: { type: "string" },
        },
        required: ["session_id", "tags"],
      },
    },
    {
      name: "sessions_untag_session",
      description: "Remove a tag from a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          tag: { type: "string" },
        },
        required: ["session_id", "tag"],
      },
    },
    {
      name: "sessions_list_tags",
      description: "List all tags for a session",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_find_by_tag",
      description: "Find sessions with a given tag in a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          tag: { type: "string" },
          limit: { type: "number" },
        },
        required: ["workspace_id", "tag"],
      },
    },
    {
      name: "sessions_workspace_tags",
      description: "List all tags used in a workspace with usage counts",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
