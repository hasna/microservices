// --- Magic link gap tools ---

server.tool(
  "auth_create_magic_link_token",
  "Create a single-use magic link token for passwordless login",
  { user_id: z.string() },
  async ({ user_id }) => text({ token: await createMagicLinkToken(sql, user_id) }),
);

server.tool(
  "auth_create_email_verify_token",
  "Create a single-use email verification token",
  { user_id: z.string() },
  async ({ user_id }) => text({ token: await createEmailVerifyToken(sql, user_id) }),
);

server.tool(
  "auth_create_password_reset_token",
  "Create a single-use password reset token",
  { user_id: z.string() },
  async ({ user_id }) => text({ token: await createPasswordResetToken(sql, user_id) }),
);

server.tool(
  "auth_verify_magic_link_token",
  "Verify a magic link token and return the user ID (marks token as used)",
  { token: z.string() },
  async ({ token }) => text(await verifyMagicLinkToken(sql, token)),
);

server.tool(
  "auth_verify_password_reset_token",
  "Verify a password reset token and return the user ID",
  { token: z.string() },
  async ({ token }) => text(await verifyPasswordResetToken(sql, token)),
);

