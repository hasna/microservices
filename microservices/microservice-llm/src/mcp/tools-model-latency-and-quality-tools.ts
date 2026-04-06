// --- Model latency and quality tools ---

server.tool(
  "llm_get_model_latency_stats",
  "Get latency percentiles (p50/p95/p99) for a specific model",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    model: z.string().describe("Model name"),
  },
  async ({ workspace_id, model }) => {
    const stats = await getModelLatencyStats(sql, workspace_id, model);
    if (!stats) return text({ error: "No latency data found for this model" });
    return text(stats);
  },
);

server.tool(
  "llm_get_all_model_latency_stats",
  "Get latency percentiles for all models in a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    period_hours: z.number().optional().default(24).describe("Time window in hours"),
  },
  async ({ workspace_id, period_hours }) => {
    const stats = await getAllModelLatencyStats(sql, workspace_id, period_hours);
    return text({ stats, count: stats.length });
  },
);

server.tool(
  "llm_compute_model_latency_stats",
  "Compute and persist latency percentiles for a model (writes to llm.model_latency_stats)",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    model: z.string().describe("Model name"),
    period_hours: z.number().optional().default(24).describe("Time window in hours"),
  },
  async ({ workspace_id, model, period_hours }) => {
    const stats = await computeModelLatencyStats(sql, workspace_id, model, period_hours);
    if (!stats) return text({ error: "No latency data found" });
    return text(stats);
  },
);

server.tool(
  "llm_record_quality_score",
  "Record a quality score for an LLM response (user or automated feedback)",
  {
    request_id: z.string().describe("Request UUID from the original LLM call"),
    workspace_id: z.string().describe("Workspace UUID"),
    model: z.string().describe("Model name"),
    score: z.number().min(0).max(100).describe("Quality score 0-100"),
    feedback: z.string().optional().describe("Optional text feedback"),
    scoring_type: z.enum(["user", "automated", "task_completion"]).optional().default("user"),
  },
  async (opts) => {
    const result = await recordQualityScore(sql, {
      requestId: opts.request_id,
      workspaceId: opts.workspace_id,
      model: opts.model,
      score: opts.score,
      feedback: opts.feedback,
      scoringType: opts.scoring_type,
    });
    return text(result);
  },
);

server.tool(
  "llm_get_model_quality_stats",
  "Get average quality scores per model for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    period_days: z.number().optional().default(30).describe("Time window in days"),
  },
  async ({ workspace_id, period_days }) => {
    const stats = await getModelQualityStats(sql, workspace_id, period_days);
    return text({ stats, count: stats.length });
  },
);

