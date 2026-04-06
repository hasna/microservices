// ─── Namespace Transfer ────────────────────────────────────────────────────────

server.tool(
  "memory_preview_transfer",
  "Preview what memories would be transferred between namespaces without actually transferring",
  {
    workspace_id: z.string(),
    source_namespace: z.string(),
    target_namespace: z.string(),
    collection_id: z.string().optional(),
    memory_type: z.string().optional(),
    min_importance: z.number().min(0).max(1).optional(),
    older_than_seconds: z.number().int().positive().optional(),
    newer_than_seconds: z.number().int().positive().optional(),
  },
  async ({
    workspace_id, source_namespace, target_namespace,
    collection_id, memory_type, min_importance,
    older_than_seconds, newer_than_seconds,
  }) => {
    const { previewTransfer } = await import("../lib/namespace-transfer.js");
    return text(await previewTransfer(sql, workspace_id, {
      sourceNamespace: source_namespace,
      targetNamespace: target_namespace,
      collectionId: collection_id ?? undefined,
      memoryType: memory_type ?? undefined,
      minImportance: min_importance ?? undefined,
      olderThanSeconds: older_than_seconds ?? undefined,
      newerThanSeconds: newer_than_seconds ?? undefined,
      deleteSource: false,
    }));
  },
);

server.tool(
  "memory_transfer_memories",
  "Move or copy memories between namespaces within a workspace",
  {
    workspace_id: z.string(),
    source_namespace: z.string(),
    target_namespace: z.string(),
    collection_id: z.string().optional(),
    memory_type: z.string().optional(),
    min_importance: z.number().min(0).max(1).optional(),
    older_than_seconds: z.number().int().positive().optional(),
    newer_than_seconds: z.number().int().positive().optional(),
    delete_source: z.boolean().optional().default(false),
    batch_size: z.number().int().positive().optional().default(100),
    preserve_importance: z.boolean().optional().default(true),
    preserve_ttl: z.boolean().optional().default(false),
  },
  async ({
    workspace_id, source_namespace, target_namespace,
    collection_id, memory_type, min_importance,
    older_than_seconds, newer_than_seconds,
    delete_source, batch_size, preserve_importance, preserve_ttl,
  }) => {
    const { transferMemories } = await import("../lib/namespace-transfer.js");
    return text(await transferMemories(sql, workspace_id, {
      sourceNamespace: source_namespace,
      targetNamespace: target_namespace,
      collectionId: collection_id ?? undefined,
      memoryType: memory_type ?? undefined,
      minImportance: min_importance ?? undefined,
      olderThanSeconds: older_than_seconds ?? undefined,
      newerThanSeconds: newer_than_seconds ?? undefined,
      deleteSource: delete_source ?? false,
      batchSize: batch_size ?? 100,
      preserveImportance: preserve_importance ?? true,
      preserveTTL: preserve_ttl ?? false,
    }));
  },
);

server.tool(
  "memory_consolidate_episodic_to_semantic",
  "Copy episodic memories older than a threshold into the semantic namespace for long-term storage",
  {
    workspace_id: z.string(),
    older_than_hours: z.number().int().positive().optional().default(24),
    target_namespace: z.string().optional().default("semantic"),
  },
  async ({ workspace_id, older_than_hours, target_namespace }) => {
    const { consolidateEpisodicToSemantic } = await import("../lib/namespace-transfer.js");
    return text(await consolidateEpisodicToSemantic(
      sql, workspace_id,
      older_than_hours ?? 24,
      target_namespace ?? "semantic",
    ));
  },
);

