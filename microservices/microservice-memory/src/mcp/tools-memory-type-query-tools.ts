// --- Memory type query tools ---

server.tool(
  "memory_query_episodic",
  "Query episodic memories (recency-weighted, newest first)",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
    collection_id: z.string().optional(),
    since_hours: z.number().int().positive().optional(),
    max_results: z.number().int().positive().optional().default(100),
    importance_threshold: z.number().min(0).max(1).optional(),
    include_pinned: z.boolean().optional().default(false),
  },
  async (opts) => {
    const memories = await queryEpisodicMemories(sql, opts.workspace_id, opts);
    return text({ memories });
  },
);

server.tool(
  "memory_query_semantic",
  "Query semantic memories (importance-weighted, similarity-ordered)",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
    collection_id: z.string().optional(),
    importance_threshold: z.number().min(0).max(1).optional(),
    max_results: z.number().int().positive().optional().default(100),
    include_pinned: z.boolean().optional().default(false),
  },
  async (opts) => {
    const memories = await querySemanticMemories(sql, opts.workspace_id, opts);
    return text({ memories });
  },
);

server.tool(
  "memory_query_procedural",
  "Query procedural memories (step-sequence, instruction-ordered)",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
    collection_id: z.string().optional(),
    max_results: z.number().int().positive().optional().default(100),
    include_pinned: z.boolean().optional().default(false),
  },
  async (opts) => {
    const memories = await queryProceduralMemories(sql, opts.workspace_id, opts);
    return text({ memories });
  },
);

server.tool(
  "memory_query_context",
  "Query context memories (ephemeral, newest-first, short TTL)",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
    collection_id: z.string().optional(),
    max_results: z.number().int().positive().optional().default(50),
    max_age_seconds: z.number().int().positive().optional(),
  },
  async (opts) => {
    const memories = await queryContextMemories(sql, opts.workspace_id, opts);
    return text({ memories });
  },
);

server.tool(
  "memory_get_type_distribution",
  "Get memory type distribution for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const distribution = await getMemoryTypeDistribution(sql, workspace_id);
    return text({ distribution });
  },
);

server.tool(
  "memory_count_by_type_in_namespace",
  "Count memories by type in a namespace",
  { namespace_id: z.string() },
  async ({ namespace_id }) => {
    const counts = await countMemoriesByType(sql, namespace_id);
    return text({ counts });
  },
);

server.tool(
  "memory_archive_by_type",
  "Archive memories of a specific type older than threshold",
  {
    workspace_id: z.string(),
    memory_type: MemoryTypeEnum,
    older_than_seconds: z.number().int().positive(),
  },
  async ({ workspace_id, memory_type, older_than_seconds }) => {
    const archived = await archiveMemoriesByType(sql, workspace_id, memory_type, older_than_seconds);
    return text({ archived, memoryType: memory_type });
  },
);

server.tool(
  "memory_expiry_stats",
  "Get memory expiry statistics broken down by namespace and type",
  {
    workspace_id: z.string(),
  },
  async ({ workspace_id }) => {
    const stats = await getMemoryExpiryStats(sql, workspace_id);
    return text({ stats });
  },
);

server.tool(
  "memory_set_namespace_default_ttl",
  "Set the default TTL for a namespace",
  {
    workspace_id: z.string(),
    namespace: z.string(),
    ttl_seconds: z.number().int().min(0).nullable(),
  },
  async ({ workspace_id, namespace, ttl_seconds }) => {
    await setNamespaceDefaultTTL(sql, workspace_id, namespace, ttl_seconds);
    return text({ workspace_id, namespace, ttl_seconds });
  },
);

server.tool(
  "memory_get_expiring",
  "Get memories that are expiring within a given time window",
  {
    workspace_id: z.string(),
    within_seconds: z.number().int().positive(),
    limit: z.number().int().positive().optional().default(100),
  },
  async ({ workspace_id, within_seconds, limit }) => {
    const memories = await getExpiringMemories(sql, workspace_id, within_seconds, limit);
    return text({ expiring_memories: memories, count: memories.length });
  },
);

server.tool(
  "memory_namespace_analytics",
  "Get detailed analytics for a namespace including storage usage and access patterns",
  {
    workspace_id: z.string(),
    namespace: z.string(),
  },
  async ({ workspace_id, namespace }) => {
    const analytics = await getNamespaceAnalytics(sql, workspace_id, namespace);
    return text({ analytics });
  },
);

server.tool(
  "memory_search_cross_namespace",
  "Search for memories across multiple namespaces",
  {
    workspace_id: z.string(),
    query: z.string(),
    namespaces: z.array(z.string()).optional(),
    memory_types: z.array(MemoryTypeEnum).optional(),
    limit: z.number().int().positive().optional().default(20),
    offset: z.number().int().min(0).optional().default(0),
  },
  async ({ workspace_id, query, namespaces, memory_types, limit, offset }) => {
    const results = await searchAcrossNamespaces(sql, {
      workspaceId: workspace_id,
      query,
      namespaces,
      memoryTypes: memory_types,
      limit,
      offset,
    });
    return text({ results, count: results.length });
  },
);

server.tool(
  "memory_type_breakdown",
  "Get a breakdown of memories by type including storage estimates and importance metrics",
  {
    workspace_id: z.string(),
  },
  async ({ workspace_id }) => {
    const breakdown = await getMemoryTypeBreakdown(sql, workspace_id);
    return text({ breakdown });
  },
);

server.tool(
  "memory_suggest_type",
  "Suggest the best memory type for a piece of content based on its characteristics",
  {
    content: z.string(),
    metadata: z.record(z.any()).optional(),
  },
  async ({ content, metadata }) => {
    const suggested = suggestMemoryType(content, metadata);
    return text({ suggested_type: suggested });
  },
);

server.tool(
  "memory_migrate_type",
  "Migrate all memories of one type to another type for a workspace",
  {
    workspace_id: z.string(),
    from_type: MemoryTypeEnum,
    to_type: MemoryTypeEnum,
  },
  async ({ workspace_id, from_type, to_type }) => {
    const migrated = await migrateMemoryType(sql, workspace_id, from_type, to_type);
    return text({ migrated_count: migrated, from_type, to_type });
  },
);

// TTL extension and refresh tools
server.tool(
  "memory_extend_ttl",
  "Extend the TTL of a specific memory",
  {
    memory_id: z.string(),
    additional_seconds: z.number().int().positive(),
  },
  async ({ memory_id, additional_seconds }) => {
    const extended = await extendMemoryTTL(sql, memory_id, additional_seconds);
    return text({ extended, memoryId: memory_id, additionalSeconds: additional_seconds });
  },
);

server.tool(
  "memory_refresh_ttl",
  "Refresh the TTL of a memory to its original duration",
  { memory_id: z.string() },
  async ({ memory_id }) => {
    const refreshed = await refreshMemoryTTL(sql, memory_id);
    return text({ refreshed, memoryId: memory_id });
  },
);

server.tool(
  "memory_refresh_hot_ttl",
  "Refresh TTL for a hot (frequently accessed) memory, extending its lifetime",
  {
    workspace_id: z.string(),
    memory_id: z.string(),
    boost_seconds: z.number().int().positive().optional(),
  },
  async ({ workspace_id, memory_id, boost_seconds }) => {
    const refreshed = await refreshTTLForHotMemory(sql, workspace_id, memory_id, boost_seconds);
    return text({ refreshed, memoryId: memory_id });
  },
);

// Memory type management tools
server.tool(
  "memory_get_memories_by_type",
  "Get all memories of a specific type in a collection",
  {
    collection_id: z.string(),
    memory_type: MemoryTypeEnum,
    limit: z.number().int().positive().max(500).optional().default(100),
    offset: z.number().int().min(0).optional().default(0),
  },
  async ({ collection_id, memory_type, limit, offset }) => {
    const memories = await getMemoriesByType(sql, collection_id, memory_type, { limit, offset });
    return text({ memories, count: memories.length });
  },
);

server.tool(
  "memory_set_memory_expiry",
  "Set a custom expiry time for a specific memory",
  {
    memory_id: z.string(),
    expires_at: z.string().datetime().nullable(),
  },
  async ({ memory_id, expires_at }) => {
    await setMemoryExpiry(sql, memory_id, expires_at ? new Date(expires_at) : null);
    return text({ memoryId: memory_id, expiresAt: expires_at });
  },
);

server.tool(
  "memory_clear_expiry",
  "Clear the custom expiry on a memory (revert to type-based TTL)",
  { memory_id: z.string() },
  async ({ memory_id }) => {
    await clearMemoryExpiry(sql, memory_id);
    return text({ memoryId: memory_id, cleared: true });
  },
);

server.tool(
  "memory_get_ttl_stats",
  "Get tiered TTL statistics for a workspace (hot/warm/cold tier breakdown)",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const stats = await getTTLStats(sql, workspace_id);
    return text({ stats });
  },
);

// TTL bulk operations
server.tool(
  "memory_touch_many",
  "Refresh TTL for multiple memories at once (bulk touch without returning values)",
  {
    memory_ids: z.array(z.string()).describe("Memory UUIDs to refresh"),
    ttl_seconds: z.number().int().positive().optional().describe("Override TTL in seconds"),
  },
  async ({ memory_ids, ttl_seconds }) => {
    let touched = 0;
    for (const id of memory_ids) {
      const ok = ttl_seconds
        ? await refreshMemoryTTL(sql, id)
        : await refreshTTLForHotMemory(sql, id, id);
      if (ok) touched++;
    }
    return text({ touched, total: memory_ids.length });
  },
);

server.tool(
  "memory_evict_least_valuable",
  "Evict the least valuable memories from a collection to make room for new ones",
  {
    collection_id: z.string().describe("Collection UUID"),
    count: z.number().int().positive().optional().default(1).describe("Number of memories to evict"),
  },
  async ({ collection_id, count }) => {
    const evicted = await evictLeastValuable(sql, collection_id, count);
    return text({ evicted, count: evicted.length, ids: evicted.map((m: any) => m.id) });
  },
);

server.tool(
  "memory_get_hot_spots",
  "Find the memory hotspots (most frequently accessed regions) in a workspace",
  {
    workspace_id: z.string(),
    limit: z.number().int().positive().optional().default(10),
  },
  async ({ workspace_id, limit }) => {
    const spots = await getMemoryHotspots(sql, workspace_id, limit);
    return text({ spots, count: spots.length });
  },
);

// Single memory operations
server.tool(
  "memory_get",
  "Get a single memory by ID",
  { id: z.string().describe("Memory ID") },
  async ({ id }) => text(await getMemory(sql, id)),
);

// Embedding utilities
server.tool(
  "memory_generate_embedding",
  "Generate a vector embedding for text content (for semantic search)",
  {
    text: z.string().describe("Text content to embed"),
    model: z.string().optional().describe("Embedding model to use"),
  },
  async ({ text, model }) => {
    const embedding = await generateEmbedding(text, model);
    return text({ embedding, dimensions: embedding.length });
  },
);

server.tool(
  "memory_has_embedding_key",
  "Check if an embedding API key is configured",
  {},
  async () => text({ hasKey: hasEmbeddingKey() }),
);

// Cross-namespace search
server.tool(
  "memory_search_cross_namespace",
  "Search memories across multiple namespaces in a single query",
  {
    workspace_id: z.string(),
    text: z.string(),
    namespaces: z.array(z.string()).min(1).max(10),
    limit: z.number().optional().default(20),
    mode: z.enum(["semantic", "text", "hybrid"]).optional().default("hybrid"),
  },
  async ({ workspace_id, text, namespaces, limit, mode }) =>
    text(await searchCrossNamespace(sql, workspace_id, namespaces, text, mode, limit)),
);

// Bulk memory operations
server.tool(
  "memory_bulk_store",
  "Store multiple memories in a single batch call",
  {
    memories: z.array(z.object({
      workspace_id: z.string(),
      user_id: z.string().optional(),
      collection_id: z.string().optional(),
      content: z.string(),
      summary: z.string().optional(),
      importance: z.number().min(0).max(1).optional(),
      memory_type: MemoryTypeEnum.optional(),
      namespace: z.string().optional(),
      metadata: z.record(z.any()).optional(),
    })).min(1).max(100),
  },
  async ({ memories }) =>
    text(await bulkStoreMemories(sql, memories as any)),
);

server.tool(
  "memory_bulk_update",
  "Update multiple memories in a single batch call",
  {
    updates: z.array(z.object({
      id: z.string(),
      content: z.string().optional(),
      summary: z.string().optional(),
      importance: z.number().min(0).max(1).optional(),
      metadata: z.record(z.any()).optional(),
    })).min(1).max(100),
  },
  async ({ updates }) =>
    text(await bulkUpdateMemories(sql, updates as any)),
);

server.tool(
  "memory_bulk_delete",
  "Delete multiple memories in a single batch call",
  {
    ids: z.array(z.string()).min(1).max(100),
    workspace_id: z.string(),
  },
  async ({ ids, workspace_id }) =>
    text({ deleted: await bulkDeleteMemories(sql, ids, workspace_id) }),
);

// TTL tiered operations
server.tool(
  "memory_apply_soft_expire",
  "Apply soft-expiry markers to memories past their TTL but not yet purged",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
    grace_period_seconds: z.number().optional().default(86400),
  },
  async ({ workspace_id, namespace, grace_period_seconds }) =>
    text({ applied: await applySoftExpire(sql, workspace_id, namespace, grace_period_seconds) }),
);

server.tool(
  "memory_purge_soft_expired",
  "Permanently delete memories that have been soft-expired",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) =>
    text({ deleted: await purgeSoftExpired(sql, workspace_id, namespace) }),
);

// Typed memory queries
server.tool(
  "memory_query_episodic",
  "Query episodic memories (user experiences, events, conversations) for a workspace",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    limit: z.number().optional().default(50),
  },
  async ({ workspace_id, user_id, since, until, limit }) =>
    text(await queryEpisodicMemories(sql, workspace_id, user_id, { since: since ? new Date(since) : undefined, until: until ? new Date(until) : undefined, limit })),
);

server.tool(
  "memory_query_semantic",
  "Query semantic memories (facts, knowledge, learned information) for a workspace",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    limit: z.number().optional().default(50),
    min_importance: z.number().min(0).max(1).optional(),
  },
  async ({ workspace_id, user_id, limit, min_importance }) =>
    text(await querySemanticMemories(sql, workspace_id, user_id, { limit, minImportance: min_importance })),
);

// Fast rerank
server.tool(
  "memory_rerank_fast",
  "Rerank memories using a lightweight algorithm (faster than full rerank)",
  {
    workspace_id: z.string(),
    query: z.string(),
    memory_ids: z.array(z.string()),
    top_k: z.number().int().positive().optional().default(10),
  },
  async ({ workspace_id, query, memory_ids, top_k }) =>
    text(await rerankMemoriesFast(sql, workspace_id, query, memory_ids, top_k)),
);

// Memory timeline
server.tool(
  "memory_timeline",
  "Get a timeline of memories for a user within a date range",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    since: z.string().datetime(),
    until: z.string().datetime().optional(),
    limit: z.number().optional().default(100),
  },
  async ({ workspace_id, user_id, since, until, limit }) =>
    text(await getMemoryTimeline(sql, workspace_id, user_id, new Date(since), until ? new Date(until) : undefined, limit)),
);

