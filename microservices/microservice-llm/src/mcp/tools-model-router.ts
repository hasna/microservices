// ─── Model Router ─────────────────────────────────────────────────────────────

server.tool(
  "llm_route_model",
  "Get the best model routes for a task given cost/latency constraints",
  {
    workspace_id: z.string(),
    task: z.enum(["chat", "completion", "embedding", "vision", "function_calling"]),
    max_cost: z.number().optional(),
    max_latency_ms: z.number().optional(),
    prefer_latency_ms: z.number().optional(),
    require_vision: z.boolean().optional(),
    require_function_calling: z.boolean().optional(),
    min_quality_score: z.number().optional(),
  },
  async (opts) => {
    const { routeModel } = await import("../lib/model-router.js");
    return text(await routeModel(sql, opts.workspace_id, opts.task as any, {
      maxCost: opts.max_cost,
      maxLatencyMs: opts.max_latency_ms,
      preferLatencyMs: opts.prefer_latency_ms,
      requireVision: opts.require_vision,
      requireFunctionCalling: opts.require_function_calling,
      minQualityScore: opts.min_quality_score,
    }));
  },
);

server.tool(
  "llm_route_by_cost",
  "Pick the cheapest model that satisfies a max cost constraint",
  {
    workspace_id: z.string(),
    task: z.enum(["chat", "completion", "embedding", "vision", "function_calling"]),
    max_cost_per_1k: z.number(),
  },
  async ({ workspace_id, task, max_cost_per_1k }) => {
    const { routeByCost } = await import("../lib/model-router.js");
    return text(await routeByCost(sql, workspace_id, task as any, max_cost_per_1k));
  },
);

server.tool(
  "llm_route_by_latency",
  "Pick the fastest model meeting a minimum quality threshold",
  {
    workspace_id: z.string(),
    task: z.enum(["chat", "completion", "embedding", "vision", "function_calling"]),
    min_quality: z.number().optional().default(70),
  },
  async ({ workspace_id, task, min_quality }) => {
    const { routeByLatency } = await import("../lib/model-router.js");
    return text(await routeByLatency(sql, workspace_id, task as any, min_quality));
  },
);

