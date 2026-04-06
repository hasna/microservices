// --- Namespace isolation and quota tools ---

server.tool(
  "memory_can_write_to_namespace",
  "Check if a workspace can write to a namespace within its quota",
  { namespace_id: z.string(), workspace_id: z.string() },
  async ({ namespace_id, workspace_id }) =>
    text(await canWriteToNamespace(sql, namespace_id, workspace_id)),
);

server.tool(
  "memory_can_read_from_namespace",
  "Check if a workspace can read from a namespace",
  { namespace_id: z.string(), workspace_id: z.string() },
  async ({ namespace_id, workspace_id }) => {
    const allowed = await canReadFromNamespace(sql, namespace_id, workspace_id);
    return text({ allowed });
  },
);

server.tool(
  "memory_get_namespace_quota",
  "Get detailed quota status for a namespace",
  { namespace_id: z.string() },
  async ({ namespace_id }) => {
    const quota = await getNamespaceQuota(sql, namespace_id);
    return text({ quota });
  },
);

server.tool(
  "memory_set_namespace_quota",
  "Set hard quota for a namespace",
  {
    namespace_id: z.string(),
    max_memories: z.number().int().positive().nullable(),
    max_collections: z.number().int().positive().nullable(),
    max_size_bytes: z.number().int().positive().nullable(),
    enforce_hard_limit: z.boolean().optional().default(false),
  },
  async ({ namespace_id, max_memories, max_collections, max_size_bytes, enforce_hard_limit }) => {
    await setNamespaceQuota(sql, namespace_id, {
      maxMemories: max_memories,
      maxCollections: max_collections,
      maxSizeBytes: max_size_bytes,
      enforceHardLimit: enforce_hard_limit,
    });
    return text({ ok: true });
  },
);

server.tool(
  "memory_refresh_namespace_count",
  "Recount current memory usage for a namespace and update its budget",
  {
    workspace_id: z.string(),
    namespace: z.string(),
  },
  async ({ workspace_id, namespace }) => {
    const count = await refreshNamespaceCount(sql, workspace_id, namespace);
    return text({ refreshed: true, count, workspace_id, namespace });
  },
);

server.tool(
  "memory_enforce_hard_quota",
  "Check if a namespace is at or over its hard quota limit (blocks writes if exceeded)",
  {
    namespace_id: z.string(),
    content_size_bytes: z.number().int().nonnegative().optional().default(0),
  },
  async ({ namespace_id, content_size_bytes }) =>
    text(await enforceNamespaceHardQuota(sql, namespace_id, content_size_bytes)),
);

server.tool(
  "memory_set_namespace_access_policy",
  "Set access policy (allowed/blocked workspaces, public read/write) for a namespace",
  {
    namespace_id: z.string(),
    allowed_workspace_ids: z.array(z.string()).optional(),
    blocked_workspace_ids: z.array(z.string()).optional(),
    public_read: z.boolean().optional().default(false),
    public_write: z.boolean().optional().default(false),
  },
  async ({ namespace_id, allowed_workspace_ids, blocked_workspace_ids, public_read, public_write }) => {
    await setNamespaceAccessPolicy(sql, namespace_id, {
      allowedWorkspaceIds: allowed_workspace_ids,
      blockedWorkspaceIds: blocked_workspace_ids,
      publicRead: public_read,
      publicWrite: public_write,
    });
    return text({ ok: true });
  },
);

server.tool(
  "memory_list_namespaces_with_quota",
  "List all namespaces for a workspace with quota information",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const namespaces = await listNamespacesWithQuota(sql, workspace_id);
    return text({ namespaces });
  },
);

server.tool(
  "memory_delete_namespace_memories",
  "Delete all memories in a namespace (hard delete)",
  { namespace_id: z.string() },
  async ({ namespace_id }) => {
    const deleted = await deleteNamespaceMemories(sql, namespace_id);
    return text({ deleted, namespaceId: namespace_id });
  },
);

