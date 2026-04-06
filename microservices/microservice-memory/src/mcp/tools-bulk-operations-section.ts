// ---- Bulk operations ----

server.tool(
  "memory_bulk_store",
  "Insert multiple memories in a single transaction",
  {
    workspace_id: z.string(),
    items: z.array(
      z.object({
        content: z.string(),
        user_id: z.string().optional(),
        collection_id: z.string().optional(),
        summary: z.string().optional(),
        importance: z.number().min(0).max(1).optional(),
        memory_type: MemoryTypeEnum.optional(),
        priority: z.number().optional(),
        metadata: z.record(z.any()).optional(),
        expires_at: z.string().datetime().optional(),
        ttl_seconds: z.number().int().min(0).optional(),
        is_pinned: z.boolean().optional(),
      }),
    ),
  },
  async ({ workspace_id, items }) =>
    text(
      await bulkStoreMemories(sql, {
        workspaceId: workspace_id,
        items: items.map((i) => ({
          content: i.content,
          userId: i.user_id,
          collectionId: i.collection_id,
          summary: i.summary,
          importance: i.importance,
          memoryType: i.memory_type,
          priority: i.priority,
          metadata: i.metadata,
          expiresAt: i.expires_at ? new Date(i.expires_at) : undefined,
          ttlSeconds: i.ttl_seconds,
          isPinned: i.is_pinned,
        })),
      }),
    ),
);

server.tool(
  "memory_bulk_update",
  "Update multiple memories in a single transaction",
  {
    ids: z.array(z.string()),
    updates: z.object({
      content: z.string().optional(),
      summary: z.string().optional(),
      importance: z.number().min(0).max(1).optional(),
      priority: z.number().optional(),
      metadata: z.record(z.any()).optional(),
      is_pinned: z.boolean().optional(),
      expires_at: z.string().datetime().nullable().optional(),
    }),
  },
  async ({ ids, updates }) =>
    text(
      await bulkUpdateMemories(sql, {
        ids,
        updates: {
          content: updates.content,
          summary: updates.summary,
          importance: updates.importance,
          priority: updates.priority,
          metadata: updates.metadata,
          isPinned: updates.is_pinned,
          expiresAt: updates.expires_at ? new Date(updates.expires_at) : undefined,
        },
      }),
    ),
);

server.tool(
  "memory_bulk_delete",
  "Delete multiple memories in a single transaction",
  {
    ids: z.array(z.string()),
  },
  async ({ ids }) => text(await bulkDeleteMemories(sql, ids)),
);

