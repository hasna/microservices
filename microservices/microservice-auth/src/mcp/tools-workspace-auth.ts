// --- Workspace auth ---

server.tool(
  "auth_invite_member",
  "Invite a user to a workspace (creates an invite token)",
  {
    workspace_id: z.string(),
    email: z.string(),
    role: z.enum(["owner", "admin", "member", "viewer"]),
    invited_by: z.string(),
    ttl_hours: z.number().optional().default(72),
  },
  async ({ workspace_id, email, role, invited_by, ttl_hours }) =>
    text(await inviteToWorkspace(sql, workspace_id, email, role, invited_by, ttl_hours)),
);

server.tool(
  "auth_remove_member",
  "Remove a user from a workspace",
  { workspace_id: z.string(), user_id: z.string() },
  async ({ workspace_id, user_id }) =>
    text({ removed: await removeWorkspaceMember(sql, workspace_id, user_id) }),
);

server.tool(
  "auth_list_members",
  "List all members of a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await listWorkspaceMembers(sql, workspace_id)),
);

server.tool(
  "auth_update_member_role",
  "Update a member's role in a workspace",
  {
    workspace_id: z.string(),
    user_id: z.string(),
    role: z.enum(["owner", "admin", "member", "viewer"]),
  },
  async ({ workspace_id, user_id, role }) =>
    text({ updated: await updateMemberRole(sql, workspace_id, user_id, role) }),
);

server.tool(
  "auth_accept_workspace_invite",
  "Accept a workspace invite token and join the workspace",
  { token: z.string(), user_id: z.string(), user_email: z.string() },
  async ({ token, user_id, user_email }) =>
    text(await acceptWorkspaceInvite(sql, token, user_id, user_email)),
);

server.tool(
  "auth_list_workspace_invites",
  "List pending invites for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await listWorkspaceInvites(sql, workspace_id)),
);

server.tool(
  "auth_revoke_workspace_invite",
  "Revoke a pending workspace invite by email",
  { workspace_id: z.string(), email: z.string() },
  async ({ workspace_id, email }) =>
    text({ revoked: await revokeWorkspaceInvite(sql, workspace_id, email) }),
);

