/**
 * Recall analytics — track and analyze memory access patterns.
 * Measures which memories are accessed, how often, and how effectively
 * they serve retrieval needs.
 */

import type { Sql } from "postgres";

export interface RecallEvent {
  memory_id: string;
  user_id: string;
  workspace_id: string;
  namespace_id: string | null;
  recall_method: "search" | "direct" | "auto" | "link" | "context";
  relevance_score: number | null;
  recall_latency_ms: number | null;
  created_at: string;
}

export interface RecallStats {
  total_recalls: number;
  unique_memories: number;
  unique_users: number;
  by_method: { method: string; count: number }[];
  avg_relevance: number | null;
  avg_latency_ms: number | null;
  period_start: string | null;
  period_end: string | null;
}

export interface MemoryRecallPopularity {
  memory_id: string;
  recall_count: number;
  unique_users: number;
  last_recalled_at: string | null;
  avg_relevance: number | null;
  namespace_id: string | null;
}

export interface RecallTrendPoint {
  period: string;
  recall_count: number;
  unique_memories: number;
  avg_relevance: number | null;
}

export interface RecallMiss {
  memory_id: string;
  query_text: string;
  attempted_at: string;
  namespace_id: string | null;
}

/**
 * Record a memory recall event.
 */
export async function recordRecall(
  sql: Sql,
  memoryId: string,
  userId: string,
  workspaceId: string,
  opts?: {
    namespaceId?: string;
    recallMethod?: "search" | "direct" | "auto" | "link" | "context";
    relevanceScore?: number;
    recallLatencyMs?: number;
  },
): Promise<void> {
  await sql`
    INSERT INTO memory.recall_events (
      memory_id, user_id, workspace_id, namespace_id,
      recall_method, relevance_score, recall_latency_ms
    )
    VALUES (
      ${memoryId},
      ${userId},
      ${workspaceId},
      ${opts?.namespaceId ?? null},
      ${opts?.recallMethod ?? "direct"},
      ${opts?.relevanceScore ?? null},
      ${opts?.recallLatencyMs ?? null}
    )
  `;

  // Update recall_count on the memory itself
  await sql`
    UPDATE memory.memories
    SET recall_count = COALESCE(recall_count, 0) + 1,
        last_recalled_at = NOW()
    WHERE id = ${memoryId}
  `;
}

/**
 * Get recall statistics for a workspace.
 */
export async function getRecallStats(
  sql: Sql,
  workspaceId: string,
  since?: string,
): Promise<RecallStats> {
  const periodStart = since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [totalResult] = await sql<{ total: number; unique_mems: number; unique_users: number; avg_rel: number | null; avg_lat: number | null }[]>`
    SELECT
      COUNT(*)::int as total,
      COUNT(DISTINCT memory_id)::int as unique_mems,
      COUNT(DISTINCT user_id)::int as unique_users,
      AVG(relevance_score)::float as avg_rel,
      AVG(recall_latency_ms)::float as avg_lat
    FROM memory.recall_events
    WHERE workspace_id = ${workspaceId} AND created_at >= ${periodStart}
  `;

  const byMethod = await sql<{ method: string; count: number }[]>`
    SELECT recall_method as method, COUNT(*)::int as count
    FROM memory.recall_events
    WHERE workspace_id = ${workspaceId} AND created_at >= ${periodStart}
    GROUP BY recall_method
    ORDER BY count DESC
  `;

  return {
    total_recalls: totalResult.total,
    unique_memories: totalResult.unique_mems,
    unique_users: totalResult.unique_users,
    by_method: byMethod,
    avg_relevance: totalResult.avg_rel,
    avg_latency_ms: totalResult.avg_lat,
    period_start: periodStart,
    period_end: new Date().toISOString(),
  };
}

/**
 * Get most frequently recalled memories (popularity ranking).
 */
export async function getMemoryRecallPopularity(
  sql: Sql,
  workspaceId: string,
  opts?: {
    namespaceId?: string;
    limit?: number;
    since?: string;
  },
): Promise<MemoryRecallPopularity[]> {
  const limit = opts?.limit ?? 50;
  const since = opts?.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const rows = opts?.namespaceId
    ? await sql<MemoryRecallPopularity[]>`
        SELECT
          m.id as memory_id,
          COUNT(r.id)::int as recall_count,
          COUNT(DISTINCT r.user_id)::int as unique_users,
          MAX(r.created_at) as last_recalled_at,
          AVG(r.relevance_score)::float as avg_relevance,
          m.namespace_id
        FROM memory.memories m
        LEFT JOIN memory.recall_events r ON r.memory_id = m.id AND r.created_at >= ${since}
        WHERE m.workspace_id = ${workspaceId} AND m.namespace_id = ${opts.namespaceId}
        GROUP BY m.id, m.namespace_id
        ORDER BY recall_count DESC
        LIMIT ${limit}
      `
    : await sql<MemoryRecallPopularity[]>`
        SELECT
          m.id as memory_id,
          COUNT(r.id)::int as recall_count,
          COUNT(DISTINCT r.user_id)::int as unique_users,
          MAX(r.created_at) as last_recalled_at,
          AVG(r.relevance_score)::float as avg_relevance,
          m.namespace_id
        FROM memory.memories m
        LEFT JOIN memory.recall_events r ON r.memory_id = m.id AND r.created_at >= ${since}
        WHERE m.workspace_id = ${workspaceId}
        GROUP BY m.id, m.namespace_id
        ORDER BY recall_count DESC
        LIMIT ${limit}
      `;

  return rows.map(r => ({
    memory_id: r.memory_id,
    recall_count: r.recall_count,
    unique_users: r.unique_users,
    last_recalled_at: r.last_recalled_at,
    avg_relevance: r.avg_relevance,
    namespace_id: r.namespace_id,
  }));
}

/**
 * Get recall trend over time (daily buckets).
 */
export async function getRecallTrend(
  sql: Sql,
  workspaceId: string,
  buckets = 30,
): Promise<RecallTrendPoint[]> {
  const since = new Date(Date.now() - buckets * 24 * 60 * 60 * 1000).toISOString();

  const rows = await sql<{ period: string; recall_count: number; unique_mems: number; avg_rel: number | null }[]>`
    SELECT
      DATE(created_at)::text as period,
      COUNT(*)::int as recall_count,
      COUNT(DISTINCT memory_id)::int as unique_mems,
      AVG(relevance_score)::float as avg_rel
    FROM memory.recall_events
    WHERE workspace_id = ${workspaceId} AND created_at >= ${since}
    GROUP BY DATE(created_at)
    ORDER BY period ASC
  `;

  return rows.map(r => ({
    period: r.period,
    recall_count: r.recall_count,
    unique_memories: r.unique_mems,
    avg_relevance: r.avg_rel,
  }));
}

/**
 * Find memories with high recall but low relevance (potential mismatched recalls).
 */
export async function findRecallMismatches(
  sql: Sql,
  workspaceId: string,
  minRecalls = 10,
): Promise<Array<{ memory_id: string; recall_count: number; avg_relevance: number }>> {
  return sql<Array<{ memory_id: string; recall_count: number; avg_relevance: number }>>`
    SELECT
      r.memory_id,
      COUNT(*)::int as recall_count,
      AVG(r.relevance_score)::float as avg_relevance
    FROM memory.recall_events r
    WHERE r.workspace_id = ${workspaceId}
    GROUP BY r.memory_id
    HAVING COUNT(*) >= ${minRecalls} AND AVG(r.relevance_score) < 0.5
    ORDER BY avg_relevance ASC
    LIMIT 50
  `;
}

/**
 * Record a recall miss (query that found no good results).
 */
export async function recordRecallMiss(
  sql: Sql,
  queryText: string,
  userId: string,
  workspaceId: string,
  namespaceId?: string,
): Promise<void> {
  await sql`
    INSERT INTO memory.recall_misses (query_text, user_id, workspace_id, namespace_id)
    VALUES (${queryText}, ${userId}, ${workspaceId}, ${namespaceId ?? null})
  `;
}

/**
 * Get recall miss patterns (common queries that fail).
 */
export async function getRecallMissPatterns(
  sql: Sql,
  workspaceId: string,
  limit = 20,
): Promise<Array<{ query_text: string; miss_count: number; last_attempted_at: string }>> {
  return sql<Array<{ query_text: string; miss_count: number; last_attempted_at: string }>>`
    SELECT
      query_text,
      COUNT(*)::int as miss_count,
      MAX(created_at) as last_attempted_at
    FROM memory.recall_misses
    WHERE workspace_id = ${workspaceId}
    GROUP BY query_text
    ORDER BY miss_count DESC
    LIMIT ${limit}
  `;
}

/**
 * Get recall heatmap data for a workspace (which hours/days have most recalls).
 */
export async function getRecallHeatmap(
  sql: Sql,
  workspaceId: string,
  since?: string,
): Promise<{ day_of_week: number; hour_of_day: number; count: number }[]> {
  const periodStart = since ?? new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  return sql<{ day_of_week: number; hour_of_day: number; count: number }[]>`
    SELECT
      EXTRACT(DOW FROM created_at)::int as day_of_week,
      EXTRACT(HOUR FROM created_at)::int as hour_of_day,
      COUNT(*)::int as count
    FROM memory.recall_events
    WHERE workspace_id = ${workspaceId} AND created_at >= ${periodStart}
    GROUP BY day_of_week, hour_of_day
    ORDER BY day_of_week, hour_of_day
  `;
}