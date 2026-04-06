// --- Auth audit log ---

server.tool(
  "auth_record_audit_event",
  "Record a single auth audit event",
  {
    event_type: z.string().describe("Event type string"),
    user_id: z.string().optional().describe("User UUID"),
    actor_id: z.string().optional().describe("Actor UUID (who performed the action)"),
    ip_address: z.string().optional().describe("IP address"),
    user_agent: z.string().optional().describe("User agent string"),
    resource_type: z.string().optional().describe("Resource type (e.g. api_key, session)"),
    resource_id: z.string().optional().describe("Resource ID"),
    metadata: z.record(z.any()).optional().describe("Additional event metadata"),
  },
  async (opts) => text(await recordAuditEvent(sql, {
    event_type: opts.event_type as AuditEventType,
    user_id: opts.user_id,
    actor_id: opts.actor_id,
    ip_address: opts.ip_address,
    user_agent: opts.user_agent,
    resource_type: opts.resource_type,
    resource_id: opts.resource_id,
    metadata: opts.metadata,
  })),
);

server.tool(
  "auth_query_audit_log",
  "Query audit log with filters",
  {
    user_id: z.string().optional().describe("Filter by user UUID"),
    event_type: z.string().optional().describe("Filter by event type"),
    resource_type: z.string().optional().describe("Filter by resource type"),
    resource_id: z.string().optional().describe("Filter by resource ID"),
    ip_address: z.string().optional().describe("Filter by IP address"),
    since: z.string().optional().describe("ISO date string"),
    until: z.string().optional().describe("ISO date string"),
    limit: z.number().int().positive().optional().default(100).describe("Max results"),
    offset: z.number().int().nonnegative().optional().default(0).describe("Offset"),
  },
  async (opts) => {
    const result = await queryAuditLog(sql, {
      user_id: opts.user_id,
      event_type: opts.event_type as AuditEventType | undefined,
      resource_type: opts.resource_type,
      resource_id: opts.resource_id,
      ip_address: opts.ip_address,
      since: opts.since ? new Date(opts.since) : undefined,
      until: opts.until ? new Date(opts.until) : undefined,
      limit: opts.limit,
      offset: opts.offset,
    });
    return text(result);
  },
);

server.tool(
  "auth_get_user_auth_summary",
  "Get authentication summary for a user",
  {
    user_id: z.string().describe("User UUID"),
    days: z.number().int().positive().optional().default(30).describe("Number of days to look back"),
  },
  async ({ user_id, days }) => text(await getUserAuthSummary(sql, user_id, days)),
);

server.tool(
  "auth_export_audit_log",
  "Export audit log as JSON or CSV",
  {
    user_id: z.string().optional().describe("Filter by user UUID"),
    event_type: z.string().optional().describe("Filter by event type"),
    since: z.string().optional().describe("ISO date string"),
    format: z.enum(["json", "csv"]).optional().default("json").describe("Export format"),
    limit: z.number().int().positive().optional().default(10000).describe("Max rows"),
  },
  async ({ user_id, event_type, since, format, limit }) =>
    text({ export: await exportAuditLog(sql, { user_id, event_type: event_type as AuditEventType | undefined, since: since ? new Date(since) : undefined, format, limit }) }),
);

