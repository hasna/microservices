/**
 * Pre-call cost estimation — predict cost before making an LLM call.
 */

import type { Sql } from "postgres";
import { calculateCost } from "./costs.js";
import { getModel } from "./model-registry.js";

export interface CostEstimate {
  model: string;
  prompt_tokens: number;
  max_tokens: number;
  estimated_cost_usd: number;
  prompt_cost_usd: number;
  completion_cost_usd: number;
}

/**
 * Estimate the cost of a call before making it.
 */
export async function estimateCallCost(
  sql: Sql,
  opts: {
    workspaceId: string;
    model: string;
    promptTokens: number;
    maxTokens: number;
  },
): Promise<CostEstimate> {
  const modelInfo = await getModel(sql, opts.model);

  const prompt_cost = calculateCost(opts.model, opts.promptTokens, 0);
  const completion_cost = calculateCost(opts.model, 0, opts.maxTokens);
  const estimated_cost = prompt_cost + completion_cost;

  // Log the estimate for accuracy tracking
  const [record] = await sql<{ id: string }[]>`
    INSERT INTO llm.cost_estimates (workspace_id, model, prompt_tokens, max_tokens, estimated_cost)
    VALUES (${opts.workspaceId}, ${opts.model}, ${opts.promptTokens}, ${opts.maxTokens}, ${estimated_cost})
    RETURNING id
  `;

  return {
    model: opts.model,
    prompt_tokens: opts.promptTokens,
    max_tokens: opts.maxTokens,
    estimated_cost_usd: estimated_cost,
    prompt_cost_usd: prompt_cost,
    completion_cost_usd: completion_cost,
  };
}

/**
 * Update an estimate with actual cost after a call completes.
 */
export async function finalizeCostEstimate(
  sql: Sql,
  opts: {
    estimateId: string;
    actualCost: number;
  },
): Promise<void> {
  const [record] = await sql<{ estimated_cost: number }[]>`
    SELECT estimated_cost FROM llm.cost_estimates WHERE id = ${opts.estimateId}
  `;
  if (!record) return;

  const accuracy = record.estimated_cost > 0
    ? Math.min(100, Math.max(0, (1 - Math.abs(record.estimated_cost - opts.actualCost) / record.estimated_cost) * 100))
    : 0;

  await sql`
    UPDATE llm.cost_estimates
    SET actual_cost = ${opts.actualCost}, accuracy_pct = ${accuracy}
    WHERE id = ${opts.estimateId}
  `;
}

/**
 * Get estimate accuracy statistics.
 */
export async function getCostEstimateAccuracy(
  sql: Sql,
  opts: { workspaceId?: string; model?: string } = {},
): Promise<{ avg_accuracy_pct: number; total_estimates: number; by_model: Record<string, number> }> {
  const rows = await sql<any[]>`
    SELECT model, accuracy_pct
    FROM llm.cost_estimates
    WHERE actual_cost IS NOT NULL
      AND ${opts.workspaceId ? sql`workspace_id = ${opts.workspaceId}` : sql`TRUE`}
      AND ${opts.model ? sql`model = ${opts.model}` : sql`TRUE`}
  `;

  const by_model: Record<string, number[]> = {};
  for (const row of rows) {
    if (!by_model[row.model]) by_model[row.model] = [];
    by_model[row.model].push(row.accuracy_pct);
  }

  const allAccuracies = rows.map(r => r.accuracy_pct).filter(Boolean);
  const avg = allAccuracies.length > 0
    ? allAccuracies.reduce((a, b) => a + b, 0) / allAccuracies.length
    : 0;

  const byModelAvg: Record<string, number> = {};
  for (const [model, accs] of Object.entries(by_model)) {
    byModelAvg[model] = accs.reduce((a, b) => a + b, 0) / accs.length;
  }

  return {
    avg_accuracy_pct: Math.round(avg * 100) / 100,
    total_estimates: rows.length,
    by_model: byModelAvg,
  };
}

/**
 * Batch estimate for multiple models at once.
 */
export async function estimateBatchCosts(
  sql: Sql,
  opts: {
    workspaceId: string;
    models: string[];
    promptTokens: number;
    maxTokens: number;
  },
): Promise<CostEstimate[]> {
  return Promise.all(
    opts.models.map(model =>
      estimateCallCost(sql, {
        workspaceId: opts.workspaceId,
        model,
        promptTokens: opts.promptTokens,
        maxTokens: opts.maxTokens,
      }),
    ),
  );
}
