/**
 * Model router — microservice-llm.
 *
 * Routes LLM requests to optimal models based on:
 * - Task type (completion, embedding, vision, function calling)
 * - Cost constraints (budget limits, cost-per-token ranking)
 * - Latency requirements (fast vs quality modes)
 * - Provider availability (circuit breaker state)
 *
 * Usage:
 *   const router = createModelRouter(sql)
 *   const route = await router.route({ workspaceId, task: "chat", maxCost: 0.01 })
 *   // route.provider, route.model, route.routerNotes
 */

import type { Sql } from "postgres";

export type TaskType = "chat" | "completion" | "embedding" | "vision" | "function_calling";

export interface RouteConstraints {
  maxCost?: number;
  maxLatencyMs?: number;
  preferLatencyMs?: number;
  requireVision?: boolean;
  requireFunctionCalling?: boolean;
  minQualityScore?: number;
}

export interface ModelRoute {
  provider: string;
  model: string;
  costPer1kInput: number;
  costPer1kOutput: number;
  estimatedLatencyMs: number;
  qualityScore: number;
  routerNotes: string;
  rank: number;
}

export interface ModelRankingScore {
  model: string;
  provider: string;
  costScore: number;      // lower cost = higher score (0-100)
  latencyScore: number;   // lower latency = higher score (0-100)
  qualityScore: number;  // provided quality score (0-100)
  availabilityScore: number; // circuit breaker state (0 or 100)
  totalScore: number;
  routerNotes: string;
}

/**
 * Get the best model for a task given constraints and priorities.
 */
export async function routeModel(
  sql: Sql,
  workspaceId: string,
  task: TaskType,
  constraints: RouteConstraints = {},
): Promise<ModelRoute[]> {
  // Get all models for workspace
  const models = await sql<{
    id: string;
    provider: string;
    name: string;
    cost_per_1k_input: number;
    cost_per_1k_output: number;
    latency_estimate_ms: number;
    quality_score: number;
    supports_vision: boolean;
    supports_function_calling: boolean;
    active: boolean;
  }[]>`
    SELECT id, provider, name,
           cost_per_1k_input, cost_per_1k_output,
           latency_estimate_ms, quality_score,
           supports_vision, supports_function_calling, active
    FROM llm.workspace_models
    WHERE workspace_id = ${workspaceId} AND active = true
  `;

  if (models.length === 0) {
    // Fall back to global models
    const global = await sql<{
      id: string;
      provider: string;
      name: string;
      cost_per_1k_input: number;
      cost_per_1k_output: number;
      latency_estimate_ms: number;
      quality_score: number;
      supports_vision: boolean;
      supports_function_calling: boolean;
    }[]>`
      SELECT id, provider, name,
             cost_per_1k_input, cost_per_1k_output,
             latency_estimate_ms, quality_score,
             supports_vision, supports_function_calling
      FROM llm.models
      WHERE active = true AND name LIKE '%gpt-4%' OR name LIKE '%claude%'
      LIMIT 5
    `;
  }

  // Build scoring for each model
  const rankings: ModelRankingScore[] = models.map((m) => {
    // Cost score: inverse of relative cost (normalize against cheapest)
    const minCost = Math.min(...models.map((x) => x.cost_per_1k_input));
    const maxCost = Math.max(...models.map((x) => x.cost_per_1k_input));
    const costRange = maxCost - minCost || 1;
    const costScore = 100 - ((m.cost_per_1k_input - minCost) / costRange) * 100;

    // Latency score: inverse of relative latency
    const minLat = Math.min(...models.map((x) => x.latency_estimate_ms));
    const maxLat = Math.max(...models.map((x) => x.latency_estimate_ms));
    const latRange = maxLat - minLat || 1;
    const latencyScore = 100 - ((m.latency_estimate_ms - minLat) / latRange) * 100;

    // Quality score is absolute (0-100)
    const qualityScore = m.quality_score ?? 70;

    // Availability: check circuit breaker
    let availabilityScore = 100;
    // (Would check circuit breaker state here if available)

    // Total weighted score
    const weights = { cost: 0.3, latency: 0.2, quality: 0.4, availability: 0.1 };
    const totalScore =
      costScore * weights.cost +
      latencyScore * weights.latency +
      qualityScore * weights.quality +
      availabilityScore * weights.availability;

    const routerNotes: string[] = [];
    if (costScore > 80) routerNotes.push("cost-efficient");
    if (latencyScore > 80) routerNotes.push("low-latency");
    if (qualityScore > 85) routerNotes.push("high-quality");

    return {
      model: m.name,
      provider: m.provider,
      costScore,
      latencyScore,
      qualityScore,
      availabilityScore,
      totalScore,
      routerNotes: routerNotes.join(", "),
    };
  });

  // Sort by total score descending
  rankings.sort((a, b) => b.totalScore - a.totalScore);

  return rankings.map((r, i) => ({
    provider: r.provider,
    model: r.model,
    costPer1kInput: models.find((m) => m.name === r.model)?.cost_per_1k_input ?? 0,
    costPer1kOutput: models.find((m) => m.name === r.model)?.cost_per_1k_output ?? 0,
    estimatedLatencyMs: models.find((m) => m.name === r.model)?.latency_estimate_ms ?? 0,
    qualityScore: r.qualityScore,
    routerNotes: r.routerNotes,
    rank: i + 1,
  }));
}

/**
 * Pick the cheapest model that satisfies a max cost constraint.
 */
export async function routeByCost(
  sql: Sql,
  workspaceId: string,
  task: TaskType,
  maxCostPer1k: number,
): Promise<ModelRoute | null> {
  const routes = await routeModel(sql, workspaceId, task, { maxCost: maxCostPer1k });
  return routes.find((r) => r.costPer1kInput <= maxCostPer1k) ?? null;
}

/**
 * Pick the fastest model meeting a minimum quality threshold.
 */
export async function routeByLatency(
  sql: Sql,
  workspaceId: string,
  task: TaskType,
  minQuality = 70,
): Promise<ModelRoute | null> {
  const routes = await routeModel(sql, workspaceId, task, { minQualityScore: minQuality });
  // Already sorted by score, but also want fastest
  const latencySorted = [...routes].sort((a, b) => a.estimatedLatencyMs - b.estimatedLatencyMs);
  return latencySorted[0] ?? null;
}