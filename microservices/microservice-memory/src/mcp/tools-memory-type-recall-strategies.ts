// ─── Memory-type Recall Strategies ─────────────────────────────────────────────

server.tool(
  "memory_recall_with_strategies",
  "Recall memories using type-specific scoring strategies — episodic uses recency, semantic uses importance, procedural uses exact match, context decays fast",
  {
    workspace_id: z.string(),
    query: z.string().optional(),
    memory_types: z.array(z.enum(["episodic", "semantic", "procedural", "context"])).optional(),
    limit: z.number().int().positive().optional().default(20),
    namespace: z.string().optional(),
    collection_id: z.string().optional(),
    min_importance: z.number().min(0).max(1).optional(),
  },
  async ({ workspace_id, query, memory_types, limit, namespace, collection_id, min_importance }) => {
    const { recallWithStrategies } = await import("../lib/memory-type-recall-strategies.js");
    return text(await recallWithStrategies(sql, {
      workspaceId: workspace_id,
      query: query ?? undefined,
      memoryTypes: memory_types ?? undefined,
      limit: limit ?? 20,
      namespace: namespace ?? undefined,
      collectionId: collection_id ?? undefined,
      minImportance: min_importance ?? undefined,
    }));
  },
);

server.tool(
  "memory_get_recall_breakdown",
  "Get breakdown of recall scores by memory type — shows count and avg/top scores per type",
  {
    workspace_id: z.string(),
    query: z.string().optional(),
  },
  async ({ workspace_id, query }) => {
    const { getRecallBreakdown } = await import("../lib/memory-type-recall-strategies.js");
    return text(await getRecallBreakdown(sql, workspace_id, query));
  },
);

server.tool(
  "memory_bulk_search",
  "Search memories with multiple queries in a single batch call — returns per-query results",
  {
    queries: z.array(z.object({
      text: z.string().describe("Search query text"),
      mode: z.enum(["semantic", "text", "hybrid"]).optional(),
      limit: z.number().int().positive().optional().default(5),
      namespace_id: z.string().optional(),
    })).describe("Array of search queries to execute"),
    workspace_id: z.string().describe("Workspace ID"),
  },
  async ({ queries, workspace_id }) => {
    const results = await Promise.all(
      queries.map((q, i) =>
        searchMemories(sql, {
          workspaceId: workspace_id,
          text: q.text,
          mode: q.mode ?? "semantic",
          limit: q.limit ?? 5,
          namespaceId: q.namespace_id,
        }).then(memories => ({ index: i, query: q.text, memories, count: memories.length }))
      )
    );
    return text({
      total_queries: queries.length,
      results,
      total_matches: results.reduce((sum, r) => sum + r.count, 0),
    });
  },
);

server.tool(
  "memory_workspace_dashboard",
  "Get a quick at-a-glance memory dashboard for a workspace — counts by type, namespace distribution, and health score",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period_days: z.number().int().positive().optional().default(7).describe("Period in days for trend data"),
  },
  async ({ workspace_id, period_days }) => {
    const { getMemoryTrends, computeMemoryHealthScore } = await import("../lib/memory-analytics.js");
    const [typeDist, trends, health] = await Promise.all([
      getMemoryTypeDistribution(sql, workspace_id),
      getMemoryTrends(sql, workspace_id, period_days),
      computeMemoryHealthScore(sql, workspace_id),
    ]);

    const nsCounts = await sql`
      SELECT namespace_id, COUNT(*) as count
      FROM memories.memories
      WHERE workspace_id = ${workspace_id}
      GROUP BY namespace_id
    `;

    return text({
      workspace_id,
      period_days,
      total_memories: typeDist.reduce((s: number, t: { count: number }) => s + t.count, 0),
      by_type: typeDist,
      by_namespace: nsCounts.map((r: { namespace_id: string; count: string }) => ({
        namespace_id: r.namespace_id,
        count: parseInt(r.count, 10),
      })),
      trends,
      health,
    });
  },
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
