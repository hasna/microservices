// ─── Memory Timeline ─────────────────────────────────────────────────────────

server.tool(
  "memory_get_timeline",
  "Get a chronological timeline of memories for a workspace (newest first)",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    namespace: z.string().optional(),
    start_date: z.string().datetime().optional(),
    end_date: z.string().datetime().optional(),
    limit: z.number().optional().default(100),
  },
  async ({ workspace_id, user_id, namespace, start_date, end_date, limit }) => {
    const { getMemoryTimeline } = await import("../lib/index.js");
    return text(await getMemoryTimeline(sql, workspace_id, user_id, namespace, start_date ? new Date(start_date) : undefined, end_date ? new Date(end_date) : undefined, limit));
  },
);

server.tool(
  "memory_get_before",
  "Get memories created before a given timestamp (pagination backward through time)",
  {
    workspace_id: z.string(),
    before: z.string().datetime(),
    limit: z.number().optional().default(50),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, before, limit, namespace }) => {
    const { getMemoriesBefore } = await import("../lib/index.js");
    return text(await getMemoriesBefore(sql, workspace_id, new Date(before), limit, namespace));
  },
);

server.tool(
  "memory_get_recent",
  "Get the most recently created memories",
  {
    workspace_id: z.string(),
    limit: z.number().optional().default(20),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, limit, namespace }) => {
    const { getRecentMemories } = await import("../lib/index.js");
    return text(await getRecentMemories(sql, workspace_id, limit, namespace));
  },
);

