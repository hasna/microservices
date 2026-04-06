// ---- Cross-namespace search ----

server.tool(
  "memory_cross_namespace_search",
  "Search memories across multiple namespaces simultaneously",
  {
    workspace_id: z.string(),
    text: z.string(),
    namespaces: z.array(z.string()),
    user_id: z.string().optional(),
    mode: z.enum(["semantic", "text", "hybrid"]).optional().default("text"),
    limit: z.number().optional().default(20),
    collection_id: z.string().optional(),
    memory_type: MemoryTypeEnum.optional(),
  },
  async ({ workspace_id, text, namespaces, user_id, mode, limit, collection_id, memory_type }) =>
    text(
      await searchCrossNamespace(sql, {
        workspaceId: workspace_id,
        text,
        namespaces,
        userId: user_id,
        mode,
        limit,
        collectionId: collection_id,
        memoryType: memory_type,
      }),
    ),
);

server.tool(
  "memory_namespace_counts",
  "Get memory counts per namespace for a workspace",
  {
    workspace_id: z.string(),
  },
  async ({ workspace_id }) => text(await getNamespaceMemoryCounts(sql, workspace_id)),
);

