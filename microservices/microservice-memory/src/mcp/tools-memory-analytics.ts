// ─── Memory Analytics ─────────────────────────────────────────────────────────

server.tool(
  "memory_get_trends",
  "Get memory creation and access trends over a time period",
  {
    workspace_id: z.string(),
    period_days: z.number().optional().default(30),
  },
  async ({ workspace_id, period_days }) => {
    const { getMemoryTrends } = await import("../lib/memory-analytics.js");
    return text(await getMemoryTrends(sql, workspace_id, period_days));
  },
);

server.tool(
  "memory_get_health_score",
  "Compute overall health score for a workspace's memory system",
  {
    workspace_id: z.string(),
  },
  async ({ workspace_id }) => {
    const { computeMemoryHealthScore } = await import("../lib/memory-analytics.js");
    return text(await computeMemoryHealthScore(sql, workspace_id));
  },
);

server.tool(
  "memory_get_type_trend",
  "Get memory type distribution over time",
  {
    workspace_id: z.string(),
    days: z.number().optional().default(30),
  },
  async ({ workspace_id, days }) => {
    const { getMemoryTypeTrend } = await import("../lib/memory-analytics.js");
    return text(await getMemoryTypeTrend(sql, workspace_id, days));
  },
);

server.tool(
  "memory_get_access_heatmap",
  "Get access heatmap (hour × day-of-week) for a workspace",
  {
    workspace_id: z.string(),
    days: z.number().optional().default(30),
  },
  async ({ workspace_id, days }) => {
    const { getAccessHeatmap } = await import("../lib/memory-analytics.js");
    return text(await getAccessHeatmap(sql, workspace_id, days));
  },
);

