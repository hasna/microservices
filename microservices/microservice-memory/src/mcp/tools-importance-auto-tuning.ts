// ─── Importance Auto-tuning ──────────────────────────────────────────────────

server.tool(
  "memory_analyze_importance_tuning",
  "Analyze access patterns and suggest importance adjustments for a workspace",
  {
    workspace_id: z.string(),
    lookback_days: z.number().optional().default(30),
  },
  async ({ workspace_id, lookback_days }) => {
    const { analyzeImportanceTuning } = await import("../lib/memory-importance-tuning.js");
    return text(await analyzeImportanceTuning(sql, workspace_id, lookback_days));
  },
);

server.tool(
  "memory_apply_importance_tuning",
  "Apply importance tuning suggestions to update memory scores",
  {
    workspace_id: z.string(),
    min_delta: z.number().optional().default(0.05),
  },
  async ({ workspace_id, min_delta }) => {
    const { applyImportanceTuning } = await import("../lib/memory-importance-tuning.js");
    return text(await applyImportanceTuning(sql, workspace_id, min_delta));
  },
);

server.tool(
  "memory_get_most_improved",
  "Get memories with the most improved importance scores",
  {
    workspace_id: z.string(),
    limit: z.number().optional().default(20),
  },
  async ({ workspace_id, limit }) => {
    const { getMostImprovedMemories } = await import("../lib/memory-importance-tuning.js");
    return text(await getMostImprovedMemories(sql, workspace_id, limit));
  },
);

