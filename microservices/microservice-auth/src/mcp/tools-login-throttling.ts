// --- Login throttling ---

server.tool(
  "auth_check_login_allowed",
  "Check whether a login is currently allowed for an email (rate limit check)",
  { email: z.string() },
  async ({ email }) => text(await checkLoginAllowed(sql, email)),
);

server.tool(
  "auth_record_failed_login",
  "Record a failed login attempt for an email",
  { email: z.string() },
  async ({ email }) => {
    await recordFailedLogin(sql, email);
    return text({ recorded: true });
  },
);

server.tool(
  "auth_clear_login_attempts",
  "Clear all login attempts for an email (call after successful login)",
  { email: z.string() },
  async ({ email }) => {
    await clearLoginAttempts(sql, email);
    return text({ cleared: true });
  },
);

