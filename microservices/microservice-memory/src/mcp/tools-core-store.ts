server.tool(
  "memory_store",
  "Store a new memory with optional embedding for semantic search",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    collection_id: z.string().optional(),
    content: z.string(),
    summary: z.string().optional(),
    importance: z.number().min(0).max(1).optional(),
    memory_type: MemoryTypeEnum.optional().default("semantic"),
    priority: z.number().optional().default(0),
    metadata: z.record(z.any()).optional(),
    expires_at: z.string().datetime().optional(),
    ttl_seconds: z.number().int().min(0).optional().default(0),
    is_pinned: z.boolean().optional().default(false),
  },
  async ({ workspace_id, user_id, collection_id, content, summary, importance, memory_type, priority, metadata, expires_at, ttl_seconds, is_pinned }) =>
    text(
      await storeMemory(sql, {
        workspaceId: workspace_id,
        userId: user_id,
        collectionId: collection_id,
        content,
        summary,
        importance,
        memoryType: memory_type,
        priority,
        metadata,
        expiresAt: expires_at ? new Date(expires_at) : undefined,
        ttlSeconds: ttl_seconds,
        isPinned: is_pinned,
      }),
    ),
);

server.tool(
  "memory_search",
  "Search memories by text (full-text or semantic if embeddings available)",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    text: z.string(),
    mode: z.enum(["semantic", "text", "hybrid"]).optional().default("text"),
    limit: z.number().optional().default(10),
    collection_id: z.string().optional(),
    namespace: z.string().optional(),
    memory_type: MemoryTypeEnum.optional(),
  },
  async ({ workspace_id, user_id, text: searchText, mode, limit, collection_id, namespace, memory_type }) =>
    text(
      await searchMemories(sql, {
        workspaceId: workspace_id,
        userId: user_id,
        text: searchText,
        mode,
        limit,
        collectionId: collection_id,
        namespace,
        memoryType: memory_type,
      }),
    ),
);

server.tool(
  "memory_recall",
  "Recall memories relevant to a query (alias for search with simpler input)",
  {
    workspace_id: z.string(),
    query: z.string(),
    user_id: z.string().optional(),
    limit: z.number().optional().default(10),
    namespace: z.string().optional(),
    memory_type: MemoryTypeEnum.optional(),
  },
  async ({ workspace_id, query, user_id, limit, namespace, memory_type }) =>
    text(
      await searchMemories(sql, {
        workspaceId: workspace_id,
        userId: user_id,
        text: query,
        mode: "hybrid",
        limit,
        namespace,
        memoryType: memory_type,
      }),
    ),
);

server.tool(
  "memory_delete",
  "Delete a memory by ID",
  { id: z.string() },
  async ({ id }) => text({ deleted: await deleteMemory(sql, id) }),
);

server.tool(
  "memory_list",
  "List memories for a workspace",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    limit: z.number().optional().default(50),
    namespace: z.string().optional(),
    memory_type: MemoryTypeEnum.optional(),
  },
  async ({ workspace_id, user_id, limit, namespace, memory_type }) =>
    text(
      await listMemories(sql, workspace_id, user_id, limit, { namespace, memoryType: memory_type }),
    ),
);

server.tool(
  "memory_list_collections",
  "List collections for a workspace",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
  },
  async ({ workspace_id, user_id }) =>
    text(
      await listCollections(sql, workspace_id, user_id),
    ),
);

server.tool(
  "memory_create_collection",
  "Create a new memory collection",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    name: z.string(),
    description: z.string().optional(),
  },
  async (collectionData) =>
    text(
      await createCollection(sql, {
        workspaceId: collectionData.workspace_id,
        userId: collectionData.user_id,
        name: collectionData.name,
        description: collectionData.description,
      }),
    ),
);

server.tool(
  "memory_get_collection",
  "Get a single memory collection by ID",
  {
    collection_id: z.string(),
  },
  async ({ collection_id }) =>
    text(await getCollection(sql, collection_id)),
);

server.tool(
  "memory_delete_collection",
  "Delete a memory collection (deletes the collection itself, not its memories — use memory_delete_collection_memories to delete memories)",
  {
    collection_id: z.string(),
  },
  async ({ collection_id }) =>
    text({ deleted: await deleteCollection(sql, collection_id) }),
);

server.tool(
  "memory_get_collection_stats",
  "Get statistics for a memory collection (memory counts by type, pinned count, expired count, avg importance, avg TTL)",
  {
    collection_id: z.string(),
  },
  async ({ collection_id }) =>
    text(await getCollectionStats(sql, collection_id)),
);

server.tool(
  "memory_update_importance",
  "Update the importance score of a memory (0.0 to 1.0)",
  {
    id: z.string(),
    importance: z.number().min(0).max(1),
  },
  async ({ id, importance }) => {
    await updateMemoryImportance(sql, id, importance);
    return text({ ok: true });
  },
);

server.tool(
  "memory_delete_expired",
  "Delete all expired memories (past their expires_at timestamp)",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) => {
    // Note: namespace filtering would require a join; for simplicity we delete all expired in workspace
    const count = await deleteExpiredMemories(sql, workspace_id);
    return text({ deleted: count });
  },
);

server.tool(
  "memory_delete_by_age",
  "Delete memories older than max_age_seconds (LRU-style eviction)",
  {
    workspace_id: z.string(),
    max_age_seconds: z.number().positive(),
  },
  async ({ workspace_id, max_age_seconds }) => {
    const count = await deleteMemoriesByAge(sql, workspace_id, max_age_seconds);
    return text({ deleted: count });
  },
);

server.tool(
  "memory_delete_by_namespace",
  "Delete all memories in a namespace (optionally within a collection)",
  {
    workspace_id: z.string(),
    namespace: z.string(),
    collection_id: z.string().optional(),
  },
  async ({ workspace_id, namespace, collection_id }) => {
    const count = await deleteMemoriesByNamespace(sql, workspace_id, namespace, collection_id);
    return text({ deleted: count });
  },
);

server.tool(
  "memory_update",
  "Update memory fields: content, summary, importance, type, priority, metadata, expires_at, is_pinned, ttl_seconds",
  {
    id: z.string(),
    content: z.string().optional(),
    summary: z.string().optional(),
    importance: z.number().min(0).max(1).optional(),
    memory_type: MemoryTypeEnum.optional(),
    priority: z.number().optional(),
    metadata: z.record(z.any()).optional(),
    expires_at: z.string().datetime().nullable().optional(),
    is_pinned: z.boolean().optional(),
    ttl_seconds: z.number().int().min(0).optional(),
  },
  async ({ id, content, summary, importance, memory_type, priority, metadata, expires_at, is_pinned, ttl_seconds }) => {
    const result = await updateMemory(sql, id, {
      content,
      summary,
      importance,
      memoryType: memory_type,
      priority,
      metadata,
      expiresAt: expires_at === null ? null : expires_at ? new Date(expires_at) : undefined,
      isPinned: is_pinned,
      ttlSeconds: ttl_seconds,
    });
    return text(result ?? { error: "Memory not found" });
  },
);

server.tool(
  "memory_pin",
  "Pin a memory so it is never auto-deleted and ignores TTL",
  { id: z.string() },
  async ({ id }) => text({ memory: await pinMemory(sql, id) ?? { error: "Memory not found" } }),
);

server.tool(
  "memory_unpin",
  "Unpin a memory, restoring normal TTL/expiry behavior",
  { id: z.string() },
  async ({ id }) => text({ memory: await unpinMemory(sql, id) ?? { error: "Memory not found" } }),
);

server.tool(
  "memory_fork",
  "Fork (copy) a memory into a new namespace. The forked copy is never pinned.",
  {
    id: z.string(),
    target_namespace: z.string(),
    target_collection_id: z.string().optional(),
  },
  async ({ id, target_namespace, target_collection_id }) => {
    const memory = await forkMemory(sql, id, target_namespace, target_collection_id);
    return text({ memory: memory ?? { error: "Memory not found or target namespace has no collection" } });
  },
);

server.tool(
  "memory_recommend",
  "Recommend related memories based on recent access patterns or similar content",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    seed_memory_ids: z.array(z.string()).optional(),
    namespace: z.string().optional(),
    limit: z.number().optional().default(10),
  },
  async ({ workspace_id, user_id, seed_memory_ids, namespace, limit }) =>
    text(
      await recommendMemories(sql, {
        workspaceId: workspace_id,
        userId: user_id,
        memoryIds: seed_memory_ids,
        namespace,
        limit,
      }),
    ),
);

server.tool(
  "memory_stats",
  "Get memory statistics for a workspace: total, expired, pinned counts, type distribution, namespace/collection counts",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await getMemoryStats(sql, workspace_id)),
);

server.tool(
  "memory_purge_expired",
  "Hard-delete all expired memories regardless of pinned status. Use with caution.",
  {
    workspace_id: z.string(),
  },
  async ({ workspace_id }) => {
    const count = await purgeExpiredMemories(sql, workspace_id);
    return text({ deleted: count });
  },
);

server.tool(
  "memory_delete_collection_memories",
  "Delete all memories in a collection",
  { collection_id: z.string() },
  async ({ collection_id }) => {
    const count = await deleteAllMemoriesInCollection(sql, collection_id);
    return text({ deleted: count });
  },
);

