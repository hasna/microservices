// --- Episodic consolidation ---

server.tool(
  "memory_consolidate_episodic",
  "Consolidate episodic memories in a time window into a semantic summary memory",
  {
    workspace_id: z.string(),
    time_window_hours: z.number().optional().default(24),
    delete_old: z.boolean().optional().default(false),
  },
  async ({ workspace_id, time_window_hours, delete_old }) =>
    text(await consolidateEpisodicMemories(sql, workspace_id, time_window_hours, delete_old)),
);

server.tool(
  "memory_get_consolidation_candidates",
  "Get consolidation candidates — episodic memories eligible for consolidation",
  {
    workspace_id: z.string(),
    time_window_hours: z.number().optional().default(24),
  },
  async ({ workspace_id, time_window_hours }) =>
    text(await getConsolidationCandidates(sql, workspace_id, time_window_hours)),
);

