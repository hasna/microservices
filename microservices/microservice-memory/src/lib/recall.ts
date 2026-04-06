/**
 * Memory recall scoring system.
 * Tracks recall success/failure and computes quality scores.
 */

import type { Sql } from "postgres";

export type RecallMethod = "search" | "direct" | "recommend";

export interface MemoryQualityScore {
  memory_id: string;
  quality_score: number; // 0-100
  access_frequency: number;
  recall_success_rate: number;
  ttl_remaining_ratio: number; // 0-1 (1 = full TTL remaining)
  freshness_score: number; // 0-1 (1 = very recent)
}

export interface MemoryQualityBreakdown {
  memory_id: string;
  quality_score: number;
  access_frequency: number;
  recall_success_rate: number;
  ttl_remaining_ratio: number;
  freshness_score: number;
  importance: number;
  priority: number;
  is_pinned: boolean;
}

/**
 * Record a memory recall event (success or failure).
 */
export async function recordMemoryRecall(
  sql: Sql,
  memoryId: string,
  success: boolean,
  latencyMs?: number,
  method: RecallMethod = "direct",
): Promise<void> {
  await sql`
    INSERT INTO memory.memory_recall_log (memory_id, success, latency_ms, method)
    VALUES (${memoryId}, ${success}, ${latencyMs ?? null}, ${method})
  `;
}

/**
 * Compute a quality score (0-100) for a single memory.
 * Factors: access frequency (normalized), recall success rate, TTL remaining, freshness.
 */
export async function getMemoryQualityScore(
  sql: Sql,
  memoryId: string,
): Promise<MemoryQualityScore | null> {
  const [mem] = await sql<any[]>`
    SELECT id, importance, priority, is_pinned, created_at, expires_at, ttl_seconds
    FROM memory.memories WHERE id = ${memoryId}
  `;
  if (!mem) return null;

  // Access frequency over last 7 days
  const [accessRow] = await sql<any[]>`
    SELECT COUNT(*) as cnt FROM memory.memory_access_log
    WHERE memory_id = ${memoryId} AND accessed_at > NOW() - INTERVAL '7 days'
  `;
  const accessFrequency = Number(accessRow?.cnt ?? 0);
  const normalizedAccess = Math.min(1.0, accessFrequency / 100); // cap at 100 accesses = full score

  // Recall success rate over last 7 days
  const [recallRow] = await sql<any[]>`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE success = true) as successful
    FROM memory.memory_recall_log
    WHERE memory_id = ${memoryId} AND recalled_at > NOW() - INTERVAL '7 days'
  `;
  const totalRecalls = Number(recallRow?.total ?? 0);
  const successfulRecalls = Number(recallRow?.successful ?? 0);
  const recallSuccessRate = totalRecalls > 0 ? successfulRecalls / totalRecalls : 1.0;

  // TTL remaining ratio
  let ttlRemainingRatio = 1.0;
  if (mem.expires_at && mem.ttl_seconds > 0) {
    const now = new Date();
    const expiresAt = new Date(mem.expires_at);
    const totalMs = mem.ttl_seconds * 1000;
    const elapsedMs = now.getTime() - (expiresAt.getTime() - totalMs);
    ttlRemainingRatio = Math.max(0, Math.min(1, elapsedMs / totalMs));
  } else if (!mem.expires_at) {
    ttlRemainingRatio = 1.0; // no expiry = full
  }

  // Freshness: newer memories score higher (created within last 24h = 1.0, older decays to 0.2)
  const ageHours = (Date.now() - new Date(mem.created_at).getTime()) / (1000 * 60 * 60);
  const freshnessScore = Math.max(0.2, 1.0 - ageHours / (24 * 30)); // decay over 30 days

  // Weighted quality score
  const qualityScore = Math.round(
    (normalizedAccess * 25) +
    (recallSuccessRate * 30) +
    (ttlRemainingRatio * 25) +
    (freshnessScore * 20),
  );

  return {
    memory_id: memoryId,
    quality_score: qualityScore,
    access_frequency: accessFrequency,
    recall_success_rate: recallSuccessRate,
    ttl_remaining_ratio: ttlRemainingRatio,
    freshness_score: freshnessScore,
  };
}

/**
 * Get quality breakdown for all memories accessible in a workspace.
 * Optionally filter by namespace.
 */
export async function getMemoryQualityReport(
  sql: Sql,
  workspaceId: string,
  namespace?: string,
): Promise<MemoryQualityBreakdown[]> {
  let query: string;
  let params: any[];

  if (namespace) {
    query = `
      SELECT
        m.id as memory_id,
        m.importance,
        m.priority,
        m.is_pinned,
        m.created_at,
        m.expires_at,
        m.ttl_seconds,
        COUNT(al.id) as access_frequency,
        COUNT(rl.id) as total_recalls,
        COUNT(rl.id) FILTER (WHERE rl.success = true) as successful_recalls
      FROM memory.memories m
      JOIN memory.collections c ON m.collection_id = c.id
      LEFT JOIN memory.memory_access_log al ON al.memory_id = m.id AND al.accessed_at > NOW() - INTERVAL '7 days'
      LEFT JOIN memory.memory_recall_log rl ON rl.memory_id = m.id AND rl.recalled_at > NOW() - INTERVAL '7 days'
      WHERE m.workspace_id = $1 AND c.namespace = $2
      GROUP BY m.id
      ORDER BY m.priority DESC, m.created_at DESC
    `;
    params = [workspaceId, namespace];
  } else {
    query = `
      SELECT
        m.id as memory_id,
        m.importance,
        m.priority,
        m.is_pinned,
        m.created_at,
        m.expires_at,
        m.ttl_seconds,
        COUNT(al.id) as access_frequency,
        COUNT(rl.id) as total_recalls,
        COUNT(rl.id) FILTER (WHERE rl.success = true) as successful_recalls
      FROM memory.memories m
      LEFT JOIN memory.memory_access_log al ON al.memory_id = m.id AND al.accessed_at > NOW() - INTERVAL '7 days'
      LEFT JOIN memory.memory_recall_log rl ON rl.memory_id = m.id AND rl.recalled_at > NOW() - INTERVAL '7 days'
      WHERE m.workspace_id = $1
      GROUP BY m.id
      ORDER BY m.priority DESC, m.created_at DESC
    `;
    params = [workspaceId];
  }

  const rows = await sql.unsafe(query, params) as any[];

  return rows.map((row) => {
    const normalizedAccess = Math.min(1.0, Number(row.access_frequency ?? 0) / 100);
    const totalRecalls = Number(row.total_recalls ?? 0);
    const successfulRecalls = Number(row.successful_recalls ?? 0);
    const recallSuccessRate = totalRecalls > 0 ? successfulRecalls / totalRecalls : 1.0;

    let ttlRemainingRatio = 1.0;
    if (row.expires_at && row.ttl_seconds > 0) {
      const now = new Date();
      const expiresAt = new Date(row.expires_at);
      const totalMs = row.ttl_seconds * 1000;
      const elapsedMs = now.getTime() - (expiresAt.getTime() - totalMs);
      ttlRemainingRatio = Math.max(0, Math.min(1, elapsedMs / totalMs));
    }

    const ageHours = (Date.now() - new Date(row.created_at).getTime()) / (1000 * 60 * 60);
    const freshnessScore = Math.max(0.2, 1.0 - ageHours / (24 * 30));

    const qualityScore = Math.round(
      (normalizedAccess * 25) +
      (recallSuccessRate * 30) +
      (ttlRemainingRatio * 25) +
      (freshnessScore * 20),
    );

    return {
      memory_id: row.memory_id,
      quality_score: qualityScore,
      access_frequency: Number(row.access_frequency ?? 0),
      recall_success_rate: recallSuccessRate,
      ttl_remaining_ratio: ttlRemainingRatio,
      freshness_score: freshnessScore,
      importance: row.importance,
      priority: row.priority,
      is_pinned: row.is_pinned,
    };
  });
}
