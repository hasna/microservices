/**
 * Memory access patterns and frequency tracking.
 * Logs every read/write/search access and provides hotspot/eviction analysis.
 */

import type { Sql } from "postgres";

export type AccessType = "read" | "write" | "search";

export interface MemoryAccessFrequency {
  memory_id: string;
  access_count: number;
  last_accessed: Date;
  trend: "increasing" | "stable" | "decreasing";
}

export interface MemoryHotspot {
  memory_id: string;
  access_count: number;
  last_accessed: Date;
  importance: number;
  priority: number;
}

/**
 * Log a memory access event for frequency analysis.
 */
export async function logMemoryAccess(
  sql: Sql,
  memoryId: string,
  accessType: AccessType,
  responseTimeMs?: number,
): Promise<void> {
  await sql`
    INSERT INTO memory.memory_access_log (memory_id, access_type, response_time_ms)
    VALUES (${memoryId}, ${accessType}, ${responseTimeMs ?? null})
  `;
}

/**
 * Get access frequency for all memories in a namespace over the last N hours.
 * Trend is computed by comparing first-half vs second-half access counts.
 */
export async function getMemoryAccessFrequency(
  sql: Sql,
  namespace: string,
  hours = 24,
): Promise<MemoryAccessFrequency[]> {
  const halfHours = Math.floor(hours / 2);

  // Fetch counts and last_accessed per memory
  const rows = await sql.unsafe(`
    SELECT
      m.id as memory_id,
      COUNT(al.id) as access_count,
      MAX(al.accessed_at) as last_accessed,
      COUNT(al.id) FILTER (WHERE al.accessed_at > NOW() - INTERVAL '1 hour' * $2) as recent_count,
      COUNT(al.id) FILTER (WHERE al.accessed_at <= NOW() - INTERVAL '1 hour' * $2 AND al.accessed_at > NOW() - INTERVAL '1 hour' * $1) as older_count
    FROM memory.memories m
    JOIN memory.collections c ON m.collection_id = c.id
    LEFT JOIN memory.memory_access_log al ON al.memory_id = m.id AND al.accessed_at > NOW() - INTERVAL '1 hour' * $1
    WHERE c.namespace = $3
    GROUP BY m.id
    ORDER BY access_count DESC
  `, [hours, halfHours, namespace]) as any[];

  return rows.map((row) => {
    const recent = Number(row.recent_count ?? 0);
    const older = Number(row.older_count ?? 0);
    let trend: "increasing" | "stable" | "decreasing" = "stable";
    if (recent > older * 1.2) trend = "increasing";
    else if (recent < older * 0.8) trend = "decreasing";

    return {
      memory_id: row.memory_id,
      access_count: Number(row.access_count),
      last_accessed: row.last_accessed,
      trend,
    };
  });
}

/**
 * Get the most frequently accessed memories (hotspots) in a namespace.
 */
export async function getMemoryHotspots(
  sql: Sql,
  namespace: string,
  limit = 10,
): Promise<MemoryHotspot[]> {
  const rows = await sql.unsafe(`
    SELECT
      m.id as memory_id,
      COUNT(al.id) as access_count,
      MAX(al.accessed_at) as last_accessed,
      m.importance,
      m.priority
    FROM memory.memories m
    JOIN memory.collections c ON m.collection_id = c.id
    LEFT JOIN memory.memory_access_log al ON al.memory_id = m.id AND al.accessed_at > NOW() - INTERVAL '24 hours'
    WHERE c.namespace = $1
    GROUP BY m.id
    ORDER BY access_count DESC, m.priority DESC
    LIMIT $2
  `, [namespace, limit]) as any[];

  return rows.map((row) => ({
    memory_id: row.memory_id,
    access_count: Number(row.access_count),
    last_accessed: row.last_accessed,
    importance: row.importance,
    priority: row.priority,
  }));
}

/**
 * Evict least valuable memories: lowest access frequency + lowest priority.
 * Keeps the top `keepCount` memories by score (access_count * 0.4 + priority * 10).
 * Returns count of evicted memories.
 */
export async function evictLeastValuable(
  sql: Sql,
  namespace: string,
  keepCount = 100,
): Promise<number> {
  // Find memories to evict: exclude pinned, expired
  const toEvict = await sql.unsafe(`
    WITH scored AS (
      SELECT
        m.id,
        m.is_pinned,
        COUNT(al.id) as access_count,
        m.priority,
        ROW_NUMBER() OVER (ORDER BY COUNT(al.id) * 0.4 + m.priority * 10 ASC, m.created_at ASC) as rn
      FROM memory.memories m
      JOIN memory.collections c ON m.collection_id = c.id
      LEFT JOIN memory.memory_access_log al ON al.memory_id = m.id AND al.accessed_at > NOW() - INTERVAL '7 days'
      WHERE c.namespace = $1
        AND m.is_pinned = false
        AND (m.expires_at IS NULL OR m.expires_at > NOW())
      GROUP BY m.id
    )
    SELECT id FROM scored WHERE rn > $2
  `, [namespace, keepCount]) as any[];

  if (toEvict.length === 0) return 0;

  const ids = toEvict.map((r) => r.id);
  const result = await sql.unsafe(
    `DELETE FROM memory.memories WHERE id = ANY($1)`,
    [ids],
  );
  return result.count ?? 0;
}
