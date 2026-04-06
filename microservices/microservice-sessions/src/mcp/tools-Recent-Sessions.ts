    // ─── Recent Sessions ─────────────────────────────────────────────────────────
    {
      name: "sessions_list_recent",
      description: "List the most recently active sessions in a workspace, ordered by last message time",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_get_conversation_stats",
      description: "Get aggregate statistics for all conversations in a workspace — message counts, token totals, fork counts, and activity metrics",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          since: { type: "string", description: "ISO date to filter from" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_search_shared",
      description: "Search sessions shared with a specific user or team — finds sessions where the user has viewer/commenter/editor access",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          query: { type: "string" },
          role: { type: "string", enum: ["viewer", "commenter", "editor", "admin"] },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["workspace_id", "user_id"],
      },
    },
    {
      name: "sessions_get_activity_overview",
      description: "Get an activity overview for a workspace — messages per day, active sessions, top users by volume, for a given time window",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          days: { type: "number", description: "Number of days to look back (default: 30)" },
          user_id: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "sessions_link_external",
      description: "Link a session to an external service ID (e.g., a traces trace_id, knowledge document_id). Enables cross-service correlation for unified debugging.",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string", description: "Session/conversation ID" },
          external_service: { type: "string", description: "External service name (e.g., traces, knowledge, memory)" },
          external_id: { type: "string", description: "External ID to link (e.g., trace_id, document_id)" },
          link_type: { type: "string", description: "Link type (e.g., related, caused_by, parent). Default: related" },
          metadata: { type: "object", description: "Additional metadata for the link" },
        },
        required: ["conversation_id", "external_service", "external_id"],
      },
    },
    {
      name: "sessions_get_links",
      description: "Get all external links for a session",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string", description: "Session/conversation ID" },
        },
        required: ["conversation_id"],
      },
    },
    {
      name: "sessions_get_by_external_id",
      description: "Find sessions linked to a specific external ID (e.g., find all sessions related to a trace)",
      inputSchema: {
        type: "object",
        properties: {
          external_service: { type: "string", description: "External service name" },
          external_id: { type: "string", description: "External ID" },
        },
        required: ["external_service", "external_id"],
      },
    },
    {
      name: "sessions_delete_link",
      description: "Delete a session link by ID",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Link ID to delete" },
        },
        required: ["id"],
      },
    },
    {
      name: "sessions_delete_all_links",
      description: "Delete all external links for a session",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string", description: "Session/conversation ID" },
        },
        required: ["conversation_id"],
      },
    },
    // Session replay export
    {
      name: "sessions_export_replay",
      description: "Export a session in replayable JSON format with full context (messages, metadata, lineage, annotations) for debugging or replay",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string", description: "Session/conversation ID" },
        },
        required: ["conversation_id"],
      },
    },
    {
      name: "sessions_export_diff",
      description: "Export the diff between two sessions showing what messages are new or changed",
      inputSchema: {
        type: "object",
        properties: {
          base_session_id: { type: "string", description: "Base session ID to compare from" },
          compare_session_id: { type: "string", description: "Session ID to compare to" },
        },
        required: ["base_session_id", "compare_session_id"],
      },
    },
    {
      name: "sessions_export_archive",
      description: "Export multiple sessions in a batch archive format",
      inputSchema: {
        type: "object",
        properties: {
          conversation_ids: { type: "array", items: { type: "string" }, description: "Array of session IDs to include in archive" },
        },
        required: ["conversation_ids"],
      },
    },

