// ─── Suspicious Activity Detection ────────────────────────────────────────────

server.tool(
  "auth_record_suspicious_activity",
  "Record a detected suspicious auth activity",
  {
    user_id: z.string().optional().describe("Affected user ID"),
    workspace_id: z.string().optional().describe("Workspace ID"),
    activity_type: z.enum(["burst_logins", "geo_impossible", "many_failed_attempts",
      "unusual_hour", "password_spray", "credential_stuffing", "token_cloning", "permission_escalation"]),
    severity: z.enum(["low", "medium", "high", "critical"]),
    description: z.string().describe("Human-readable description of the activity"),
    ip_addresses: z.array(z.string()).optional(),
    metadata: z.record(z.any()).optional(),
  },
  async (opts) =>
    text(await recordSuspiciousActivity(sql, {
      userId: opts.user_id,
      workspaceId: opts.workspace_id,
      activityType: opts.activity_type,
      severity: opts.severity,
      description: opts.description,
      ipAddresses: opts.ip_addresses,
      metadata: opts.metadata,
    })),
);

server.tool(
  "auth_detect_burst_logins",
  "Detect burst logins — many successful logins in a short window (potential bot or token cloning)",
  {
    user_id: z.string().describe("User ID to check"),
    window_seconds: z.number().int().positive().optional().default(60),
    threshold: z.number().int().positive().optional().default(5),
  },
  async ({ user_id, window_seconds, threshold }) =>
    text(await detectBurstLogins(sql, user_id, { windowSeconds: window_seconds, threshold })),
);

server.tool(
  "auth_detect_password_spray",
  "Detect password spray attack — same IP attempting many different accounts",
  {
    ip_address: z.string().describe("IP address to analyze"),
    window_minutes: z.number().int().positive().optional().default(15),
    account_threshold: z.number().int().positive().optional().default(3),
  },
  async ({ ip_address, window_minutes, account_threshold }) =>
    text(await detectPasswordSpray(sql, ip_address, { windowMinutes: window_minutes, accountThreshold: account_threshold })),
);

server.tool(
  "auth_get_unresolved_activities",
  "Get all unresolved suspicious activities for a workspace",
  {
    workspace_id: z.string().optional(),
    limit: z.number().int().positive().optional().default(50),
    min_severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  },
  async ({ workspace_id, limit, min_severity }) =>
    text(await getUnresolvedActivities(sql, workspace_id, { limit, minSeverity: min_severity })),
);

server.tool(
  "auth_resolve_suspicious_activity",
  "Mark a suspicious activity as resolved or false positive",
  {
    activity_id: z.string().describe("Activity ID to resolve"),
    resolved_by: z.string().describe("User ID of the analyst resolving it"),
    false_positive: z.boolean().optional().default(false),
  },
  async ({ activity_id, resolved_by, false_positive }) =>
    text({ resolved: await resolveSuspiciousActivity(sql, activity_id, resolved_by, { falsePositive: false_positive }) }),
);

server.tool(
  "auth_get_user_activity_summary",
  "Get a summary of suspicious activities for a user (for security dashboards)",
  {
    user_id: z.string().describe("User ID"),
    days: z.number().int().positive().optional().default(30),
  },
  async ({ user_id, days }) => text(await getUserActivitySummary(sql, user_id, days)),
);

// --- Fresh Token Reuse Detection ---

server.tool(
  "auth_record_token_issuance",
  "Record a token issuance event for fresh token reuse detection",
  {
    token_hash: z.string().describe("SHA-256 hash of the token (NOT the raw token)"),
    user_id: z.string().describe("User ID who was issued the token"),
    workspace_id: z.string().optional().describe("Workspace ID"),
    ip_address: z.string().optional().describe("IP address of issuance"),
    user_agent: z.string().optional().describe("User agent of issuance"),
  },
  async ({ token_hash, user_id, workspace_id, ip_address, user_agent }) =>
    text(await recordTokenIssuance(sql, token_hash, user_id, { workspaceId: workspace_id, ipAddress: ip_address, userAgent: user_agent })),
);

server.tool(
  "auth_record_token_usage",
  "Record a token usage event and check for fresh reuse (reuse within seconds of issuance)",
  {
    token_hash: z.string().describe("SHA-256 hash of the token (NOT the raw token)"),
    user_id: z.string().describe("User ID presenting the token"),
    workspace_id: z.string().optional().describe("Workspace ID"),
    ip_address: z.string().optional().describe("IP address of usage"),
    user_agent: z.string().optional().describe("User agent of usage"),
    freshness_window_ms: z.number().int().positive().optional().default(5000).describe("Window in ms to consider as fresh reuse (default 5000)"),
  },
  async ({ token_hash, user_id, workspace_id, ip_address, user_agent, freshness_window_ms }) =>
    text(await recordTokenUsage(sql, token_hash, user_id, { workspaceId: workspace_id, ipAddress: ip_address, userAgent: user_agent, freshnessWindowMs: freshness_window_ms })),
);

server.tool(
  "auth_get_fresh_token_alerts",
  "Get fresh token reuse alerts — flags tokens reused immediately after issuance (potential theft)",
  {
    workspace_id: z.string().optional().describe("Filter by workspace ID"),
    user_id: z.string().optional().describe("Filter by user ID"),
    unresolved_only: z.boolean().optional().default(false).describe("Only show unresolved alerts"),
    severity: z.enum(["low", "medium", "high", "critical"]).optional().describe("Filter by severity"),
    limit: z.number().int().positive().optional().default(50),
  },
  async ({ workspace_id, user_id, unresolved_only, severity, limit }) =>
    text(await getFreshTokenAlerts(sql, { workspaceId: workspace_id, userId: user_id, unresolvedOnly: unresolved_only, severity, limit })),
);

server.tool(
  "auth_resolve_fresh_token_alert",
  "Resolve a fresh token reuse alert after investigation",
  {
    alert_id: z.string().describe("Alert ID to resolve"),
    resolved_by: z.string().optional().describe("User ID who resolved it"),
  },
  async ({ alert_id, resolved_by }) =>
    text(await resolveFreshTokenAlert(sql, alert_id, resolved_by)),
);

server.tool(
  "auth_get_fresh_token_stats",
  "Get fresh token reuse statistics for a workspace — alert counts, severity breakdown, avg reuse window",
  {
    workspace_id: z.string().describe("Workspace ID"),
    since: z.string().optional().describe("ISO date — start of window (default 30 days ago)"),
  },
  async ({ workspace_id, since }) =>
    text(await getFreshTokenStats(sql, workspace_id, since)),
);

