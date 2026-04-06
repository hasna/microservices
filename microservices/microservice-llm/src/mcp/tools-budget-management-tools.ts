// --- Budget management tools ---

server.tool(
  "llm_get_workspace_budget",
  "Get the current monthly budget for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
  },
  async ({ workspace_id }) => {
    const budget = await getWorkspaceBudget(sql, workspace_id);
    return text(budget ?? { error: "No budget set for workspace" });
  },
);

server.tool(
  "llm_set_workspace_budget",
  "Set a monthly spending budget for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    monthly_limit_cents: z.number().int().nonnegative().describe("Monthly limit in cents"),
    alert_threshold_pct: z.number().int().min(1).max(99).optional().default(80).describe("Alert threshold percentage"),
    enabled: z.boolean().optional().default(true),
  },
  async ({ workspace_id, monthly_limit_cents, alert_threshold_pct, enabled }) => {
    const budget = await setWorkspaceBudget(sql, {
      workspaceId: workspace_id,
      monthlyLimitCents: monthly_limit_cents,
      alertThresholdPct: alert_threshold_pct ?? 80,
      enabled: enabled ?? true,
    });
    return text(budget);
  },
);

server.tool(
  "llm_record_spend",
  "Record a spend event for a workspace (for manual tracking)",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    amount_cents: z.number().int().describe("Amount spent in cents"),
    model: z.string().describe("Model used"),
    provider: z.string().describe("Provider used"),
    tokens_used: z.number().int().optional().describe("Total tokens used"),
    request_id: z.string().optional().describe("Optional request UUID"),
  },
  async ({ workspace_id, amount_cents, model, provider, tokens_used, request_id }) => {
    const record = await recordSpend(sql, {
      workspaceId: workspace_id,
      amountCents: amount_cents,
      model,
      provider,
      tokensUsed: tokens_used,
      requestId: request_id,
    });
    return text(record);
  },
);

server.tool(
  "llm_calculate_cost",
  "Calculate the cost of a request based on token usage",
  {
    model: z.string().describe("Model name"),
    prompt_tokens: z.number().int().describe("Number of prompt tokens"),
    completion_tokens: z.number().int().describe("Number of completion tokens"),
  },
  async ({ model, prompt_tokens, completion_tokens }) => {
    const cost = calculateCost(model, prompt_tokens, completion_tokens);
    return text({ cost_usd: cost, model, prompt_tokens, completion_tokens });
  },
);

