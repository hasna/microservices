// --- Collection policies ---

server.tool(
  "memory_upsert_collection_policy",
  "Create or update a collection-level policy (default TTL, memory type, importance, max memories)",
  {
    collection_id: z.string().describe("Collection UUID"),
    workspace_id: z.string().describe("Workspace UUID"),
    default_memory_type: MemoryTypeEnum.optional(),
    default_importance: z.number().min(0).max(1).optional(),
    default_priority: z.number().int().optional(),
    default_ttl_seconds: z.number().int().min(0).optional(),
    max_memories: z.number().int().positive().optional(),
    allow_duplicates: z.boolean().optional(),
    auto_consolidate: z.boolean().optional(),
    consolidation_window_hours: z.number().int().positive().optional(),
  },
  async (opts) =>
    text(await upsertCollectionPolicy(sql, {
      collectionId: opts.collection_id,
      workspaceId: opts.workspace_id,
      defaultMemoryType: opts.default_memory_type,
      defaultImportance: opts.default_importance,
      defaultPriority: opts.default_priority,
      defaultTtlSeconds: opts.default_ttl_seconds,
      maxMemories: opts.max_memories,
      allowDuplicates: opts.allow_duplicates,
      autoConsolidate: opts.auto_consolidate,
      consolidationWindowHours: opts.consolidation_window_hours,
    })),
);

server.tool(
  "memory_get_collection_policy",
  "Get the policy for a specific collection",
  { collection_id: z.string() },
  async ({ collection_id }) =>
    text(await getCollectionPolicy(sql, collection_id) ?? { no_policy: true }),
);

server.tool(
  "memory_list_collection_policies",
  "List all collection policies for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await listCollectionPolicies(sql, workspace_id)),
);

server.tool(
  "memory_delete_collection_policy",
  "Delete a collection policy",
  { collection_id: z.string() },
  async ({ collection_id }) =>
    text({ deleted: await deleteCollectionPolicy(sql, collection_id) }),
);

server.tool(
  "memory_effective_defaults",
  "Get the effective defaults for a collection (policy or global defaults)",
  { collection_id: z.string() },
  async ({ collection_id }) =>
    text(await getEffectiveCollectionDefaults(sql, collection_id)),
);

server.tool(
  "memory_collection_at_capacity",
  "Check if a collection has reached its max_memories limit",
  { collection_id: z.string() },
  async ({ collection_id }) => text(await isCollectionAtCapacity(sql, collection_id)),
);

