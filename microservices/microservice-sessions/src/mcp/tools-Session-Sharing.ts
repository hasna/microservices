    // ─── Session Sharing ──────────────────────────────────────────────────────────
    {
      name: "sessions_share_session",
      description: "Share a session with a user or team with a specific role",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          share_type: { type: "string", enum: ["user", "team"] },
          principal_id: { type: "string" },
          role: { type: "string", enum: ["viewer", "commenter", "editor", "admin"] },
          shared_by: { type: "string" },
          expires_at: { type: "string", description: "ISO timestamp when share expires (optional)" },
          note: { type: "string", description: "Optional note about this share" },
        },
        required: ["session_id", "share_type", "principal_id", "role", "shared_by"],
      },
    },
    {
      name: "sessions_revoke_share",
      description: "Revoke a session share",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          share_type: { type: "string", enum: ["user", "team"] },
          principal_id: { type: "string" },
        },
        required: ["session_id", "share_type", "principal_id"],
      },
    },
    {
      name: "sessions_list_shares",
      description: "List all shares for a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
        },
        required: ["session_id"],
      },
    },
    {
      name: "sessions_list_shared_with_me",
      description: "List all sessions shared with the current user",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["user_id"],
      },
    },
    {
      name: "sessions_check_access",
      description: "Check if a principal has a given role on a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          principal_id: { type: "string" },
          principal_type: { type: "string", enum: ["user", "team"] },
          min_role: { type: "string", enum: ["viewer", "commenter", "editor", "admin"] },
        },
        required: ["session_id", "principal_id", "principal_type", "min_role"],
      },
    },
    {
      name: "sessions_bulk_share",
      description: "Bulk share a session with multiple users or teams",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          shares: {
            type: "array",
            items: {
              type: "object",
              properties: {
                share_type: { type: "string", enum: ["user", "team"] },
                principal_id: { type: "string" },
                role: { type: "string", enum: ["viewer", "commenter", "editor", "admin"] },
              },
              required: ["share_type", "principal_id", "role"],
            },
          },
          shared_by: { type: "string" },
        },
        required: ["session_id", "shares", "shared_by"],
      },
    },

