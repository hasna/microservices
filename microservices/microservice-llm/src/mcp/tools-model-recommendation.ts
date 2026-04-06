// ─── Model Recommendation ────────────────────────────────────────────────────

server.tool(
  "llm_get_model_recommendation",
  "Get a model recommendation based on task type, quality requirements, and budget. Considers cost, latency, and capability match.",
  {
    workspace_id: z.string().describe("Workspace ID"),
    task: z.enum(["chat", "completion", "vision", "embedding", "function_calling"]).describe("Task type"),
    min_quality: z.number().min(0).max(100).optional().default(70).describe("Minimum quality score (0-100)"),
    max_latency_ms: z.number().optional().describe("Maximum acceptable latency in ms"),
    max_cost_per_1k: z.number().optional().describe("Maximum cost per 1K tokens"),
  },
  async ({ workspace_id, task, min_quality, max_latency_ms, max_cost_per_1k }) => {
    const { listModels } = await import("../lib/model-registry.js");
    const { computeModelLatencyStats } = await import("../lib/model-latency.js");
    const { COST_PER_1K_TOKENS } = await import("../lib/costs.js");
    const models = await listModels(sql, workspace_id);
    const candidates = models
      .filter(m => m.capabilities?.includes(task))
      .map(m => {
        const cost = COST_PER_1K_TOKENS[m.model_id] ?? COST_PER_1K_TOKENS.default;
        const avgCost = (cost.input + cost.output) / 2;
        const latencyStats = computeModelLatencyStats({ modelId: m.model_id, workspaceId: workspace_id });
        return { model: m, avgCost, latencyP50: latencyStats?.p50_ms ?? 9999, qualityScore: m.quality_score ?? 70 };
      })
      .filter(m => m.qualityScore >= min_quality)
      .filter(m => !max_latency_ms || m.latencyP50 <= max_latency_ms)
      .filter(m => !max_cost_per_1k || m.avgCost <= max_cost_per_1k)
      .sort((a, b) => {
        const costDiff = a.avgCost - b.avgCost;
        const latDiff = a.latencyP50 - b.latencyP50;
        return costDiff * 0.4 + latDiff * 0.0001; // cost-weighted
      });
    const recommended = candidates[0];
    return text({
      recommended: recommended?.model ?? null,
      alternatives: candidates.slice(1, 4).map(m => ({ model: m.model.model_id, cost_per_1k: m.avgCost, latency_p50_ms: m.latencyP50 })),
      filters: { task, min_quality, max_latency_ms, max_cost_per_1k },
    });
  },
);

server.tool(
  "llm_cost_preview",
  "Preview the estimated cost for an LLM request BEFORE making the call — estimates token count and calculates USD cost based on current model pricing",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    messages: z.array(z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })).optional().describe("Conversation messages (mutually exclusive with text)"),
    text: z.string().optional().describe("Single text prompt (mutually exclusive with messages)"),
    model: z.string().optional().default("gpt-4o").describe("Model to estimate cost for"),
  },
  async ({ workspace_id, messages, text, model }) => {
    const content = text ?? (messages ? messages.map(m => `${m.role}: ${m.content}`).join("\n") : "");
    const estimated = countMessageTokens(content);
    const cost = calculateCost(model ?? "gpt-4o", estimated, Math.round(estimated * 0.4));
    return text({
      model: model ?? "gpt-4o",
      estimated_prompt_tokens: estimated,
      estimated_completion_tokens: Math.round(estimated * 0.4),
      estimated_total_tokens: Math.round(estimated * 1.4),
      estimated_cost_usd: cost,
      cost_per_1k_input: (cost / Math.max(estimated, 1)) * 1000,
      cost_per_1k_output: (cost / Math.max(Math.round(estimated * 0.4), 1)) * 1000,
      workspace_id,
    });
  },
);

server.tool(
  "llm_batch_stream",
  "Stream multiple prompts in parallel as individual SSE streams — yields a collection of Server-Sent Event streams, one per prompt, with full metadata per item",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    items: z.array(z.object({
      id: z.string().describe("Unique caller-provided ID to match results"),
      messages: z.array(z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string(),
      })).describe("Conversation messages"),
      model: z.string().optional(),
      temperature: z.number().optional(),
    })).min(1).max(50).describe("Array of prompts to stream (max 50)"),
    model: z.string().optional().describe("Default model if not specified per item"),
    max_concurrency: z.number().int().positive().optional().default(5).describe("Max parallel streams"),
  },
  async ({ workspace_id, items, model, max_concurrency }) => {
    const results: Array<{
      id: string;
      model: string;
      status: string;
      error?: string;
    }> = [];
    let active = 0;
    const queue = [...items];
    const start = Date.now();

    async function processNext(): Promise<void> {
      while (queue.length > 0) {
        const item = queue.shift()!;
        active++;
        try {
          const modelToUse = item.model ?? model ?? "gpt-4o";
          results.push({ id: item.id, model: modelToUse, status: "streaming" });
          const response = await chat(sql, {
            workspaceId: workspace_id,
            messages: item.messages as any,
            model: modelToUse,
          });
          const idx = results.findIndex(r => r.id === item.id);
          if (idx !== -1) results[idx] = { id: item.id, model: modelToUse, status: "done" };
        } catch (err: any) {
          const idx = results.findIndex(r => r.id === item.id);
          if (idx !== -1) results[idx] = { id: item.id, model: item.model ?? model ?? "gpt-4o", status: "error", error: err?.message ?? "Unknown error" };
        }
        active--;
      }
    }

    const workers = Array.from({ length: Math.min(max_concurrency, items.length) }, () => processNext());
    await Promise.all(workers);

    return text({
      workspace_id,
      total_items: items.length,
      results,
      duration_ms: Date.now() - start,
      summary: {
        done: results.filter(r => r.status === "done").length,
        errors: results.filter(r => r.status === "error").length,
        streaming: results.filter(r => r.status === "streaming").length,
      },
    });
  },
);

server.tool(
  "llm_provider_latency_ranking",
  "Get providers ranked by latency for a workspace — returns sorted list of providers by p50, p95, p99 latency so you can route to the fastest",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    period_hours: z.number().int().positive().optional().default(24).describe("Hours to look back"),
    sort_by: z.enum(["p50", "p95", "p99", "avg"]).optional().default("p95").describe("Latency percentile to sort by"),
  },
  async ({ workspace_id, period_hours, sort_by }) => {
    const since = new Date(Date.now() - period_hours * 3_600_000);
    const rows = await sql.unsafe(`
      SELECT
        provider,
        COUNT(*)::int AS total_requests,
        ROUND(AVG(latency_ms)::numeric, 2)::numeric AS avg_ms,
        ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms))::int AS p50_ms,
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms))::int AS p95_ms,
        ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms))::int AS p99_ms,
        ROUND(
          COUNT(*) FILTER (WHERE error IS NOT NULL)::numeric / NULLIF(COUNT(*), 0) * 100, 2
        )::numeric AS error_rate
      FROM llm.requests
      WHERE workspace_id = $1 AND created_at >= $2
      GROUP BY provider
      ORDER BY ${sort_by === "p50" ? "p50_ms" : sort_by === "p99" ? "p99_ms" : sort_by === "avg" ? "avg_ms" : "p95_ms"} ASC
    `, [workspace_id, since]) as any[];

    return text({
      workspace_id,
      period_hours,
      sort_by,
      rankings: rows.map((r, i) => ({
        rank: i + 1,
        provider: r.provider,
        total_requests: r.total_requests,
        avg_ms: Number(r.avg_ms),
        p50_ms: Number(r.p50_ms),
        p95_ms: Number(r.p95_ms),
        p99_ms: Number(r.p99_ms),
        error_rate: Number(r.error_rate),
      })),
      fastest: rows[0] ? { provider: rows[0].provider, p95_ms: Number(rows[0].p95_ms) } : null,
    });
  },
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
