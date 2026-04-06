// ─── Password History ─────────────────────────────────────────────────────────

server.tool(
  "auth_check_password_history",
  "Check if a password was recently used by this user (prevents password reuse)",
  {
    user_id: z.string(),
    password: z.string().describe("Password to check against history"),
  },
  async ({ user_id, password }) => {
    const { checkPasswordAgainstHistory } = await import("../lib/password-history.js");
    return text({ reused: await checkPasswordAgainstHistory(sql, user_id, password) });
  },
);

server.tool(
  "auth_add_password_to_history",
  "Add a password hash to user's password history after password change",
  {
    user_id: z.string(),
    password_hash: z.string().describe("Hashed password to store"),
  },
  async ({ user_id, password_hash }) => {
    const { addPasswordToHistory } = await import("../lib/password-history.js");
    await addPasswordToHistory(sql, user_id, password_hash);
    return text({ added: true });
  },
);

