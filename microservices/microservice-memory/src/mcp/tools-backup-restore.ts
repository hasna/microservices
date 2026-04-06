// --- Backup / restore ---

server.tool(
  "memory_export_snapshot",
  "Export all memories for a workspace as a JSON snapshot",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) =>
    text(await exportMemorySnapshot(sql, workspace_id, namespace)),
);

server.tool(
  "memory_import_snapshot",
  "Import a memory snapshot into a workspace",
  {
    workspace_id: z.string(),
    snapshot: z.object({
      metadata: z.record(z.any()),
      memories: z.array(z.object({
        workspace_id: z.string(),
        collection_id: z.string().nullable(),
        content: z.string(),
        summary: z.string().nullable(),
        importance: z.number(),
        memory_type: z.string(),
        priority: z.number(),
        metadata: z.record(z.any()),
        embedding_text: z.string().nullable(),
        expires_at: z.string().nullable(),
        ttl_seconds: z.number(),
        is_pinned: z.boolean(),
        created_at: z.string(),
      })),
    }),
    conflict_strategy: z.enum(["skip", "overwrite", "duplicate"]).optional().default("skip"),
  },
  async ({ workspace_id, snapshot, conflict_strategy }) => {
    const result = await importMemorySnapshot(sql, workspace_id, snapshot, conflict_strategy);
    return text(result);
  },
);

server.tool(
  "memory_snapshot_info",
  "Get snapshot metadata without importing",
  {
    snapshot: z.object({
      metadata: z.record(z.any()),
      memories: z.array(z.any()),
    }),
  },
  async ({ snapshot }) => text(getSnapshotInfo(snapshot)),
);

