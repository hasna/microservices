// ─── Memory Namespaces ────────────────────────────────────────────────────────

server.tool(
  "memory_create_namespace",
  "Create a new memory namespace within a workspace",
  {
    workspace_id: z.string(),
    name: z.string().describe("Namespace name (unique per workspace)"),
    description: z.string().optional(),
    default_ttl_seconds: z.number().int().nonnegative().optional(),
    quota_max_memories: z.number().int().positive().optional(),
  },
  async ({ workspace_id, name, description, default_ttl_seconds, quota_max_memories }) => {
    const { createNamespace } = await import("../lib/memory-namespaces.js");
    return text(await createNamespace(sql, workspace_id, name, description, default_ttl_seconds, quota_max_memories));
  },
);

server.tool(
  "memory_list_namespaces",
  "List all namespaces in a workspace with stats",
  {
    workspace_id: z.string(),
    include_stats: z.boolean().optional().default(true),
  },
  async ({ workspace_id, include_stats }) => {
    const { listNamespaces } = await import("../lib/memory-namespaces.js");
    return text(await listNamespaces(sql, workspace_id, include_stats));
  },
);

server.tool(
  "memory_get_namespace_stats",
  "Get statistics for a namespace (total memories, type breakdown, avg importance, expired count)",
  { namespace: z.string() },
  async ({ namespace }) => {
    const { getNamespaceStats } = await import("../lib/memory-namespaces.js");
    return text(await getNamespaceStats(sql, namespace));
  },
);

server.tool(
  "memory_search_cross_namespace",
  "Search across multiple namespaces in a workspace simultaneously",
  {
    workspace_id: z.string(),
    text: z.string().describe("Search query"),
    namespaces: z.array(z.string()).min(1),
    mode: z.enum(["semantic", "text", "hybrid"]).optional().default("text"),
    limit: z.number().optional().default(20),
  },
  async ({ workspace_id, text, namespaces, mode, limit }) => {
    const { searchCrossNamespace } = await import("../lib/index.js");
    return text(await searchCrossNamespace(sql, workspace_id, text, namespaces, mode, limit));
  },
);

server.tool(
  "memory_delete_namespace",
  "Delete a namespace and optionally all its memories",
  {
    namespace: z.string(),
    delete_memories: z.boolean().optional().default(false),
  },
  async ({ namespace, delete_memories }) => {
    const { deleteNamespaceMemories } = await import("../lib/namespace-isolation.js");
    const { deleteNamespace } = await import("../lib/memory-namespaces.js");
    if (delete_memories) await deleteNamespaceMemories(sql, namespace);
    return text({ deleted: await deleteNamespace(sql, namespace) });
  },
);

