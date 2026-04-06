// ─── Session Anomaly Detection ───────────────────────────────────────────────

server.tool(
  "auth_detect_session_anomaly",
  "Detect anomalies in a user's session patterns — flags suspicious activity like impossible travel, unusual hours, or erratic behavior",
  {
    user_id: z.string().describe("User ID to analyze"),
    session_id: z.string().optional().describe("Specific session ID to check (checks all if omitted)"),
  },
  async ({ user_id, session_id }) => {
    const { detectSessionAnomalies } = await import("../lib/session-anomaly.js");
    return text(await detectSessionAnomalies(sql, user_id, session_id));
  },
);

server.tool(
  "auth_get_session_security_audit",
  "Get a full security audit for a user's sessions — anomaly summary, trust scores, active threats, recent auth events",
  {
    user_id: z.string().describe("User ID to audit"),
    days: z.number().optional().default(7).describe("Look back window in days"),
  },
  async ({ user_id, days }) => {
    const { getSessionSecurityAudit } = await import("../lib/session-anomaly.js");
    return text(await getSessionSecurityAudit(sql, user_id, days));
  },
);

server.tool(
  "auth_list_recent_session_anomalies",
  "List recently detected session anomalies for a workspace",
  {
    workspace_id: z.string().optional().describe("Workspace ID to filter by"),
    user_id: z.string().optional().describe("User ID to filter by"),
    limit: z.number().optional().default(20),
    acknowledged: z.boolean().optional().describe("Filter by acknowledged status"),
  },
  async ({ workspace_id, user_id, limit, acknowledged }) => {
    const { getRecentSessionAnomalies } = await import("../lib/session-anomaly.js");
    return text(await getRecentSessionAnomalies(sql, { workspaceId: workspace_id, userId: user_id, limit, acknowledged }));
  },
);

