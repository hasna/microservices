// ─── Bulk Operations ──────────────────────────────────────────────────────────

server.tool(
  "memory_bulk_store",
  "Store multiple memories in a single call (batch insert)",
  {
    memories: z.array(z.object({
      workspace_id: z.string(),
      collection_id: z.string().optional(),
      content: z.string(),
      summary: z.string().optional(),
      importance: z.number().min(0).max(1).optional(),
      memory_type: MemoryTypeEnum.optional(),
      metadata: z.record(z.any()).optional(),
      ttl_seconds: z.number().int().min(0).optional(),
    })).max(100),
  },
  async ({ memories }) => {
    const { bulkStoreMemories } = await import("../lib/index.js");
    return text(await bulkStoreMemories(sql, memories));
  },
);

server.tool(
  "memory_bulk_update",
  "Update multiple memories in a single call (batch update by ID)",
  {
    updates: z.array(z.object({
      id: z.string(),
      content: z.string().optional(),
      importance: z.number().min(0).max(1).optional(),
      memory_type: MemoryTypeEnum.optional(),
      metadata: z.record(z.any()).optional(),
      expires_at: z.string().datetime().nullable().optional(),
    })).max(100),
  },
  async ({ updates }) => {
    const { bulkUpdateMemories } = await import("../lib/index.js");
    return text({ updated: await bulkUpdateMemories(sql, updates) });
  },
);

server.tool(
  "memory_bulk_delete",
  "Delete multiple memories in a single call",
  {
    ids: z.array(z.string()).max(100),
    reason: z.string().optional(),
  },
  async ({ ids, reason }) => {
    const { bulkDeleteMemories } = await import("../lib/index.js");
    return text({ deleted: await bulkDeleteMemories(sql, ids, reason) });
  },
);

