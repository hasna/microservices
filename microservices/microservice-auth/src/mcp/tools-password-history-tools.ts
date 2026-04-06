// --- Password history tools ---

server.tool(
  "auth_check_password_history",
  "Check if a proposed password was previously used by the user",
  {
    user_id: z.string().describe("User UUID"),
    proposed_password_hash: z.string().describe("bcrypt hash of the proposed password"),
    history_limit: z.number().int().positive().optional().default(10),
  },
  async ({ user_id, proposed_password_hash, history_limit }) =>
    text(await checkPasswordAgainstHistory(sql, user_id, proposed_password_hash, history_limit)),
);

server.tool(
  "auth_add_password_history",
  "Add a password hash to the user's password history",
  {
    user_id: z.string().describe("User UUID"),
    password_hash: z.string().describe("bcrypt hash of the current password"),
  },
  async ({ user_id, password_hash }) => {
    await addPasswordToHistory(sql, user_id, password_hash);
    return text({ ok: true });
  },
);

server.tool(
  "auth_prune_password_history",
  "Prune old password history entries beyond the retention limit",
  {
    user_id: z.string().describe("User UUID"),
    retain_count: z.number().int().positive().optional().default(10),
  },
  async ({ user_id, retain_count }) =>
    text({ pruned: await prunePasswordHistory(sql, user_id, retain_count) }),
);

server.tool(
  "auth_get_password_history_count",
  "Get the number of passwords stored in a user's password history",
  { user_id: z.string().describe("User UUID") },
  async ({ user_id }) =>
    text({ count: await getPasswordHistoryCount(sql, user_id) }),
);

