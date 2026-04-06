// ─── Account Lockout Tools ────────────────────────────────────────────────────

server.tool(
  "auth_check_lockout",
  "Check if a user account is currently locked out",
  { user_id: z.string() },
  async ({ user_id }) => {
    const { isLockedOut } = await import("../lib/lockout.js");
    return text({ locked: await isLockedOut(sql, user_id) });
  },
);

server.tool(
  "auth_unlock_account",
  "Manually unlock a user account that is in lockout state",
  { user_id: z.string() },
  async ({ user_id }) => {
    const { unlockAccount } = await import("../lib/lockout.js");
    return text({ unlocked: await unlockAccount(sql, user_id) });
  },
);

server.tool(
  "auth_list_lockouts",
  "List all currently active account lockouts (locked users with timestamps)",
  async () => {
    const { listActiveLockouts } = await import("../lib/lockout.js");
    return text(await listActiveLockouts(sql));
  },
);

server.tool(
  "auth_clear_lockout",
  "Clear failed login attempts and unlock an account",
  {
    user_id: z.string(),
    clear_only: z.boolean().optional().default(false).describe("If true, only clear attempts without unlocking"),
  },
  async ({ user_id, clear_only }) => {
    const { clearFailedAttempts, unlockAccount } = await import("../lib/lockout.js");
    await clearFailedAttempts(sql, user_id);
    if (!clear_only) await unlockAccount(sql, user_id);
    return text({ cleared: true });
  },
);

