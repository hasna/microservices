// --- Workspace sharing ---

server.tool(
  "memory_share_to_workspace",
  "Share a memory to another workspace with given permissions",
  {
    memory_id: z.string(),
    target_workspace_id: z.string(),
    permissions: z.enum(["read", "write", "admin"]).optional().default("read"),
  },
  async ({ memory_id, target_workspace_id, permissions }) => {
    await shareMemoryToWorkspace(sql, memory_id, target_workspace_id, permissions);
    return text({ ok: true });
  },
);

server.tool(
  "memory_list_workspace",
  "List all memories shared to a workspace",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) =>
    text(await listWorkspaceMemories(sql, workspace_id, namespace)),
);

server.tool(
  "memory_revoke_workspace_access",
  "Revoke workspace access to a memory",
  {
    memory_id: z.string(),
    workspace_id: z.string(),
  },
  async ({ memory_id, workspace_id }) => {
    const revoked = await revokeWorkspaceMemoryAccess(sql, memory_id, workspace_id);
    return text({ revoked });
  },
);

server.tool(
  "memory_get_permissions",
  "Get which workspaces have access to a memory",
  { memory_id: z.string() },
  async ({ memory_id }) => text(await getMemoryPermissions(sql, memory_id)),
);

