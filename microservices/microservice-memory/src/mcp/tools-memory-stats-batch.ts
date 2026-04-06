// ─── Memory Stats & Batch Operations ──────────────────────────────────────────

server.tool(
  "memory_get_stats_summary",
  "Get aggregate statistics for a workspace — total memories, breakdown by type, namespace counts, importance distribution, and TTL coverage",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) => {
    const nsFilter = namespace ? sql`AND n.name = ${namespace}` : sql``;
    const [totals] = await sql`
      SELECT
        COUNT(DISTINCT m.id)::int AS total_memories,
        COUNT(DISTINCT m.collection_id)::int AS total_collections,
        COUNT(DISTINCT n.id)::int AS total_namespaces,
        AVG(m.importance)::float AS avg_importance,
        MIN(m.created_at) AS oldest_memory,
        MAX(m.updated_at) AS newest_memory
      FROM memory.memories m
      LEFT JOIN memory.namespaces n ON m.namespace_id = n.id
      WHERE n.workspace_id = ${workspace_id} ${nsFilter}
    `;
    const byType = await sql`
      SELECT m.memory_type, COUNT(*)::int AS count, AVG(m.importance)::float AS avg_importance
      FROM memory.memories m
      LEFT JOIN memory.namespaces n ON m.namespace_id = n.id
      WHERE n.workspace_id = ${workspace_id} ${nsFilter}
      GROUP BY m.memory_type
    `;
    const byNamespace = await sql`
      SELECT n.name, COUNT(m.id)::int AS memory_count, AVG(m.importance)::float AS avg_importance
      FROM memory.namespaces n
      LEFT JOIN memory.memories m ON m.namespace_id = n.id
      WHERE n.workspace_id = ${workspace_id} ${nsFilter}
      GROUP BY n.name
      ORDER BY memory_count DESC
    `;
    const [withTtl] = await sql`
      SELECT
        COUNT(CASE WHEN m.expires_at IS NOT NULL OR m.ttl_seconds > 0 THEN 1 END)::int AS memories_with_ttl,
        COUNT(CASE WHEN m.is_pinned THEN 1 END)::int AS pinned_count,
        COUNT(CASE WHEN m.importance > 0.7 THEN 1 END)::int AS high_importance_count
      FROM memory.memories m
      LEFT JOIN memory.namespaces n ON m.namespace_id = n.id
      WHERE n.workspace_id = ${workspace_id} ${nsFilter}
    `;
    return text({ workspace_id, namespace: namespace ?? "all", totals, by_type: byType, by_namespace: byNamespace, ttl_coverage: withTtl });
  },
);

server.tool(
  "memory_batch_get",
  "Retrieve multiple memories by their IDs in a single call — more efficient than individual lookups",
  {
    workspace_id: z.string(),
    memory_ids: z.array(z.string()),
    include_links: z.boolean().optional().default(false),
  },
  async ({ workspace_id, memory_ids, include_links }) => {
    if (!memory_ids.length) return text({ memories: [], count: 0 });
    const memories = await sql`
      SELECT m.id, m.workspace_id, m.namespace_id, m.collection_id, m.content,
             m.summary, m.importance, m.memory_type, m.priority, m.metadata,
             m.is_pinned, m.created_at, m.updated_at, m.expires_at, m.ttl_seconds,
             n.name AS namespace
      FROM memory.memories m
      LEFT JOIN memory.namespaces n ON m.namespace_id = n.id
      WHERE m.id IN ${sql(memory_ids)}
        AND n.workspace_id = ${workspace_id}
    `;
    let links: any[] = [];
    if (include_links) {
      const linkRows = await sql`
        SELECT ml.source_memory_id, ml.target_memory_id, ml.link_type, ml.strength
        FROM memory.memory_links ml
        WHERE ml.source_memory_id IN ${sql(memory_ids)}
      `;
      links = linkRows;
    }
    return text({ memories, count: memories.length, links: include_links ? links : undefined });
  },
);

server.tool(
  "memory_suggest_next",
  "Suggest memories most likely to be needed next based on recent recall patterns — uses access history and temporal locality",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    last_recalled_ids: z.array(z.string()).optional(),
    limit: z.number().optional().default(5),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, user_id, last_recalled_ids, limit, namespace }) => {
    // Get memories from the same namespaces/types as recently accessed ones
    let recencyFilter = sql`TRUE`;
    if (last_recalled_ids && last_recalled_ids.length > 0) {
      const [recent] = await sql`
        SELECT m.memory_type, m.namespace_id, COUNT(*)::int AS access_count
        FROM memory.memory_access_log mal
        JOIN memory.memories m ON m.id = mal.memory_id
        JOIN memory.namespaces n ON m.namespace_id = n.id
        WHERE mal.memory_id IN ${sql(last_recalled_ids)}
          AND n.workspace_id = ${workspace_id}
        GROUP BY m.memory_type, m.namespace_id
        ORDER BY access_count DESC
        LIMIT 3
      `;
      if (recent) {
        recencyFilter = sql`(m.memory_type = ${recent.memory_type} OR m.namespace_id = ${recent.namespace_id})`;
      }
    }
    const nsFilter = namespace ? sql`AND n.name = ${namespace}` : sql``;
    const userFilter = user_id ? sql`AND m.user_id = ${user_id}` : sql``;
    // Get high-importance, recently accessed memories not in the recall history
    const suggestions = await sql`
      SELECT m.id, m.content, m.summary, m.memory_type, m.importance,
             m.namespace_id, n.name AS namespace,
             COALESCE(ac.access_count, 0)::int AS recent_access_count,
             m.updated_at
      FROM memory.memories m
      LEFT JOIN memory.namespaces n ON m.namespace_id = n.id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS access_count
        FROM memory.memory_access_log mal
        WHERE mal.memory_id = m.id
          AND mal.accessed_at >= NOW() - INTERVAL '7 days'
      ) ac ON true
      WHERE n.workspace_id = ${workspace_id}
        AND m.is_archived = false
        AND m.is_pinned = false
        ${nsFilter}
        ${userFilter}
        ${last_recalled_ids && last_recalled_ids.length > 0 ? sql`AND m.id NOT IN ${sql(last_recalled_ids)}` : sql``}
        AND (${last_recalled_ids && last_recalled_ids.length > 0 ? recencyFilter : sql`TRUE`})
      ORDER BY ac.access_count DESC, m.importance DESC, m.updated_at DESC
      LIMIT ${limit ?? 5}
    `;
    return text({ suggestions, count: suggestions.length });
  },
);

server.tool(
  "memory_generate_handoff_summary",
  "Generate a comprehensive handoff summary of memories relevant to a topic for agent context transfer",
  {
    agent_id: z.string(),
    topic: z.string(),
    workspace_id: z.string(),
    max_memories: z.number().int().positive().optional().default(20),
    min_relevance_score: z.number().min(0).max(1).optional().default(0.3),
  },
  async ({ agent_id, topic, workspace_id, max_memories, min_relevance_score }) =>
    text(
      await generateMemoryHandoffSummary(sql, agent_id, topic, workspace_id, {
        maxMemories: max_memories,
        minRelevanceScore: min_relevance_score,
      }),
    ),
);

server.tool(
  "memory_transfer_context",
  "Transfer specific memories from one agent to another for cross-agent context sharing",
  {
    source_agent_id: z.string(),
    target_agent_id: z.string(),
    memory_ids: z.array(z.string()),
    reason: z.string().optional(),
    workspace_id: z.string(),
  },
  async ({ source_agent_id, target_agent_id, memory_ids, reason, workspace_id }) =>
    text(
      await transferMemoryContext(sql, source_agent_id, target_agent_id, memory_ids, reason),
    ),
);

server.tool(
  "memory_score_topic_relevance",
  "Score and rank memories by their relevance to a specific topic",
  {
    workspace_id: z.string(),
    topic: z.string(),
    limit: z.number().int().positive().optional().default(20),
    memory_type: MemoryTypeEnum.optional(),
  },
  async ({ workspace_id, topic, limit, memory_type }) =>
    text(
      await scoreMemoriesByTopicRelevance(sql, workspace_id, topic, {
        limit,
        memoryType: memory_type,
      }),
    ),
);

server.tool(
  "memory_get_prioritized_for_agent",
  "Get prioritized memories for an agent based on topic relevance and recency",
  {
    agent_id: z.string(),
    workspace_id: z.string(),
    topic: z.string(),
    max_memories: z.number().int().positive().optional().default(10),
  },
  async ({ agent_id, workspace_id, topic, max_memories }) =>
    text(
      await getPrioritizedMemoriesForAgent(sql, agent_id, workspace_id, topic, max_memories),
    ),
);

// --- Memory Version Diff Tools ---
server.tool(
  "memory_get_version",
  "Get a specific version of a memory",
  {
    memory_id: z.string(),
    version_id: z.string(),
  },
  async ({ memory_id, version_id }) =>
    text(await getVersionDiff(sql, memory_id, version_id)),
);

server.tool(
  "memory_list_versions",
  "List all versions of a memory, newest first",
  {
    memory_id: z.string(),
    limit: z.number().int().positive().optional().default(20),
    offset: z.number().int().nonnegative().optional().default(0),
  },
  async ({ memory_id, limit, offset }) =>
    text(await listVersionDiffs(sql, memory_id, limit, offset)),
);

server.tool(
  "memory_diff_versions",
  "Compare two versions of a memory to show what changed",
  {
    memory_id: z.string(),
    from_version_id: z.string(),
    to_version_id: z.string(),
  },
  async ({ memory_id, from_version_id, to_version_id }) =>
    text(await diffMemoryVersions(sql, memory_id, from_version_id, to_version_id)),
);

server.tool(
  "memory_version_timeline",
  "Get a summary of all changes across a memory's lifetime",
  {
    memory_id: z.string(),
  },
  async ({ memory_id }) =>
    text(await getMemoryVersionTimeline(sql, memory_id)),
);

// --- Recall Analytics Tools ---
server.tool(
  "memory_record_recall",
  "Record a memory recall event for analytics",
  {
    memory_id: z.string(),
    user_id: z.string(),
    workspace_id: z.string(),
    recall_method: z.enum(["search", "direct", "auto", "link", "context"]).optional().default("direct"),
    relevance_score: z.number().min(0).max(1).optional(),
    recall_latency_ms: z.number().positive().optional(),
  },
  async ({ memory_id, user_id, workspace_id, recall_method, relevance_score, recall_latency_ms }) => {
    await recordRecall(sql, memory_id, user_id, workspace_id, {
      recallMethod: recall_method as any,
      relevanceScore: relevance_score,
      recallLatencyMs: recall_latency_ms,
    });
    return text({ recorded: true });
  },
);

server.tool(
  "memory_get_recall_stats",
  "Get recall statistics for a workspace",
  {
    workspace_id: z.string(),
    since: z.string().optional(),
  },
  async ({ workspace_id, since }) =>
    text(await getRecallStats(sql, workspace_id, since)),
);

server.tool(
  "memory_get_recall_popularity",
  "Get most frequently recalled memories (popularity ranking)",
  {
    workspace_id: z.string(),
    namespace_id: z.string().optional(),
    limit: z.number().int().positive().optional().default(50),
    since: z.string().optional(),
  },
  async ({ workspace_id, namespace_id, limit, since }) =>
    text(await getMemoryRecallPopularity(sql, workspace_id, { namespaceId: namespace_id, limit, since })),
);

server.tool(
  "memory_get_recall_trend",
  "Get recall trend over time (daily buckets)",
  {
    workspace_id: z.string(),
    buckets: z.number().int().positive().optional().default(30),
  },
  async ({ workspace_id, buckets }) =>
    text(await getRecallTrend(sql, workspace_id, buckets)),
);

server.tool(
  "memory_find_recall_mismatches",
  "Find memories with high recall but low relevance",
  {
    workspace_id: z.string(),
    min_recalls: z.number().int().positive().optional().default(10),
  },
  async ({ workspace_id, min_recalls }) =>
    text(await findRecallMismatches(sql, workspace_id, min_recalls)),
);

server.tool(
  "memory_record_recall_miss",
  "Record a recall miss (query that found no good results)",
  {
    query_text: z.string(),
    user_id: z.string(),
    workspace_id: z.string(),
    namespace_id: z.string().optional(),
  },
  async ({ query_text, user_id, workspace_id, namespace_id }) => {
    await recordRecallMiss(sql, query_text, user_id, workspace_id, namespace_id);
    return text({ recorded: true });
  },
);

server.tool(
  "memory_get_recall_miss_patterns",
  "Get common queries that fail to find good results",
  {
    workspace_id: z.string(),
    limit: z.number().int().positive().optional().default(20),
  },
  async ({ workspace_id, limit }) =>
    text(await getRecallMissPatterns(sql, workspace_id, limit)),
);

server.tool(
  "memory_get_recall_heatmap",
  "Get recall heatmap (which hours/days have most recalls)",
  {
    workspace_id: z.string(),
    since: z.string().optional(),
  },
  async ({ workspace_id, since }) =>
    text(await getRecallHeatmap(sql, workspace_id, since)),
);

