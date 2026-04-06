// --- Account lockout ---

server.tool(
  "auth_record_failed_attempt",
  "Record a failed login attempt and trigger lockout if threshold exceeded",
  {
    email: z.string().describe("User email"),
    ip_address: z.string().optional().describe("IP address of the attempt"),
  },
  async ({ email, ip_address }) => {
    const result = await recordFailedAttempt(sql, email, ip_address);
    return text(result);
  },
);

server.tool(
  "auth_is_locked_out",
  "Check whether an email or IP is currently locked out",
  {
    email: z.string().optional().describe("User email"),
    ip_address: z.string().optional().describe("IP address"),
  },
  async ({ email, ip_address }) => {
    const result = await isLockedOut(sql, email, ip_address);
    return text(result);
  },
);

server.tool(
  "auth_unlock_account",
  "Manually unlock a user account or IP",
  {
    user_id: z.string().optional().describe("User UUID to unlock"),
    ip_address: z.string().optional().describe("IP address to unlock"),
  },
  async ({ user_id, ip_address }) => {
    const result = await unlockAccount(sql, user_id, ip_address);
    return text(result);
  },
);

server.tool(
  "auth_list_active_lockouts",
  "List all currently active account lockouts",
  {
    limit: z.number().int().positive().optional().default(50),
    offset: z.number().int().nonnegative().optional().default(0),
  },
  async ({ limit, offset }) => text(await listActiveLockouts(sql, { limit, offset })),
);

