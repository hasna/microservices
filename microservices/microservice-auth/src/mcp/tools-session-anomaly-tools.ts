// --- Session Anomaly tools ---

server.tool(
  "auth_detect_session_anomalies",
  "Detect anomalies in a user session (unusual time, IP change, concurrent sessions, etc.)",
  { session_id: z.string(), user_id: z.string() },
  async ({ session_id, user_id }) => {
    const { detectSessionAnomalies, recordSessionAnomalies } = await import("../lib/session-anomaly.js");
    const anomalies = await detectSessionAnomalies(sql, user_id, session_id);
    if (anomalies.length > 0) {
      await recordSessionAnomalies(sql, anomalies);
    }
    return text({ anomalies });
  },
);

server.tool(
  "auth_get_user_session_pattern",
  "Get typical session pattern for a user (login hours, IPs, devices, duration)",
  { user_id: z.string() },
  async ({ user_id }) => {
    const { getUserSessionPattern } = await import("../lib/session-anomaly.js");
    return text(await getUserSessionPattern(sql, user_id));
  },
);

server.tool(
  "auth_get_recent_session_anomalies",
  "Get recent session anomalies for a user",
  { user_id: z.string(), hours: z.number().optional().default(24) },
  async ({ user_id, hours }) => {
    const { getRecentSessionAnomalies } = await import("../lib/session-anomaly.js");
    return text(await getRecentSessionAnomalies(sql, user_id, hours));
  },
);

