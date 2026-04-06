// ─── Token Usage Optimizer ────────────────────────────────────────────────────

server.tool(
  "llm_get_token_stats",
  "Get detailed token usage statistics for a workspace — breakdown by model, daily usage, cost per request",
  {
    workspace_id: z.string().uuid().describe("Workspace UUID"),
    period_start: z.string().optional().describe("ISO date — start of analysis window (default 30 days ago)"),
    period_end: z.string().optional().describe("ISO date — end of analysis window (default now)"),
  },
  async ({ workspace_id, period_start, period_end }) => {
    const { getTokenUsageStats } = await import("../lib/token-usage-optimizer.js");
    const stats = await getTokenUsageStats(sql, workspace_id, {
      periodStart: period_start ? new Date(period_start) : undefined,
      periodEnd: period_end ? new Date(period_end) : undefined,
    });
    return text(stats);
  },
);

server.tool(
  "llm_get_token_stats",
  "Get detailed token usage statistics for a workspace — breakdown by model, daily usage, cost per request",
  {
    workspace_id: z.string().uuid().describe("Workspace UUID"),
    period_start: z.string().optional().describe("ISO date — start of analysis window (default 30 days ago)"),
    period_end: z.string().optional().describe("ISO date — end of analysis window (default now)"),
  },
  async ({ workspace_id, period_start, period_end }) => {
    const { getTokenUsageStats } = await import("../lib/token-usage-optimizer.js");
    const stats = await getTokenUsageStats(sql, workspace_id, {
      periodStart: period_start ? new Date(period_start) : undefined,
      periodEnd: period_end ? new Date(period_end) : undefined,
    });
    return text(stats);
  },
);

server.tool(
  "llm_get_optimization_suggestions",
  "Get token optimization suggestions for a workspace — identify opportunities to reduce token usage and costs",
  {
    workspace_id: z.string().uuid().describe("Workspace UUID"),
  },
  async ({ workspace_id }) => {
    const { getTokenOptimizationSuggestions } = await import("../lib/token-usage-optimizer.js");
    const suggestions = await getTokenOptimizationSuggestions(sql, workspace_id);
    return text({ suggestions });
  },
);

server.tool(
  "llm_get_optimization_report",
  "Get a full token optimization report with statistics and actionable suggestions",
  {
    workspace_id: z.string().uuid().describe("Workspace UUID"),
  },
  async ({ workspace_id }) => {
    const { getTokenOptimizationReport } = await import("../lib/token-usage-optimizer.js");
    const report = await getTokenOptimizationReport(sql, workspace_id);
    return text(report);
  },
);

// --- Fallback strategy management ---

server.tool(
  "llm_set_fallback_strategy",
  "Set a fallback chain for a model — requests fail over to the next model in the chain on errors or circuit breaker open",
  {
    model_name: z.string().describe("Primary model name"),
    fallback_models: z.array(z.string()).describe("Ordered list of fallback models"),
    enabled: z.boolean().optional().default(true),
  },
  async ({ model_name, fallback_models, enabled }) => {
    const { setFallbackStrategy } = await import("../lib/costs.js");
    return text(await setFallbackStrategy(sql, model_name, fallback_models, enabled));
  },
);

server.tool(
  "llm_get_fallback_strategy",
  "Get the configured fallback chain for a model",
  { model_name: z.string().describe("Model name to get fallback chain for") },
  async ({ model_name }) => {
    const { getFallbackStrategy } = await import("../lib/costs.js");
    return text(await getFallbackStrategy(sql, model_name));
  },
);

// --- Model budget spend recording ---

server.tool(
  "llm_record_model_spend",
  "Record spend against a model's budget in a workspace — used for tracking costs per model",
  {
    workspace_id: z.string(),
    model_name: z.string(),
    cost_usd: z.number().describe("Cost in USD"),
    tokens_used: z.number().int().optional().describe("Total tokens used (prompt + completion)"),
  },
  async ({ workspace_id, model_name, cost_usd, tokens_used }) => {
    const { recordModelSpend } = await import("../lib/model-budgets.js");
    await recordModelSpend(sql, workspace_id, model_name, cost_usd, tokens_used);
    return text({ recorded: true });
  },
);

// --- Prompt versioning ---

server.tool(
  "llm_create_prompt_version",
  "Create a versioned snapshot of a prompt template before updating it — enables rollback and audit trail",
  {
    template_id: z.string().describe("Template ID to version"),
    content: z.string().describe("Current template content"),
    variables: z.array(z.string()).describe("Template variable names"),
    description: z.string().optional().describe("Version description"),
    changed_by: z.string().optional().describe("User who made the change"),
    change_reason: z.string().optional().describe("Reason for the change"),
  },
  async ({ template_id, content, variables, description, changed_by, change_reason }) => {
    const { createPromptVersion } = await import("../lib/prompt-versioning.js");
    const version = await createPromptVersion(sql, { templateId: template_id, content, variables, description, changedBy: changed_by, changeReason: change_reason });
    return text(version);
  },
);

server.tool(
  "llm_get_prompt_versions",
  "List all versions of a prompt template",
  { template_id: z.string().describe("Template ID to get versions for") },
  async ({ template_id }) => {
    const { getPromptVersions } = await import("../lib/prompt-versioning.js");
    const versions = await getPromptVersions(sql, template_id);
    return text({ versions, count: versions.length });
  },
);

server.tool(
  "llm_get_prompt_version",
  "Get a specific version of a prompt template",
  {
    template_id: z.string().describe("Template ID"),
    version_number: z.number().int().describe("Version number to retrieve"),
  },
  async ({ template_id, version_number }) => {
    const { getPromptVersion } = await import("../lib/prompt-versioning.js");
    const version = await getPromptVersion(sql, template_id, version_number);
    return text(version);
  },
);

server.tool(
  "llm_compare_prompt_versions",
  "Compare two versions of a prompt template side by side",
  {
    template_id: z.string().describe("Template ID"),
    version_a: z.number().int().describe("First version number"),
    version_b: z.number().int().describe("Second version number"),
  },
  async ({ template_id, version_a, version_b }) => {
    const { comparePromptVersions } = await import("../lib/prompt-versioning.js");
    const comparison = await comparePromptVersions(sql, template_id, version_a, version_b);
    return text(comparison);
  },
);

server.tool(
  "llm_restore_prompt_version",
  "Restore a prompt template to a previous version",
  {
    template_id: z.string().describe("Template ID to restore"),
    version_number: z.number().int().describe("Version number to restore to"),
    changed_by: z.string().optional().describe("User performing the restore"),
  },
  async ({ template_id, version_number, changed_by }) => {
    const { restorePromptVersion } = await import("../lib/prompt-versioning.js");
    const restored = await restorePromptVersion(sql, template_id, version_number, changed_by);
    return text(restored);
  },
);

// --- Model comparison ---

server.tool(
  "llm_compare_models",
  "Run a side-by-side benchmark comparison of multiple models on the same prompt",
  {
    workspace_id: z.string().uuid().optional().describe("Workspace UUID for usage tracking"),
    benchmark_prompt: z.string().describe("The prompt to benchmark all models with"),
    models: z.array(z.string()).describe("List of model names to compare"),
    system_prompt: z.string().optional().describe("Optional system prompt to prepend"),
  },
  async ({ workspace_id, benchmark_prompt, models, system_prompt }) => {
    const { compareModels } = await import("../lib/model-comparison.js");
    const results = await compareModels(sql, { workspaceId: workspace_id, benchmarkPrompt: benchmark_prompt, models, systemPrompt: system_prompt });
    return text({ results, winner: results.find(r => !r.error)?.model ?? null });
  },
);

server.tool(
  "llm_get_comparisons",
  "Get historical model comparison results",
  {
    workspace_id: z.string().uuid().optional().describe("Filter by workspace"),
    limit: z.number().int().optional().default(20).describe("Max results to return"),
  },
  async ({ workspace_id, limit }) => {
    const { getModelComparisons } = await import("../lib/model-comparison.js");
    const comparisons = await getModelComparisons(sql, { workspaceId: workspace_id, limit });
    return text({ comparisons, count: comparisons.length });
  },
);

server.tool(
  "llm_get_best_model",
  "Get the best-performing model recommendation based on historical comparisons",
  { workspace_id: z.string().uuid().optional().describe("Workspace UUID") },
  async ({ workspace_id }) => {
    const { getBestModelRecommendation } = await import("../lib/model-comparison.js");
    const rec = await getBestModelRecommendation(sql, { workspaceId: workspace_id });
    return text(rec);
  },
);

// --- Pre-call cost estimation ---

server.tool(
  "llm_estimate_cost",
  "Estimate the cost of an LLM call before making it",
  {
    workspace_id: z.string().uuid().describe("Workspace UUID"),
    model: z.string().describe("Model name"),
    prompt_tokens: z.number().int().describe("Estimated number of prompt tokens"),
    max_tokens: z.number().int().describe("Maximum tokens to generate"),
  },
  async ({ workspace_id, model, prompt_tokens, max_tokens }) => {
    const { estimateCallCost } = await import("../lib/cost-estimation.js");
    const estimate = await estimateCallCost(sql, { workspaceId: workspace_id, model, promptTokens: prompt_tokens, maxTokens: max_tokens });
    return text(estimate);
  },
);

server.tool(
  "llm_finalize_estimate",
  "Update a cost estimate with the actual cost after a call completes",
  {
    estimate_id: z.string().uuid().describe("Cost estimate ID returned from llm_estimate_cost"),
    actual_cost_usd: z.number().describe("Actual cost in USD"),
  },
  async ({ estimate_id, actual_cost_usd }) => {
    const { finalizeCostEstimate } = await import("../lib/cost-estimation.js");
    await finalizeCostEstimate(sql, { estimateId: estimate_id, actualCost: actual_cost_usd });
    return text({ updated: true });
  },
);

server.tool(
  "llm_batch_estimate_costs",
  "Estimate costs for multiple models at once — useful for model selection decisions",
  {
    workspace_id: z.string().uuid().describe("Workspace UUID"),
    models: z.array(z.string()).describe("List of model names to estimate for"),
    prompt_tokens: z.number().int().describe("Estimated prompt tokens"),
    max_tokens: z.number().int().describe("Max tokens to generate"),
  },
  async ({ workspace_id, models, prompt_tokens, max_tokens }) => {
    const { estimateBatchCosts } = await import("../lib/cost-estimation.js");
    const estimates = await estimateBatchCosts(sql, { workspaceId: workspace_id, models, promptTokens: prompt_tokens, maxTokens: max_tokens });
    // Sort by cost ascending
    estimates.sort((a, b) => a.estimated_cost_usd - b.estimated_cost_usd);
    return text({ estimates, cheapest: estimates[0]?.model ?? null });
  },
);

server.tool(
  "llm_get_estimate_accuracy",
  "Get cost estimation accuracy statistics",
  {
    workspace_id: z.string().uuid().optional().describe("Filter by workspace"),
    model: z.string().optional().describe("Filter by model"),
  },
  async ({ workspace_id, model }) => {
    const { getCostEstimateAccuracy } = await import("../lib/cost-estimation.js");
    const stats = await getCostEstimateAccuracy(sql, { workspaceId: workspace_id, model });
    return text(stats);
  },
);

// --- Chain health dashboard ---

server.tool(
  "llm_get_chain_health",
  "Get a high-level fallback chain health summary for a workspace — success rate, avg latency, fallback hit rate, and cost per provider",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    period_hours: z.number().optional().default(168).describe("Time window in hours (default 168 = 7 days)"),
  },
  async ({ workspace_id, period_hours }) => {
    const { getProviderChainStats } = await import("../lib/fallback-chains.js");
    const { listProviderHealth } = await import("../lib/provider-health.js");
    const { getWorkspaceBudget } = await import("../lib/costs.js");

    const [chainStats, providerHealth, budget] = await Promise.all([
      getProviderChainStats(sql, workspace_id),
      listProviderHealth(sql, { periodHours: period_hours }),
      getWorkspaceBudget(sql, workspace_id),
    ]);

    // Get fallback rate from DB (executions where providers_tried > 1)
    const fallbackRow = await sql<[{ total_chains: bigint; total_fallbacks: bigint }]>`
      SELECT
        COUNT(*) as total_chains,
        COUNT(*) FILTER (WHERE providers_tried > 1) as total_fallbacks
      FROM llm.fallback_chain_executions
      WHERE workspace_id = ${workspace_id}
        AND created_at >= NOW() - INTERVAL '${sql.unsafe(String(period_hours))} hours'
    `;

    const totalChains = Number(fallbackRow[0]?.total_chains ?? 0n);
    const totalFallbacks = Number(fallbackRow[0]?.total_fallbacks ?? 0n);

    // Enrich chain stats with health data
    const providerMap = Object.fromEntries(providerHealth.map((p: any) => [p.provider, p]));
    const enriched = chainStats.map((ps: any) => ({
      ...ps,
      health: providerMap[ps.provider] ?? null,
    }));

    return text({
      workspace_id,
      period_hours,
      providers: enriched,
      total_chains: totalChains,
      total_fallbacks: totalFallbacks,
      fallback_rate_pct: totalChains > 0
        ? Math.round((totalFallbacks / totalChains) * 10000) / 100
        : 0,
      budget: budget ?? null,
    });
  },
);

// --- Budget burn rate analysis ---

server.tool(
  "llm_get_budget_burn_rate",
  "Get budget burn rate analysis — current spend, days elapsed, daily burn rate, projected month-end spend, and days until budget exhausted",
  {
    workspace_id: z.string().describe("Workspace UUID"),
  },
  async ({ workspace_id }) => {
    const { getWorkspaceBudget } = await import("../lib/costs.js");
    const { getWorkspaceUsageSummary } = await import("../lib/usage-analytics.js");
    const { forecastUsage } = await import("../lib/budget-scheduler.js");

    const [budget, usage, forecast] = await Promise.all([
      getWorkspaceBudget(sql, workspace_id),
      getWorkspaceUsageSummary(sql, { workspaceId: workspace_id, periodHours: 720 }),
      forecastUsage(sql, workspace_id),
    ]);

    if (!budget) return text({ error: "No budget set for workspace", workspace_id });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed = Math.max(1, Math.ceil((now.getTime() - startOfMonth.getTime()) / (1000 * 60 * 60 * 24)));
    const dailyBurnRate = daysElapsed > 0 ? (usage.total_cost_usd / daysElapsed) : 0;
    const daysRemaining = daysInMonth - daysElapsed;
    const projectedSpend = dailyBurnRate * daysInMonth;
    const daysUntilExhausted = dailyBurnRate > 0 && budget.monthly_limit_usd > 0
      ? Math.floor(budget.monthly_limit_usd / dailyBurnRate)
      : null;

    return text({
      workspace_id,
      budget_monthly_limit_usd: budget.monthly_limit_usd,
      current_spend_usd: usage.total_cost_usd,
      utilization_pct: budget.monthly_limit_usd > 0
        ? Math.round((usage.total_cost_usd / budget.monthly_limit_usd) * 10000) / 100
        : 0,
      days_elapsed: daysElapsed,
      days_remaining,
      days_in_month: daysInMonth,
      daily_burn_rate_usd: Math.round(dailyBurnRate * 100) / 100,
      projected_month_end_spend_usd: Math.round(projectedSpend * 100) / 100,
      days_until_exhausted,
      forecast: forecast ?? null,
    });
  },
);

// --- Token velocity (tokens per hour trend) ---

server.tool(
  "llm_get_token_velocity",
  "Get token usage velocity (tokens per hour) over a time period — useful for detecting usage spikes or drops",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    period_hours: z.number().optional().default(24).describe("Time window in hours"),
    bucket_minutes: z.number().optional().default(60).describe("Aggregation bucket in minutes"),
  },
  async ({ workspace_id, period_hours, bucket_minutes }) => {
    const rows = await sql<{ bucket: Date; total_tokens: bigint }[]>`
      SELECT
        date_trunc('minute', created_at) -
          (EXTRACT(MINUTE FROM created_at)::int % ${bucket_minutes}) * interval '1 minute' AS bucket,
        SUM(prompt_tokens + completion_tokens) AS total_tokens
      FROM llm.model_spend
      WHERE workspace_id = ${workspace_id}
        AND created_at >= NOW() - INTERVAL '${sql.unsafe(String(period_hours))} hours'
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    const buckets = rows.map((r: any) => ({
      timestamp: r.bucket,
      tokens_per_hour: Math.round((Number(r.total_tokens) / bucket_minutes) * 60 * 100) / 100,
    }));

    const totalTokens = rows.reduce((sum: bigint, r: any) => sum + r.total_tokens, 0n);
    const avgTokensPerHour = buckets.length > 0
      ? Math.round((Number(totalTokens) / period_hours) * 100) / 100
      : 0;

    return text({
      workspace_id,
      period_hours,
      bucket_minutes,
      buckets,
      avg_tokens_per_hour: avgTokensPerHour,
      total_tokens: Number(totalTokens),
    });
  },
);

server.tool(
  "llm_prompt_diff",
  "Compute a detailed diff between two versions of a prompt template",
  {
    template_id: z.string().describe("Prompt template UUID"),
    version_a: z.number().int().positive().describe("First version number to compare"),
    version_b: z.number().int().positive().describe("Second version number to compare"),
  },
  async ({ template_id, version_a, version_b }) => {
    const diff = await computePromptDiff(sql, template_id, version_a, version_b);
    return text(diff);
  },
);

server.tool(
  "llm_prompt_side_by_side",
  "Get a side-by-side comparison of two prompt template versions",
  {
    template_id: z.string().describe("Prompt template UUID"),
    version_a: z.number().int().positive().describe("First version number"),
    version_b: z.number().int().positive().describe("Second version number"),
  },
  async ({ template_id, version_a, version_b }) => {
    const comparison = await getPromptVersionSideBySide(sql, template_id, version_a, version_b);
    return text(comparison);
  },
);

