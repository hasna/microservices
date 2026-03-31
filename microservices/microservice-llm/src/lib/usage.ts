/**
 * Usage statistics for LLM requests.
 */

import type { Sql } from "postgres";

export interface ModelUsage {
  model: string;
  provider: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

export interface WorkspaceUsage {
  total_requests: number;
  total_tokens: number;
  total_cost_usd: number;
  by_model: ModelUsage[];
}

export async function getWorkspaceUsage(
  sql: Sql,
  workspaceId: string,
  since?: Date
): Promise<WorkspaceUsage> {
  const sinceDate = since ?? new Date(0);

  const [totals] = await sql<[{ total_requests: string; total_tokens: string; total_cost_usd: string }]>`
    SELECT
      COUNT(*) AS total_requests,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(SUM(cost_usd), 0) AS total_cost_usd
    FROM llm.requests
    WHERE workspace_id = ${workspaceId}
      AND created_at >= ${sinceDate}
      AND error IS NULL
  `;

  const byModel = await sql<ModelUsage[]>`
    SELECT
      model,
      provider,
      COUNT(*) AS requests,
      COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(SUM(cost_usd), 0) AS cost_usd
    FROM llm.requests
    WHERE workspace_id = ${workspaceId}
      AND created_at >= ${sinceDate}
      AND error IS NULL
    GROUP BY model, provider
    ORDER BY total_tokens DESC
  `;

  return {
    total_requests: parseInt(totals!.total_requests, 10),
    total_tokens: parseInt(totals!.total_tokens, 10),
    total_cost_usd: parseFloat(totals!.total_cost_usd),
    by_model: byModel.map((r) => ({
      model: r.model,
      provider: r.provider,
      requests: parseInt(String(r.requests), 10),
      prompt_tokens: parseInt(String(r.prompt_tokens), 10),
      completion_tokens: parseInt(String(r.completion_tokens), 10),
      total_tokens: parseInt(String(r.total_tokens), 10),
      cost_usd: parseFloat(String(r.cost_usd)),
    })),
  };
}
