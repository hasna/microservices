    // Correlation tools
    {
      name: "traces_link_trace",
      description: "Link a trace to a session, user, or external request ID",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string", description: "Trace ID" },
          session_id: { type: "string", description: "Session ID" },
          user_id: { type: "string", description: "User ID" },
          external_request_id: { type: "string", description: "External request ID (e.g. from API gateway)" },
          external_trace_id: { type: "string", description: "Cross-service trace ID" },
        },
        required: ["trace_id"],
      },
    },
    {
      name: "traces_get_by_session",
      description: "Get all traces for a given session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["session_id"],
      },
    },
    {
      name: "traces_get_by_user",
      description: "Get all traces for a given user",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["user_id"],
      },
    },
    {
      name: "traces_get_by_external_request_id",
      description: "Get a trace by external request ID",
      inputSchema: {
        type: "object",
        properties: {
          external_request_id: { type: "string" },
        },
        required: ["external_request_id"],
      },
    },
