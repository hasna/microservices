/**
 * Episodic memory consolidation — groups recent episodic memories into summary memories.
 */

import type { Sql } from "postgres";
import { generateEmbedding } from "./embeddings.js";

export interface ConsolidationResult {
  consolidated_count: number;
  summary_memory_id: string;
  time_window_start: Date;
  time_window_end: Date;
}

/**
 * Consolidate episodic memories within a time window into a single summary memory.
 */
export async function consolidateEpisodicMemories(
  sql: Sql,
  workspaceId: string,
  timeWindowHours = 24,
  deleteOld = false,
  windowStart?: Date,
): Promise<ConsolidationResult> {
  const windowEnd = new Date();
  const start = windowStart ?? new Date(Date.now() - timeWindowHours * 60 * 60 * 1000);

  const rows = await sql<{ id: string; content: string; created_at: Date; importance: number }[]>`
    SELECT id, content, created_at, importance
    FROM memory.memories
    WHERE workspace_id = ${workspaceId}
      AND memory_type = 'episodic'
      AND created_at >= ${start}
      AND created_at <= ${windowEnd}
    ORDER BY created_at ASC
  `;

  if (rows.length === 0) {
    return {
      consolidated_count: 0,
      summary_memory_id: "",
      time_window_start: start,
      time_window_end: windowEnd,
    };
  }

  const timeline = rows
    .map((r) => `[${r.created_at.toISOString()}] ${r.content}`)
    .join("\n");

  const summaryContent =
    `Consolidated episodic memory summary (${rows.length} events, ${start.toISOString()} to ${windowEnd.toISOString()}):\n${timeline}`;

  const avgImportance = rows.reduce((s, r) => s + r.importance, 0) / rows.length;
  const embedding = await generateEmbedding(summaryContent);
  const sourceIds = rows.map((r) => r.id);

  const metadataJson = JSON.stringify({
    consolidated_from: rows.length,
    window_start: start.toISOString(),
    window_end: windowEnd.toISOString(),
    source_ids: sourceIds,
  });

  // Build the embedding value as a proper array literal
  let embeddingValue: any = null;
  if (embedding) {
    embeddingValue = sql`${sql.unsafe(`ARRAY[${embedding.join(",")}]::double precision[]`)}`;
  }

  const [stored] = await sql<{ id: string }[]>`
    INSERT INTO memory.memories
      (workspace_id, content, summary, importance, memory_type, priority,
       embedding_text, embedding, metadata, expires_at)
    VALUES (
      ${workspaceId},
      ${summaryContent},
      ${`Summary of ${rows.length} episodic memories consolidated on ${windowEnd.toISOString()}`},
      ${avgImportance},
      ${"semantic"},
      1,
      ${summaryContent},
      ${embeddingValue},
      ${metadataJson},
      ${null}
    )
    RETURNING id
  `;

  if (deleteOld && rows.length > 0) {
    // Build parameterized IN clause: ($1, $2, $3, ...)
    const placeholders = rows.map((_, i) => `$${i + 1}`).join(", ");
    await sql.unsafe(`DELETE FROM memory.memories WHERE id IN (${placeholders})`, sourceIds);
  }

  return {
    consolidated_count: rows.length,
    summary_memory_id: stored.id,
    time_window_start: start,
    time_window_end: windowEnd,
  };
}

/**
 * Get consolidation candidates — episodic memories that could be consolidated.
 */
export async function getConsolidationCandidates(
  sql: Sql,
  workspaceId: string,
  timeWindowHours = 24,
): Promise<{ count: number; oldest: Date | null; newest: Date | null; avg_importance: number }> {
  const windowStart = new Date(Date.now() - timeWindowHours * 60 * 60 * 1000);

  const [row] = await sql<{ count: number; oldest: Date | null; newest: Date | null; avg_importance: number }[]>`
    SELECT
      COUNT(*) as count,
      MIN(created_at) as oldest,
      MAX(created_at) as newest,
      COALESCE(AVG(importance), 0) as avg_importance
    FROM memory.memories
    WHERE workspace_id = ${workspaceId}
      AND memory_type = 'episodic'
      AND created_at >= ${windowStart}
  `;

  return row ?? { count: 0, oldest: null, newest: null, avg_importance: 0 };
}
