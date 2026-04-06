// ─── MFA Enrollment Tools ─────────────────────────────────────────────────────

server.tool(
  "auth_mfa_get_status",
  "Get MFA enrollment status for a user (TOTP enrolled, backup codes remaining)",
  { user_id: z.string() },
  async ({ user_id }) => {
    const { getMfaStatus } = await import("../lib/mfa-enrollments.js");
    return text(await getMfaStatus(sql, user_id));
  },
);

server.tool(
  "auth_mfa_verify_code",
  "Verify a TOTP code during MFA login flow",
  {
    user_id: z.string(),
    code: z.string().describe("6-digit TOTP code"),
  },
  async ({ user_id, code }) => {
    const { verifyTotpCode } = await import("../lib/mfa-enrollments.js");
    return text({ valid: await verifyTotpCode(sql, user_id, code) });
  },
);

server.tool(
  "auth_mfa_get_backup_codes",
  "Get remaining backup code count for a user (does not expose codes)",
  { user_id: z.string() },
  async ({ user_id }) => {
    const { getBackupCodeCount } = await import("../lib/mfa-enrollments.js");
    return text({ remaining: await getBackupCodeCount(sql, user_id) });
  },
);

server.tool(
  "auth_mfa_consume_backup_code",
  "Consume a backup code during MFA recovery",
  {
    user_id: z.string(),
    code: z.string().describe("Backup code"),
  },
  async ({ user_id, code }) => {
    const { consumeTotpBackupCode } = await import("../lib/mfa-enrollments.js");
    return text({ valid: await consumeTotpBackupCode(sql, user_id, code) });
  },
);

