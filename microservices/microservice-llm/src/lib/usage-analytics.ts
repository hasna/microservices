/**
 * Usage analytics — detailed cost and usage breakdown per workspace.
 */

import type { Sql } from "postgres";

export interface WorkspaceUsageSummary {
  workspaceId: string;
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  cachedRequests: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface ModelBreakdown {
  model: string;
  provider: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  avgLatencyMs: number;
  errorRate: number;
}

export interface DailyUsage {
  date: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface TopUser {
  userId: string | null;
  requests: number;
  totalTokens: number;
  costUsd: number;
}

export async function getWorkspaceUsageSummary(
  sql: Sql,
  opts: {
    workspaceId: string;
    periodHours?: number;
  },
): Promise<WorkspaceUsageSummary | null> {
  const hours = opts.periodHours ?? 720; // default 30 days
  const since = new Date(Date.now() - hours * 3_600_000);

  const [row] = await sql`
    SELECT
      workspace_id,
      COUNT(*)::int AS total_requests,
      SUM(prompt_tokens)::bigint AS total_prompt_tokens,
      SUM(completion_tokens)::bigint AS total_completion_tokens,
      SUM(total_tokens)::bigint AS total_tokens,
      ROUND(SUM(cost_usd)::numeric, 6)::numeric AS total_cost_usd,
      ROUND(AVG(latency_ms)::numeric, 2)::numeric AS avg_latency_ms,
      COUNT(*) FILTER (WHERE cached = true)::int AS cached_requests,
      MIN(created_at) AS period_start,
      MAX(created_at) AS period_end
    FROM llm.requests
    WHERE workspace_id = ${opts.workspaceId}
      AND created_at >= ${since}
    GROUP BY workspace_id
  `;

  if (!row) return null;

  return {
    workspaceId: row.workspace_id,
    totalRequests: row.total_requests,
    totalPromptTokens: Number(row.total_prompt_tokens),
    totalCompletionTokens: Number(row.total_completion_tokens),
    totalTokens: Number(row.total_tokens),
    totalCostUsd: Number(row.total_cost_usd ?? 0),
    avgLatencyMs: Number(row.avg_latency_ms ?? 0),
    cachedRequests: row.cached_requests,
    periodStart: row.period_start,
    periodEnd: row.period_end,
  };
}

export async function getModelBreakdown(
  sql: Sql,
  opts: {
    workspaceId: string;
    periodHours?: number;
    limit?: number;
  },
): Promise<ModelBreakdown[]> {
  const hours = opts.periodHours ?? 720;
  const since = new Date(Date.now() - hours * 3_600_000);
  const limit = opts.limit ?? 20;

  const rows = await sql`
    SELECT
      model,
      provider,
      COUNT(*)::int AS requests,
      SUM(prompt_tokens)::bigint AS prompt_tokens,
      SUM(completion_tokens)::bigint AS completion_tokens,
      SUM(total_tokens)::bigint AS total_tokens,
      ROUND(SUM(cost_usd)::numeric, 6)::numeric AS cost_usd,
      ROUND(AVG(latency_ms)::numeric, 2)::numeric AS avg_latency_ms,
      ROUND(
        COUNT(*) FILTER (WHERE error IS NOT NULL)::numeric /
        NULLIF(COUNT(*), 0) * 100,
        2
      )::numeric AS error_rate
    FROM llm.requests
    WHERE workspace_id = ${opts.workspaceId}
      AND created_at >= ${since}
    GROUP BY model, provider
    ORDER BY cost_usd DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    model: r.model,
    provider: r.provider,
    requests: r.requests,
    promptTokens: Number(r.prompt_tokens),
    completionTokens: Number(r.completion_tokens),
    totalTokens: Number(r.total_tokens),
    costUsd: Number(r.cost_usd ?? 0),
    avgLatencyMs: Number(r.avg_latency_ms ?? 0),
    errorRate: Number(r.error_rate ?? 0),
  }));
}

export async function getDailyUsage(
  sql: Sql,
  opts: {
    workspaceId: string;
    periodDays?: number;
  },
): Promise<DailyUsage[]> {
  const days = opts.periodDays ?? 30;
  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await sql`
    SELECT
      DATE(created_at) AS date,
      COUNT(*)::int AS requests,
      SUM(prompt_tokens)::bigint AS prompt_tokens,
      SUM(completion_tokens)::bigint AS completion_tokens,
      SUM(total_tokens)::bigint AS total_tokens,
      ROUND(SUM(cost_usd)::numeric, 6)::numeric AS cost_usd
    FROM llm.requests
    WHERE workspace_id = ${opts.workspaceId}
      AND created_at >= ${since}
    GROUP BY DATE(created_at)
    ORDER BY date
  `;

  return rows.map((r) => ({
    date: r.date.toISOString().split("T")[0],
    requests: r.requests,
    promptTokens: Number(r.prompt_tokens),
    completionTokens: Number(r.completion_tokens),
    totalTokens: Number(r.total_tokens),
    costUsd: Number(r.cost_usd ?? 0),
  }));
}

export async function getTopUsers(
  sql: Sql,
  opts: {
    workspaceId: string;
    periodHours?: number;
    limit?: number;
  },
): Promise<TopUser[]> {
  // Note: requests table doesn't have user_id, so this returns null user_id
  // In practice you'd join with an audit/user_id column if added
  const hours = opts.periodHours ?? 720;
  const since = new Date(Date.now() - hours * 3_600_000);
  const limit = opts.limit ?? 10;

  const rows = await sql`
    SELECT
      NULL::uuid AS user_id,
      COUNT(*)::int AS requests,
      SUM(total_tokens)::bigint AS total_tokens,
      ROUND(SUM(cost_usd)::numeric, 6)::numeric AS cost_usd
    FROM llm.requests
    WHERE workspace_id = ${opts.workspaceId}
      AND created_at >= ${since}
    GROUP BY user_id
    ORDER BY cost_usd DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    userId: r.user_id,
    requests: r.requests,
    totalTokens: Number(r.total_tokens),
    costUsd: Number(r.cost_usd ?? 0),
  }));
}

export async function getProviderBreakdown(
  sql: Sql,
  opts: {
    workspaceId: string;
    periodHours?: number;
  },
): Promise<Array<{ provider: string; requests: number; costUsd: number; avgLatencyMs: number }>> {
  const hours = opts.periodHours ?? 720;
  const since = new Date(Date.now() - hours * 3_600_000);

  const rows = await sql`
    SELECT
      provider,
      COUNT(*)::int AS requests,
      ROUND(SUM(cost_usd)::numeric, 6)::numeric AS cost_usd,
      ROUND(AVG(latency_ms)::numeric, 2)::numeric AS avg_latency_ms
    FROM llm.requests
    WHERE workspace_id = ${opts.workspaceId}
      AND created_at >= ${since}
    GROUP BY provider
    ORDER BY cost_usd DESC
  `;

  return rows.map((r) => ({
    provider: r.provider,
    requests: r.requests,
    costUsd: Number(r.cost_usd ?? 0),
    avgLatencyMs: Number(r.avg_latency_ms ?? 0),
  }));
}
