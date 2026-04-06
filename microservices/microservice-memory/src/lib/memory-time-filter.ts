/**
 * Time-range filtered recall — query memories within specific temporal windows.
 *
 * Allows retrieving memories from specific time periods (e.g., "last week",
 * "March 2024", "before system update"). Complements semantic/text search
 * with temporal filtering.
 */

import type { Sql } from "postgres";
import { generateEmbedding } from "./embeddings.js";

export interface TimeRange {
  start?: Date;
  end?: Date;
}

export interface TimeFilteredMemory {
  id: string;
  workspace_id: string;
  user_id: string | null;
  collection_id: string | null;
  content: string;
  summary: string | null;
  importance: number;
  memory_type: string;
  priority: number;
  created_at: Date;
  updated_at: Date;
  relevance_within_window: number; // 0-1 score for ordering within window
}

/**
 * Retrieve memories within a time range with optional semantic search.
 *
 * @param sql         - database handle
 * @param workspaceId - workspace to search
 * @param timeRange   - start and/or end Date bounds
 * @param query       - optional semantic/text query to score within window
 * @param limit       - max results
 */
export async function getMemoriesInTimeRange(
  sql: Sql,
  workspaceId: string,
  timeRange: TimeRange,
  query?: string,
  limit = 20,
): Promise<TimeFilteredMemory[]> {
  const conditions: string[] = ["workspace_id = $1"];
  const params: any[] = [workspaceId];
  let paramIdx = 2;

  if (timeRange.start) {
    conditions.push(`created_at >= $${paramIdx}`);
    params.push(timeRange.start.toISOString());
    paramIdx++;
  }
  if (timeRange.end) {
    conditions.push(`created_at <= $${paramIdx}`);
    params.push(timeRange.end.toISOString());
    paramIdx++;
  }

  const whereClause = conditions.join(" AND ");

  // If no query, just return by recency within window
  if (!query) {
    const rows = await sql.unsafe(`
      SELECT id, workspace_id, user_id, collection_id, content, summary,
             importance, memory_type, priority, created_at, updated_at
      FROM memory.memories
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `, params) as any[];
    return (rows ?? []).map((r: any) => ({
      ...r,
      relevance_within_window: 1,
    }));
  }

  // Score semantic relevance within window
  const embedding = await generateEmbedding(query);
  const embeddingStr = embedding ? `[${embedding.join(",")}]` : null;

  const rows = await sql.unsafe(`
    SELECT
      m.id, m.workspace_id, m.user_id, m.collection_id, m.content, m.summary,
      m.importance, m.memory_type, m.priority, m.created_at, m.updated_at,
      ${embeddingStr ? `1 - (m.embedding <=> '${embeddingStr}'::vector) AS semantic_score` : "0 AS semantic_score"}
    FROM memory.memories m
    WHERE ${whereClause}
      ${embeddingStr ? "AND m.embedding IS NOT NULL" : ""}
    ORDER BY semantic_score DESC, m.created_at DESC
    LIMIT ${limit}
  `, params) as any[];

  return (rows ?? []).map((r: any) => ({
    ...r,
    relevance_within_window: r.semantic_score ?? 1,
  }));
}

/**
 * Get memories from a specific relative time period.
 * e.g., "last 7 days", "last 30 days", "last year".
 *
 * @param sql         - database handle
 * @param workspaceId - workspace to search
 * @param periodDays  - number of days to look back (1 = today, 7 = last week, 30 = last month)
 * @param query       - optional text query
 * @param limit       - max results
 */
export async function getRecentMemories(
  sql: Sql,
  workspaceId: string,
  periodDays: number,
  query?: string,
  limit = 20,
): Promise<TimeFilteredMemory[]> {
  const start = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
  return getMemoriesInTimeRange(sql, workspaceId, { start }, query, limit);
}

/**
 * Get memories before a specific event/date (historical lookup).
 * Useful for "what did the user know before X".
 *
 * @param sql         - database handle
 * @param workspaceId - workspace to search
 * @param beforeDate  - cutoff date
 * @param query       - optional text query
 * @param limit       - max results
 */
export async function getMemoriesBefore(
  sql: Sql,
  workspaceId: string,
  beforeDate: Date,
  query?: string,
  limit = 20,
): Promise<TimeFilteredMemory[]> {
  return getMemoriesInTimeRange(sql, workspaceId, { end: beforeDate }, query, limit);
}

/**
 * Memory timeline — get a chronological timeline of all memories
 * in a workspace, optionally filtered by type.
 */
export async function getMemoryTimeline(
  sql: Sql,
  workspaceId: string,
  opts: {
    memoryType?: string;
    start?: Date;
    end?: Date;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{
  memories: TimeFilteredMemory[];
  total: number;
}> {
  const conditions: string[] = ["workspace_id = $1"];
  const params: any[] = [workspaceId];
  let paramIdx = 2;

  if (opts.memoryType) {
    conditions.push(`memory_type = $${paramIdx}`);
    params.push(opts.memoryType);
    paramIdx++;
  }
  if (opts.start) {
    conditions.push(`created_at >= $${paramIdx}`);
    params.push(opts.start.toISOString());
    paramIdx++;
  }
  if (opts.end) {
    conditions.push(`created_at <= $${paramIdx}`);
    params.push(opts.end.toISOString());
    paramIdx++;
  }

  const whereClause = conditions.join(" AND ");
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const [countRow] = await sql.unsafe(
    `SELECT COUNT(*)::int AS total FROM memory.memories WHERE ${whereClause}`,
    params,
  ) as any[];
  const total = countRow?.total ?? 0;

  const rows = await sql.unsafe(`
    SELECT id, workspace_id, user_id, collection_id, content, summary,
           importance, memory_type, priority, created_at, updated_at
    FROM memory.memories
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `, params) as any[];

  return {
    memories: (rows ?? []).map((r: any) => ({ ...r, relevance_within_window: 1 })),
    total,
  };
}
