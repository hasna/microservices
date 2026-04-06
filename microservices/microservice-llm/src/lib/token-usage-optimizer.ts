/**
 * Token usage optimizer — analyze past usage patterns and suggest
 * ways to reduce token consumption and costs.
 */

import type { Sql } from "postgres";

export interface TokenUsageStats {
  workspace_id: string;
  period_start: Date;
  period_end: Date;
  total_tokens_in: number;
  total_tokens_out: number;
  total_cost_usd: number;
  total_requests: number;
  avg_tokens_per_request: number;
  avg_cost_per_request: number;
  avg_tokens_per_completion: number;
  by_model: ModelUsageBreakdown[];
  by_day: DailyUsage[];
}

export interface ModelUsageBreakdown {
  model: string;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  avg_tokens_per_request: number;
  pct_of_total_cost: number;
}

export interface DailyUsage {
  date: string;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  avg_tokens_per_request: number;
}

export interface TokenOptimizationSuggestion {
  type: "prompt_truncation" | "model_downgrade" | "caching" | "batch_processing" | "context_compression";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  potential_savings_pct: number;
  potential_savings_usd: number;
  action: string;
}

export interface TokenOptimizationReport {
  workspace_id: string;
  stats: TokenUsageStats;
  suggestions: TokenOptimizationSuggestion[];
  total_potential_savings_pct: number;
  total_potential_savings_usd: number;
}

/**
 * Get token usage statistics for a workspace.
 */
export async function getTokenUsageStats(
  sql: Sql,
  workspaceId: string,
  opts: { periodStart?: Date; periodEnd?: Date } = {},
): Promise<TokenUsageStats | null> {
  const { periodStart, periodEnd } = opts;
  const start = periodStart ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
  const end = periodEnd ?? new Date();

  // Get overall stats
  const [overall] = await sql<{
    total_tokens_in: string;
    total_tokens_out: string;
    total_cost_usd: string;
    total_requests: string;
  }[]>`
    SELECT
      COALESCE(SUM(prompt_tokens), 0)::text AS total_tokens_in,
      COALESCE(SUM(completion_tokens), 0)::text AS total_tokens_out,
      COALESCE(SUM(cost_usd), 0)::text AS total_cost_usd,
      COUNT(*)::text AS total_requests
    FROM llm.completion_log
    WHERE workspace_id = ${workspaceId}
      AND created_at >= ${start}
      AND created_at <= ${end}
  `;

  if (!overall || parseInt(overall.total_requests, 10) === 0) {
    return null;
  }

  const totalTokensIn = parseInt(overall.total_tokens_in, 10);
  const totalTokensOut = parseInt(overall.total_tokens_out, 10);
  const totalCostUsd = parseFloat(overall.total_cost_usd);
  const totalRequests = parseInt(overall.total_requests, 10);

  // Get by-model breakdown
  const byModel = await sql<ModelUsageBreakdown[]>`
    SELECT
      model,
      COUNT(*)::int AS requests,
      COALESCE(SUM(prompt_tokens), 0)::int AS tokens_in,
      COALESCE(SUM(completion_tokens), 0)::int AS tokens_out,
      COALESCE(SUM(cost_usd), 0)::numeric AS cost_usd,
      ROUND(
        COALESCE(SUM(prompt_tokens + completion_tokens), 0)::numeric
        / NULLIF(COUNT(*), 0), 2
      ) AS avg_tokens_per_request,
      ROUND(
        COALESCE(SUM(cost_usd), 0)::numeric
        / NULLIF((SELECT SUM(cost_usd) FROM llm.completion_log WHERE workspace_id = ${workspaceId} AND created_at >= ${start} AND created_at <= ${end}), 0)
        * 100, 2
      ) AS pct_of_total_cost
    FROM llm.completion_log
    WHERE workspace_id = ${workspaceId}
      AND created_at >= ${start}
      AND created_at <= ${end}
    GROUP BY model
    ORDER BY cost_usd DESC
  `;

  // Get daily usage
  const byDay = await sql<{ date: string; requests: string; tokens_in: string; tokens_out: string; cost_usd: string }[]>`
    SELECT
      DATE(created_at)::text AS date,
      COUNT(*)::text AS requests,
      COALESCE(SUM(prompt_tokens), 0)::text AS tokens_in,
      COALESCE(SUM(completion_tokens), 0)::text AS tokens_out,
      COALESCE(SUM(cost_usd), 0)::text AS cost_usd
    FROM llm.completion_log
    WHERE workspace_id = ${workspaceId}
      AND created_at >= ${start}
      AND created_at <= ${end}
    GROUP BY DATE(created_at)
    ORDER BY date DESC
  `;

  return {
    workspace_id: workspaceId,
    period_start: start,
    period_end: end,
    total_tokens_in: totalTokensIn,
    total_tokens_out: totalTokensOut,
    total_cost_usd: totalCostUsd,
    total_requests: totalRequests,
    avg_tokens_per_request: totalRequests > 0 ? Math.round((totalTokensIn + totalTokensOut) / totalRequests) : 0,
    avg_cost_per_request: totalRequests > 0 ? totalCostUsd / totalRequests : 0,
    avg_tokens_per_completion: totalRequests > 0 ? Math.round(totalTokensOut / totalRequests) : 0,
    by_model: byModel.map(m => ({
      model: m.model,
      requests: m.requests,
      tokens_in: m.tokens_in,
      tokens_out: m.tokens_out,
      cost_usd: Number(m.cost_usd),
      avg_tokens_per_request: Number(m.avg_tokens_per_request),
      pct_of_total_cost: Number(m.pct_of_total_cost) || 0,
    })),
    by_day: byDay.map(d => ({
      date: d.date,
      requests: parseInt(d.requests, 10),
      tokens_in: parseInt(d.tokens_in, 10),
      tokens_out: parseInt(d.tokens_out, 10),
      cost_usd: parseFloat(d.cost_usd),
      avg_tokens_per_request: parseInt(d.requests, 10) > 0
        ? Math.round((parseInt(d.tokens_in, 10) + parseInt(d.tokens_out, 10)) / parseInt(d.requests, 10))
        : 0,
    })),
  };
}

/**
 * Generate optimization suggestions based on usage patterns.
 */
export async function getTokenOptimizationSuggestions(
  sql: Sql,
  workspaceId: string,
): Promise<TokenOptimizationSuggestion[]> {
  const stats = await getTokenUsageStats(sql, workspaceId);
  if (!stats) return [];

  const suggestions: TokenOptimizationSuggestion[] = [];
  const potentialSavingsByType: Record<string, { pct: number; usd: number }> = {};

  // Analyze high token-per-request patterns
  if (stats.avg_tokens_per_request > 4000) {
    const highTokenModels = stats.by_model.filter(m => m.avg_tokens_per_request > 4000);
    if (highTokenModels.length > 0) {
      const avgTokens = highTokenModels.reduce((sum, m) => sum + m.avg_tokens_per_request, 0) / highTokenModels.length;
      const potentialReduction = Math.min(30, ((avgTokens - 2000) / avgTokens) * 100);

      suggestions.push({
        type: "prompt_truncation",
        priority: potentialReduction > 20 ? "high" : "medium",
        title: "High token-per-request average",
        description: `Average of ${avgTokens.toLocaleString()} tokens/request detected. Consider truncating long system prompts or using reference documents instead of including all context.`,
        potential_savings_pct: Math.round(potentialReduction),
        potential_savings_usd: Math.round(stats.total_cost_usd * (potentialReduction / 100) * 100) / 100,
        action: "Review system prompts and context inclusion strategy. Use retrieval to fetch relevant context rather than including all documents.",
      });
      potentialSavingsByType["prompt_truncation"] = {
        pct: Math.round(potentialReduction),
        usd: Math.round(stats.total_cost_usd * (potentialReduction / 100) * 100) / 100,
      };
    }
  }

  // Analyze expensive model usage
  const expensiveModels = stats.by_model.filter(m => {
    const priceMultiplier = m.model.toLowerCase().includes("gpt-4") || m.model.toLowerCase().includes("claude-3") ? 10 : 1;
    return m.avg_cost_per_request > 0.05 * priceMultiplier;
  });

  if (expensiveModels.length > 0 && stats.total_cost_usd > 10) {
    // Find cheaper alternatives
    const expensiveModelsByCost = expensiveModels.sort((a, b) => b.cost_usd - a.cost_usd);
    const topExpensive = expensiveModelsByCost[0];

    // Estimate 40-60% savings by using a cheaper model for non-complex tasks
    const potentialSavings = topExpensive.cost_usd * 0.4;

    suggestions.push({
      type: "model_downgrade",
      priority: potentialSavings > 5 ? "high" : "medium",
      title: "Consider model downgrades for simpler tasks",
      description: `Model ${topExpensive.model} accounts for $${topExpensive.cost_usd.toFixed(2)} (${topExpensive.pct_of_total_cost}% of spend). Many tasks could use a cheaper model.`,
      potential_savings_pct: 40,
      potential_savings_usd: Math.round(potentialSavings * 100) / 100,
      action: `Use ${topExpensive.model} only for complex reasoning tasks. Route simple Q&A, classification, and extraction to gpt-3.5-turbo or claude-haiku.`,
    });
    potentialSavingsByType["model_downgrade"] = { pct: 40, usd: Math.round(potentialSavings * 100) / 100 };
  }

  // Analyze high completion token ratio
  const highCompletionRatio = stats.by_model.filter(m => {
    const ratio = m.tokens_out / (m.tokens_in + m.tokens_out);
    return ratio > 0.5 && m.avg_tokens_per_request > 1000;
  });

  if (highCompletionRatio.length > 0) {
    suggestions.push({
      type: "context_compression",
      priority: "medium",
      title: "High completion-to-prompt ratio detected",
      description: "Models are generating relatively long outputs compared to input. This might indicate opportunities for more specific prompting.",
      potential_savings_pct: 10,
      potential_savings_usd: Math.round(stats.total_cost_usd * 0.05 * 100) / 100,
      action: "Use more specific prompts with output format requirements to reduce unnecessary generation.",
    });
    potentialSavingsByType["context_compression"] = { pct: 10, usd: Math.round(stats.total_cost_usd * 0.05 * 100) / 100 };
  }

  // Check for repeated similar requests (caching opportunity)
  const [repeatedCheck] = await sql<{ repeated_count: string; potential_savings: string }[]>`
    SELECT
      COUNT(*)::text AS repeated_count,
      (COUNT(*) * 0.001)::text AS potential_savings
    FROM (
      SELECT prompt_tokens, completion_tokens, model, DATE(created_at) as day
      FROM llm.completion_log
      WHERE workspace_id = ${workspaceId}
        AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY prompt_tokens, completion_tokens, model, DATE(created_at)
      HAVING COUNT(*) > 3
    ) subq
  `;

  if (repeatedCheck && parseInt(repeatedCheck.repeated_count, 10) > 0) {
    suggestions.push({
      type: "caching",
      priority: parseInt(repeatedCheck.repeated_count, 10) > 10 ? "high" : "low",
      title: "Repeated requests detected — caching opportunity",
      description: `Found ${repeatedCheck.repeated_count} groups of identical/very similar requests in the last 7 days. Implementing semantic caching could save significant costs.`,
      potential_savings_pct: 30,
      potential_savings_usd: parseFloat(repeatedCheck.potential_savings) * 30,
      action: "Implement semantic caching using prompt embeddings. Cache responses for semantically similar prompts.",
    });
    potentialSavingsByType["caching"] = { pct: 30, usd: parseFloat(repeatedCheck.potential_savings) * 30 };
  }

  // Check for batch processing opportunity
  if (stats.total_requests > 100 && stats.avg_cost_per_request > 0.01) {
    suggestions.push({
      type: "batch_processing",
      priority: "medium",
      title: "High request volume — consider batch processing",
      description: `${stats.total_requests} requests in the period. Many LLM providers offer lower rates for batch processing.`,
      potential_savings_pct: 50,
      potential_savings_usd: Math.round(stats.total_cost_usd * 0.2 * 100) / 100,
      action: "Group similar requests and use batch completion APIs where available. Consider using GPT-4o mini for batch tasks.",
    });
    potentialSavingsByType["batch_processing"] = { pct: 50, usd: Math.round(stats.total_cost_usd * 0.2 * 100) / 100 };
  }

  return suggestions.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

/**
 * Get a complete optimization report.
 */
export async function getTokenOptimizationReport(
  sql: Sql,
  workspaceId: string,
): Promise<TokenOptimizationReport | null> {
  const stats = await getTokenUsageStats(sql, workspaceId);
  if (!stats) return null;

  const suggestions = await getTokenOptimizationSuggestions(sql, workspaceId);

  const totalPotentialSavingsPct = Math.min(
    100,
    suggestions.reduce((sum, s) => sum + s.potential_savings_pct, 0),
  );

  const totalPotentialSavingsUsd = suggestions.reduce(
    (sum, s) => sum + s.potential_savings_usd,
    0,
  );

  return {
    workspace_id: workspaceId,
    stats,
    suggestions,
    total_potential_savings_pct: Math.round(totalPotentialSavingsPct),
    total_potential_savings_usd: Math.round(totalPotentialSavingsUsd * 100) / 100,
  };
}
