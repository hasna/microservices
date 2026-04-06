// --- Session forensics ---

server.tool(
  "auth_session_history",
  "Get recent authentication events for a user",
  {
    user_id: z.string(),
    limit: z.number().optional().default(20),
    event_type: z.string().optional(),
  },
  async ({ user_id, limit, event_type }) =>
    text(await getRecentAuthEvents(sql, user_id, { limit, event_type })),
);

server.tool(
  "auth_get_active_sessions",
  "Get all active sessions with metadata (no tokens exposed)",
  { user_id: z.string() },
  async ({ user_id }) => text(await getActiveSessions(sql, user_id)),
);

server.tool(
  "auth_record_login_event",
  "Record an authentication event for forensics",
  {
    user_id: z.string(),
    event_type: z.enum(["login_success", "login_failure", "logout", "token_refresh", "passkey_success"]),
    ip: z.string().optional(),
    user_agent: z.string().optional(),
    device_id: z.string().optional(),
    metadata: z.record(z.any()).optional(),
  },
  async ({ user_id, event_type, ip, user_agent, device_id, metadata }) => {
    await recordLoginEvent(sql, user_id, {
      event_type,
      ip,
      user_agent,
      device_id,
      metadata,
    });
    return text({ recorded: true });
  },
);

