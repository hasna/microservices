// --- Deduplication tools ---

server.tool(
  "memory_find_duplicates",
  "Find groups of near-duplicate memories using simhash + Jaro-Winkler similarity",
  {
    workspace_id: z.string(),
    collection_id: z.string().optional(),
    namespace: z.string().optional(),
    similarity_threshold: z.number().min(0).max(1).optional().default(0.85),
    memory_type: MemoryTypeEnum.optional(),
  },
  async ({ workspace_id, collection_id, namespace, similarity_threshold, memory_type }) =>
    text(await findDuplicateGroups(sql, {
      workspaceId: workspace_id,
      collectionId: collection_id,
      namespace,
      similarityThreshold: similarity_threshold,
      memoryType: memory_type,
    })),
);

server.tool(
  "memory_merge_duplicates",
  "Merge duplicate memories into a single canonical memory, deleting the others",
  {
    canonical_memory_id: z.string(),
    duplicate_memory_ids: z.array(z.string()),
    delete_links: z.boolean().optional().default(true),
  },
  async ({ canonical_memory_id, duplicate_memory_ids, delete_links }) =>
    text(await mergeDuplicate(sql, canonical_memory_id, duplicate_memory_ids, delete_links)),
);

