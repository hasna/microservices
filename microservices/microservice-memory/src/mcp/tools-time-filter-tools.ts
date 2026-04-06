// --- Time-filter tools ---

server.tool(
  "memory_time_range",
  "Get memories within a specific time range (absolute dates or relative periods)",
  {
    workspace_id: z.string(),
    start_time: z.string().datetime().optional(),
    end_time: z.string().datetime().optional(),
    period: z.enum(["last_hour", "last_day", "last_week", "last_month", "last_year"]).optional(),
    user_id: z.string().optional(),
    collection_id: z.string().optional(),
    namespace: z.string().optional(),
    memory_type: MemoryTypeEnum.optional(),
    limit: z.number().optional().default(50),
  },
  async ({ workspace_id, start_time, end_time, period, user_id, collection_id, namespace, memory_type, limit }) =>
    text(await getMemoriesInTimeRange(sql, {
      workspaceId: workspace_id,
      startTime: start_time ? new Date(start_time) : undefined,
      endTime: end_time ? new Date(end_time) : undefined,
      period,
      userId: user_id,
      collectionId: collection_id,
      namespace,
      memoryType: memory_type,
      limit,
    })),
);

server.tool(
  "memory_recent",
  "Get the most recently created memories (shorthand for time_range with last_day)",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    limit: z.number().optional().default(20),
    memory_type: MemoryTypeEnum.optional(),
  },
  async ({ workspace_id, user_id, limit, memory_type }) =>
    text(await getRecentMemories(sql, workspace_id, { userId: user_id, limit, memoryType: memory_type })),
);

server.tool(
  "memory_get_memories_before",
  "Get memories created before a specific datetime — useful for historical lookups and 'what did the user know before X'",
  {
    workspace_id: z.string(),
    before_time: z.string().datetime().describe("Cutoff datetime — only return memories created before this time"),
    user_id: z.string().optional(),
    query: z.string().optional().describe("Optional text query to filter memories within the window"),
    limit: z.number().optional().default(20),
    memory_type: MemoryTypeEnum.optional(),
  },
  async ({ workspace_id, before_time, user_id, query, limit, memory_type }) =>
    text(await getMemoriesBefore(sql, workspace_id, new Date(before_time), query, limit)),
);

server.tool(
  "memory_timeline",
  "Get a chronological timeline of memory activity for a workspace",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    granularity: z.enum(["hour", "day", "week", "month"]).optional().default("day"),
    memory_type: MemoryTypeEnum.optional(),
    limit: z.number().optional().default(30),
  },
  async ({ workspace_id, user_id, granularity, memory_type, limit }) =>
    text(await getMemoryTimeline(sql, workspace_id, { userId: user_id, granularity, memoryType: memory_type, limit })),
);

server.tool(
  "memory_upsert_decay_rule",
  "Create or update a decay rule for a workspace/namespace/memory type combination",
  {
    workspace_id: z.string(),
    namespace: z.string().optional().default(""),
    memory_type: z.string().optional().default(""),
    decay_model: z.enum(["linear", "exponential", "logarithmic"]).optional(),
    initial_half_life_hours: z.number().optional(),
    min_importance: z.number().optional(),
    enabled: z.boolean().optional(),
  },
  async (opts) => text(await upsertDecayRule(sql, opts)),
);

server.tool(
  "memory_get_decay_rule",
  "Get the effective decay rule for a workspace (falls back to namespace, type, or global defaults)",
  {
    workspace_id: z.string(),
    namespace: z.string().optional().default(""),
    memory_type: z.string().optional().default(""),
  },
  async ({ workspace_id, namespace, memory_type }) =>
    text(await getDecayRule(sql, workspace_id, { namespace, memoryType: memory_type })),
);

server.tool(
  "memory_compute_decayed_importance",
  "Compute the current importance of a memory after applying its decay rule",
  {
    workspace_id: z.string(),
    memory_id: z.string(),
    current_importance: z.number(),
    created_at: z.string().datetime(),
    namespace: z.string().optional().default(""),
    memory_type: z.string().optional().default(""),
  },
  async (opts) => text(await computeDecayedImportance(sql, opts)),
);

server.tool(
  "memory_list_decay_rules",
  "List all decay rules configured for a workspace",
  {
    workspace_id: z.string(),
    limit: z.number().optional().default(100),
    offset: z.number().optional().default(0),
  },
  async ({ workspace_id, limit, offset }) =>
    text(await listDecayRules(sql, workspace_id, { limit, offset })),
);

server.tool(
  "memory_delete_decay_rule",
  "Delete a decay rule by ID",
  {
    workspace_id: z.string(),
    id: z.string(),
  },
  async ({ workspace_id, id }) => text(await deleteDecayRule(sql, workspace_id, id)),
);

server.tool(
  "memory_query_typed",
  "Query memories filtered by a specific memory type (episodic/semantic/procedural)",
  {
    workspace_id: z.string(),
    memory_type: MemoryTypeEnum.describe("Type of memory to query"),
    query: z.string().optional(),
    limit: z.number().optional().default(20),
    offset: z.number().optional().default(0),
  },
  async ({ workspace_id, memory_type, query, limit, offset }) =>
    text(await queryTypedMemories(sql, workspace_id, memory_type as any, { query, limit, offset })),
);

server.tool(
  "memory_migrate_memory_type",
  "Bulk-migrate all memories of one type to another type within a workspace",
  {
    workspace_id: z.string(),
    from_type: MemoryTypeEnum,
    to_type: MemoryTypeEnum,
  },
  async ({ workspace_id, from_type, to_type }) =>
    text({ migrated: await migrateMemoryType(sql, workspace_id, from_type as any, to_type as any) }),
);

server.tool(
  "memory_render_template_by_id",
  "Render a memory template by ID, substituting variables",
  {
    template_id: z.string(),
    variables: z.record(z.string()).describe("Map of variable name to value"),
  },
  async ({ template_id, variables }) => text(await renderMemoryTemplateById(sql, template_id, variables)),
);

server.tool(
  "memory_get_type_config",
  "Get the effective configuration for a memory type in a workspace",
  {
    workspace_id: z.string(),
    memory_type: MemoryTypeEnum,
  },
  async ({ workspace_id, memory_type }) =>
    text(await getMemoryTypeConfig(sql, workspace_id, memory_type as any)),
);

server.tool(
  "memory_set_type_config",
  "Set a custom configuration for a memory type in a workspace",
  {
    workspace_id: z.string(),
    memory_type: MemoryTypeEnum,
    default_ttl_seconds: z.number().nullable().optional(),
    auto_consolidate: z.boolean().optional(),
    consolidation_mode: z.enum(["summary_only", "delete_source", "archive"]).optional(),
    max_memories: z.number().nullable().optional(),
    importance_floor: z.number().optional(),
    decay_model: z.enum(["linear", "exponential", "logarithmic"]).optional(),
    half_life_hours: z.number().nullable().optional(),
    allow_boost: z.boolean().optional(),
    search_weight: z.number().optional(),
  },
  async (opts) => text(await setMemoryTypeConfig(sql, opts as any)),
);

server.tool(
  "memory_list_type_configs",
  "List all memory type configurations for a workspace",
  {
    workspace_id: z.string(),
  },
  async ({ workspace_id }) => text(await listMemoryTypeConfigs(sql, workspace_id)),
);

server.tool(
  "memory_delete_type_config",
  "Delete a custom memory type configuration, reverting to defaults",
  {
    workspace_id: z.string(),
    memory_type: MemoryTypeEnum,
  },
  async ({ workspace_id, memory_type }) =>
    text(await deleteMemoryTypeConfig(sql, workspace_id, memory_type as any)),
);

server.tool(
  "memory_create_namespace",
  "Create a new memory namespace within a workspace",
  {
    workspace_id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    default_ttl_seconds: z.number().nullable().optional(),
    default_memory_type: MemoryTypeEnum.optional(),
  },
  async (opts) => text(await createNamespace(sql, opts)),
);

server.tool(
  "memory_get_namespace",
  "Get a memory namespace by name",
  {
    workspace_id: z.string(),
    name: z.string(),
  },
  async ({ workspace_id, name }) => text(await getNamespace(sql, workspace_id, name)),
);

server.tool(
  "memory_delete_namespace",
  "Delete a memory namespace",
  {
    workspace_id: z.string(),
    name: z.string(),
  },
  async ({ workspace_id, name }) => text(await deleteNamespace(sql, workspace_id, name)),
);

server.tool(
  "memory_list_namespaces",
  "List all memory namespaces in a workspace",
  {
    workspace_id: z.string(),
  },
  async ({ workspace_id }) => text(await listNamespaces(sql, workspace_id)),
);

server.tool(
  "memory_update_namespace",
  "Update a memory namespace's settings",
  {
    workspace_id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    default_ttl_seconds: z.number().nullable().optional(),
    default_memory_type: MemoryTypeEnum.optional(),
  },
  async (opts) => text(await updateNamespace(sql, opts as any)),
);

server.tool(
  "memory_rename_namespace",
  "Rename a memory namespace and update all associated memories",
  {
    workspace_id: z.string(),
    old_name: z.string(),
    new_name: z.string(),
  },
  async ({ workspace_id, old_name, new_name }) =>
    text(await renameNamespace(sql, workspace_id, old_name, new_name)),
);

server.tool(
  "memory_namespace_stats",
  "Get statistics for a memory namespace (counts by type, avg importance, pinned, expired)",
  {
    workspace_id: z.string(),
    name: z.string(),
  },
  async ({ workspace_id, name }) => text(await getNamespaceStats(sql, workspace_id, name)),
);

