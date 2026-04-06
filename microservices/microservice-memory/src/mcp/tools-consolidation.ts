// ─── Consolidation ────────────────────────────────────────────────────────────

server.tool(
  "memory_consolidate_episodic",
  "Consolidate episodic memories into semantic memories — summarization and storage of key facts",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
    dry_run: z.boolean().optional().default(false),
  },
  async ({ workspace_id, namespace, dry_run }) => {
    const { consolidateEpisodicMemories } = await import("../lib/consolidation.js");
    return text(await consolidateEpisodicMemories(sql, workspace_id, namespace, dry_run));
  },
);

server.tool(
  "memory_get_consolidation_candidates",
  "Get episodic memories that are good candidates for consolidation (old, unlinked, low importance)",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
    max_age_days: z.number().optional().default(30),
    limit: z.number().optional().default(50),
  },
  async ({ workspace_id, namespace, max_age_days, limit }) => {
    const { getConsolidationCandidates } = await import("../lib/consolidation.js");
    return text(await getConsolidationCandidates(sql, workspace_id, namespace, max_age_days, limit));
  },
);

server.tool(
  "memory_rerank",
  "Rerank memories using a scoring function that considers recency, importance, link centrality, and recall frequency",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
    boost_recency: z.boolean().optional().default(true),
    boost_importance: z.boolean().optional().default(true),
    boost_links: z.boolean().optional().default(true),
    boost_recall: z.boolean().optional().default(true),
    limit: z.number().optional().default(100),
  },
  async ({ workspace_id, namespace, boost_recency, boost_importance, boost_links, boost_recall, limit }) => {
    const { rerankMemories } = await import("../lib/rerank.js");
    return text(await rerankMemories(sql, workspace_id, namespace, {
      boostRecency: boost_recency, boostImportance: boost_importance, boostLinks: boost_links, boostRecall: boost_recall, limit
    }));
  },
);

