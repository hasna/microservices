// --- TOTP two-factor authentication ---

server.tool(
  "auth_generate_totp_secret",
  "Generate a new TOTP secret for enrolling a user in 2FA",
  {
    user_id: z.string().describe("User UUID"),
    algorithm: z.enum(["SHA1", "SHA256", "SHA512"]).optional().default("SHA1"),
    digits: z.number().int().min(6).max(8).optional().default(6),
    period: z.number().int().positive().optional().default(30),
  },
  async ({ user_id, algorithm, digits, period }) => {
    const secret = await generateTOTPSecret();
    const uri = generateTOTPURI(secret, user_id, { algorithm, digits, period });
    const backup_codes = generateBackupCodes();
    return text({ secret, uri, backup_codes });
  },
);

server.tool(
  "auth_verify_totp",
  "Verify a TOTP code and optionally mark enrollment as verified",
  {
    user_id: z.string().describe("User UUID"),
    code: z.string().describe("TOTP code from authenticator app"),
    verify_as_verified: z.boolean().optional().default(false),
    algorithm: z.enum(["SHA1", "SHA256", "SHA512"]).optional().default("SHA1"),
    digits: z.number().int().min(6).max(8).optional().default(6),
    period: z.number().int().positive().optional().default(30),
  },
  async ({ user_id, code, verify_as_verified, algorithm, digits, period }) => {
    const result = await verifyTOTP(sql, user_id, code, { algorithm, digits, period, verify_as_verified });
    return text(result);
  },
);

server.tool(
  "auth_consume_backup_code",
  "Consume a backup code for 2FA recovery",
  {
    user_id: z.string().describe("User UUID"),
    code: z.string().describe("One of the user's backup codes"),
  },
  async ({ user_id, code }) => {
    const result = await consumeBackupCode(sql, user_id, code);
    return text(result);
  },
);

