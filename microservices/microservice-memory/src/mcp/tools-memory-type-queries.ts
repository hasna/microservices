// ─── Memory Type Queries ─────────────────────────────────────────────────────

server.tool(
  "memory_query_by_type",
  "Query memories of a specific type (episodic, semantic, procedural, context)",
  {
    workspace_id: z.string(),
    memory_type: MemoryTypeEnum,
    user_id: z.string().optional(),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ workspace_id, memory_type, user_id, limit, offset }) => {
    const { queryTypedMemories } = await import("../lib/memory-type-queries.js");
    return text(await queryTypedMemories(sql, workspace_id, memory_type, { userId: user_id, limit, offset }));
  },
);

server.tool(
  "memory_get_type_distribution",
  "Get distribution of memory types in a workspace (counts, percentages, avg importance per type)",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) => {
    const { getMemoryTypeDistribution } = await import("../lib/memory-type-queries.js");
    return text(await getMemoryTypeDistribution(sql, workspace_id, namespace));
  },
);

server.tool(
  "memory_count_by_type",
  "Get memory counts broken down by type",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) => {
    const { countMemoriesByType } = await import("../lib/memory-type-queries.js");
    return text(await countMemoriesByType(sql, workspace_id, namespace));
  },
);

server.tool(
  "memory_archive_by_type",
  "Archive all memories of a given type (set is_archived flag without deleting)",
  {
    workspace_id: z.string(),
    memory_type: MemoryTypeEnum,
    reason: z.string().optional(),
  },
  async ({ workspace_id, memory_type, reason }) => {
    const { archiveMemoriesByType } = await import("../lib/memory-type-queries.js");
    return text({ archived: await archiveMemoriesByType(sql, workspace_id, memory_type, reason) });
  },
);

