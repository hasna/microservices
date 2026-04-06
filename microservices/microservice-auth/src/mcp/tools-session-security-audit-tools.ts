// --- Session security audit tools ---

server.tool(
  "auth_session_security_audit",
  "Perform a comprehensive security audit of all active sessions for a user, detecting issues like excessive sessions, diverse IPs, stale sessions, and missing user agents",
  { user_id: z.string().describe("User UUID") },
  async ({ user_id }) => text(await getSessionSecurityAudit(sql, user_id)),
);

