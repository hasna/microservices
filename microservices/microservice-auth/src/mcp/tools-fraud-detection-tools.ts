// ─── Fraud Detection Tools ─────────────────────────────────────────────────────

server.tool(
  "auth_check_fraud",
  "Run fraud detection checks on a login attempt (impossible travel, new device, velocity, credential stuffing)",
  {
    user_id: z.string(),
    ip_address: z.string().optional(),
    user_agent: z.string().optional(),
    login_timestamp: z.string().datetime().optional(),
  },
  async ({ user_id, ip_address, user_agent, login_timestamp }) => {
    const { checkLoginFraud } = await import("../lib/fraud-detection.js");
    return text(await checkLoginFraud(sql, user_id, {
      ip: ip_address,
      userAgent: user_agent,
      timestamp: login_timestamp ? new Date(login_timestamp) : undefined,
    }));
  },
);

server.tool(
  "auth_check_impossible_travel",
  "Detect impossible travel — user appears to login from two geographically distant locations within short time",
  {
    user_id: z.string(),
    ip_address: z.string(),
  },
  async ({ user_id, ip_address }) => {
    const { checkImpossibleTravel } = await import("../lib/fraud-detection.js");
    return text(await checkImpossibleTravel(sql, user_id, ip_address));
  },
);

server.tool(
  "auth_check_credential_stuffing",
  "Check if credentials appear in known breach databases (pattern-based check)",
  {
    email: z.string().describe("User email to check"),
    password_hash: z.string().optional().describe("Optional password hash to check against HIBP patterns"),
  },
  async ({ email, password_hash }) => {
    const { checkCredentialStuffing } = await import("../lib/fraud-detection.js");
    return text(await checkCredentialStuffing(sql, email, password_hash));
  },
);

