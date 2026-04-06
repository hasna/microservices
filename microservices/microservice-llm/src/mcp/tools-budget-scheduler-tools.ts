// --- Budget scheduler tools ---

server.tool(
  "llm_create_budget_schedule",
  "Create a budget monitoring schedule for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    schedule_type: z.enum(["periodic", "on_demand"]).optional().default("on_demand").describe("Schedule type"),
    cron_expression: z.string().optional().describe("Cron expression (e.g. '0 0 * * *' for daily)"),
    action: z.string().optional().default("check_threshold").describe("Action: check_threshold, check_exceeded, reset_monthly, alert_webhook"),
    alert_at_pct: z.number().optional().describe("Alert at this percentage (0-100)"),
    webhook_on_threshold: z.boolean().optional().default(false).describe("Send webhook on threshold"),
    auto_rollover: z.boolean().optional().default(false).describe("Auto-reset spend on new month"),
  },
  async ({ workspace_id, schedule_type, cron_expression, action, alert_at_pct, webhook_on_threshold, auto_rollover }) => {
    const schedule = await createBudgetSchedule(sql, workspace_id, {
      scheduleType: schedule_type,
      cronExpression: cron_expression,
      action: action as any,
      config: { alert_at_pct, webhook_on_threshold, auto_rollover },
    });
    return text(schedule);
  },
);

server.tool(
  "llm_list_budget_schedules",
  "List all budget schedules for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
  },
  async ({ workspace_id }) =>
    text(await listBudgetSchedules(sql, workspace_id)),
);

server.tool(
  "llm_get_budget_schedule",
  "Get a specific budget schedule by ID",
  {
    schedule_id: z.string().describe("Schedule UUID"),
  },
  async ({ schedule_id }) => {
    const schedule = await getBudgetSchedule(sql, schedule_id);
    return text(schedule ?? { error: "Not found" });
  },
);

server.tool(
  "llm_run_budget_schedule",
  "Trigger a budget schedule immediately (on-demand)",
  {
    schedule_id: z.string().describe("Schedule UUID"),
  },
  async ({ schedule_id }) => {
    const result = await runBudgetSchedule(sql, schedule_id);
    return text(result);
  },
);

server.tool(
  "llm_cancel_budget_schedule",
  "Cancel a pending or failed budget schedule",
  {
    schedule_id: z.string().describe("Schedule UUID"),
  },
  async ({ schedule_id }) => {
    const schedule = await cancelBudgetSchedule(sql, schedule_id);
    return text(schedule ?? { error: "Not found or not cancellable" });
  },
);

server.tool(
  "llm_delete_budget_schedule",
  "Delete a budget schedule",
  {
    schedule_id: z.string().describe("Schedule UUID"),
  },
  async ({ schedule_id }) => {
    const deleted = await deleteBudgetSchedule(sql, schedule_id);
    return text({ deleted });
  },
);

server.tool(
  "llm_budget_check_history",
  "Get budget check history for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    limit: z.number().optional().default(50).describe("Max results"),
  },
  async ({ workspace_id, limit }) =>
    text(await getBudgetCheckHistory(sql, workspace_id, limit)),
);

server.tool(
  "llm_process_due_schedules",
  "Process all periodic budget schedules that are due (for cron-triggered workers)",
  {},
  async () => {
    const processed = await processDueSchedules(sql);
    return text({ processed });
  },
);

// Usage forecasting

server.tool(
  "llm_forecast_usage",
  "Forecast end-of-month spend for a workspace based on current usage trends",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const forecast = await forecastUsage(sql, workspace_id);
    return forecast ? text(forecast) : text({ error: "No budget found for workspace" });
  },
);

server.tool(
  "llm_forecast_all_workspaces",
  "Get usage forecasts for all workspaces with budgets",
  {},
  async () => text(await forecastAllWorkspaces(sql)),
);

// Token usage optimizer

server.tool(
  "llm_get_token_usage_stats",
  "Get token usage statistics for a workspace over a time period",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    period_start: z.string().optional().describe("ISO date string for period start (default: 30 days ago)"),
    period_end: z.string().optional().describe("ISO date string for period end (default: now)"),
  },
  async ({ workspace_id, period_start, period_end }) => {
    const stats = await getTokenUsageStats(sql, workspace_id, {
      periodStart: period_start ? new Date(period_start) : undefined,
      periodEnd: period_end ? new Date(period_end) : undefined,
    });
    return stats ? text(stats) : text({ error: "No usage data found for workspace" });
  },
);

server.tool(
  "llm_get_token_optimization_suggestions",
  "Get cost optimization suggestions for a workspace based on usage patterns",
  {
    workspace_id: z.string().describe("Workspace UUID"),
  },
  async ({ workspace_id }) => {
    const suggestions = await getTokenOptimizationSuggestions(sql, workspace_id);
    return text({ suggestions, count: suggestions.length });
  },
);

server.tool(
  "llm_get_token_optimization_report",
  "Get a complete optimization report with stats and actionable suggestions",
  {
    workspace_id: z.string().describe("Workspace UUID"),
  },
  async ({ workspace_id }) => {
    const report = await getTokenOptimizationReport(sql, workspace_id);
    return report ? text(report) : text({ error: "No usage data found for workspace" });
  },
);

