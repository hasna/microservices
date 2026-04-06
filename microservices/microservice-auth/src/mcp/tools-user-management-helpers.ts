// --- User management helpers ---

server.tool(
  "auth_count_users",
  "Count total users, optionally filtered by workspace",
  { workspace_id: z.string().optional() },
  async ({ workspace_id }) =>
    text({ count: await countUsers(sql, workspace_id) }),
);

server.tool(
  "auth_get_user_by_email",
  "Look up a user by their email address",
  { email: z.string() },
  async ({ email }) => text(await getUserByEmail(sql, email)),
);

