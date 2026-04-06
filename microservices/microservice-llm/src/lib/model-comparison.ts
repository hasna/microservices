/**
 * Model comparison — run side-by-side benchmarks across multiple models.
 */

import type { Sql } from "postgres";
import { getAvailableModels } from "./providers.js";
import { calculateCost } from "./costs.js";
import { chat } from "./gateway.js";

export interface ModelComparisonResult {
  model: string;
  provider: string;
  output: string;
  latency_ms: number;
  cost_usd: number;
  tokens_used: number;
  error?: string;
}

export interface ModelComparison {
  id: string;
  workspace_id: string | null;
  benchmark_prompt: string;
  models_compared: string[];
  results: ModelComparisonResult[];
  winner: string | null;
  recorded_at: Date;
}

/**
 * Compare multiple models on the same benchmark prompt.
 */
export async function compareModels(
  sql: Sql,
  opts: {
    workspaceId?: string;
    benchmarkPrompt: string;
    models: string[];
    systemPrompt?: string;
  },
): Promise<ModelComparisonResult[]> {
  const results: ModelComparisonResult[] = [];

  for (const model of opts.models) {
    const start = Date.now();
    try {
      const messages = opts.systemPrompt
        ? [{ role: "system" as const, content: opts.systemPrompt }, { role: "user" as const, content: opts.benchmarkPrompt }]
        : [{ role: "user" as const, content: opts.benchmarkPrompt }];

      const response = await chat(sql, {
        workspaceId: opts.workspaceId ?? "00000000-0000-0000-0000-000000000000",
        messages,
        model,
      });

      const latency_ms = Date.now() - start;
      const tokens_used = (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0);
      const cost_usd = calculateCost(model, response.usage?.prompt_tokens ?? 0, response.usage?.completion_tokens ?? 0);

      results.push({
        model,
        provider: response.provider ?? "unknown",
        output: response.content ?? "",
        latency_ms,
        cost_usd,
        tokens_used,
      });
    } catch (err: any) {
      results.push({
        model,
        provider: "unknown",
        output: "",
        latency_ms: Date.now() - start,
        cost_usd: 0,
        tokens_used: 0,
        error: err?.message ?? "Unknown error",
      });
    }
  }

  // Determine winner by fewest errors + lowest latency + lowest cost
  const successful = results.filter(r => !r.error);
  if (successful.length > 0) {
    const winner = successful.sort((a, b) => {
      if (a.cost_usd !== b.cost_usd) return a.cost_usd - b.cost_usd;
      return a.latency_ms - b.latency_ms;
    })[0].model;

    const [inserted] = await sql<{ id: string }[]>`
      INSERT INTO llm.model_comparisons (workspace_id, benchmark_prompt, models_compared, results, winner)
      VALUES (
        ${opts.workspaceId ?? null},
        ${opts.benchmarkPrompt},
        ${opts.models},
        ${JSON.stringify(results)},
        ${winner}
      )
      RETURNING id
    `;

    // Attach id to results for reference
    for (const r of results) {
      (r as any).comparison_id = inserted.id;
    }
  }

  return results;
}

/**
 * Get historical comparison results.
 */
export async function getModelComparisons(
  sql: Sql,
  opts: { workspaceId?: string; limit?: number } = {},
): Promise<ModelComparison[]> {
  const rows = await sql<any[]>`
    SELECT id, workspace_id, benchmark_prompt, models_compared, results, winner, recorded_at
    FROM llm.model_comparisons
    WHERE ${opts.workspaceId ? sql`workspace_id = ${opts.workspaceId}` : sql`TRUE`}
    ORDER BY recorded_at DESC
    LIMIT ${opts.limit ?? 20}
  `;
  return rows.map(r => ({
    id: r.id,
    workspace_id: r.workspace_id,
    benchmark_prompt: r.benchmark_prompt,
    models_compared: r.models_compared,
    results: r.results,
    winner: r.winner,
    recorded_at: r.recorded_at,
  }));
}

/**
 * Get the best model recommendation based on historical data.
 */
export async function getBestModelRecommendation(
  sql: Sql,
  opts: { workspaceId?: string },
): Promise<{ model: string; reason: string } | null> {
  const [latest] = await sql<any[]>`
    SELECT results, winner, recorded_at
    FROM llm.model_comparisons
    WHERE ${opts.workspaceId ? sql`workspace_id = ${opts.workspaceId}` : sql`TRUE`}
    ORDER BY recorded_at DESC
    LIMIT 1
  `;

  if (!latest) return null;

  return {
    model: latest.winner,
    reason: `Based on comparison of ${latest.results.length} models on ${new Date(latest.recorded_at).toISOString()}`,
  };
}
