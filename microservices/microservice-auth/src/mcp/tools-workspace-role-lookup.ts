// --- Workspace role lookup ---

server.tool(
  "auth_get_member_role",
  "Get a user's role in a workspace",
  { workspace_id: z.string(), user_id: z.string() },
  async ({ workspace_id, user_id }) =>
    text({ role: await getMemberRole(sql, workspace_id, user_id) }),
);

