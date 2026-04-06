// --- TTL Sweeper tools ---

server.tool(
  "memory_start_ttl_sweeper",
  "Start the background TTL sweeper for automatic expired memory deletion",
  {
    interval_ms: z.number().int().positive().optional().default(60000),
  },
  async ({ interval_ms }) => {
    startTtlSweeper(() => sql, interval_ms);
    return text({ ok: true, message: `TTL sweeper started with interval ${interval_ms}ms` });
  },
);

server.tool(
  "memory_stop_ttl_sweeper",
  "Stop the background TTL sweeper",
  async () => {
    stopTtlSweeper();
    return text({ ok: true });
  },
);

server.tool(
  "memory_get_ttl_sweeper_stats",
  "Get TTL sweeper run statistics",
  async () => text(getTtlSweeperStats()),
);

server.tool(
  "memory_run_sweep",
  "Run a single TTL sweep for all expired memories",
  async () => {
    const deleted = await runSweep(sql);
    return text({ deleted, runAt: new Date() });
  },
);

server.tool(
  "memory_run_workspace_sweep",
  "Run TTL sweep for a specific workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const deleted = await runWorkspaceSweep(sql, workspace_id);
    return text({ deleted, workspaceId: workspace_id });
  },
);

server.tool(
  "memory_enforce_ttl_tier",
  "Enforce TTL tier for a specific memory type",
  {
    workspace_id: z.string(),
    memory_type: MemoryTypeEnum,
    max_age_seconds: z.number().int().positive().nullable(),
  },
  async ({ workspace_id, memory_type, max_age_seconds }) => {
    const deleted = await enforceTtlTier(sql, workspace_id, memory_type, max_age_seconds);
    return text({ deleted, memoryType: memory_type });
  },
);

server.tool(
  "memory_evict_by_age",
  "Evict oldest non-pinned memories to make room for new ones (LRU-style)",
  {
    workspace_id: z.string(),
    max_memories: z.number().int().positive(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, max_memories, namespace }) => {
    const evicted = await evictByAge(sql, workspace_id, max_memories, namespace);
    return text({ evicted, workspaceId: workspace_id });
  },
);

