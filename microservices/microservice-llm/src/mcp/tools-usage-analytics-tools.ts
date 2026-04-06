// --- Usage analytics tools ---

server.tool(
  "llm_usage_summary",
  "Get usage summary for a workspace (total requests, tokens, cost)",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period_hours: z.number().optional().default(720).describe("Time window in hours (default 720 = 30 days)"),
  },
  async ({ workspace_id, period_hours }) =>
    text(await getWorkspaceUsageSummary(sql, { workspaceId: workspace_id, periodHours: period_hours })),
);

server.tool(
  "llm_model_breakdown",
  "Get per-model usage and cost breakdown for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period_hours: z.number().optional().default(720).describe("Time window in hours"),
    limit: z.number().optional().default(20).describe("Max models to return"),
  },
  async ({ workspace_id, period_hours, limit }) =>
    text(await getModelBreakdown(sql, { workspaceId: workspace_id, periodHours: period_hours, limit })),
);

server.tool(
  "llm_daily_usage",
  "Get daily usage trend for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period_days: z.number().optional().default(30).describe("Number of past days to include"),
  },
  async ({ workspace_id, period_days }) =>
    text(await getDailyUsage(sql, { workspaceId: workspace_id, periodDays: period_days })),
);

server.tool(
  "llm_provider_breakdown",
  "Get per-provider usage and cost breakdown for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period_hours: z.number().optional().default(720).describe("Time window in hours"),
  },
  async ({ workspace_id, period_hours }) =>
    text(await getProviderBreakdown(sql, { workspaceId: workspace_id, periodHours: period_hours })),
);

server.tool(
  "llm_top_users",
  "Get top users by LLM usage and cost for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period_hours: z.number().optional().default(720).describe("Time window in hours"),
    limit: z.number().optional().default(10).describe("Max users to return"),
  },
  async ({ workspace_id, period_hours, limit }) =>
    text(await getTopUsers(sql, { workspaceId: workspace_id, periodHours: period_hours, limit })),
);

