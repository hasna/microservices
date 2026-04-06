/**
 * TTL enforcement and cleanup operations.
 */

import type { Sql } from "postgres";
import type { Memory } from "./memories.js";

/**
 * Delete all memories that have passed their expires_at timestamp.
 * Pinned memories are excluded (they ignore TTL).
 * Returns count of deleted memories.
 */
export async function deleteExpiredMemories(sql: Sql, workspaceId?: string): Promise<number> {
  const result = workspaceId
    ? await sql.unsafe(
        `DELETE FROM memory.memories WHERE workspace_id = $1 AND is_pinned = false AND expires_at IS NOT NULL AND expires_at < NOW()`,
        [workspaceId],
      )
    : await sql.unsafe(
        `DELETE FROM memory.memories WHERE is_pinned = false AND expires_at IS NOT NULL AND expires_at < NOW()`,
      );
  return result.count ?? 0;
}

/**
 * Purge all expired memories regardless of pinned status.
 * Use this for hard cleanup when you want to delete everything past expiry.
 * Returns count of deleted memories.
 */
export async function purgeExpiredMemories(sql: Sql, workspaceId?: string): Promise<number> {
  const result = workspaceId
    ? await sql.unsafe(
        `DELETE FROM memory.memories WHERE workspace_id = $1 AND expires_at IS NOT NULL AND expires_at < NOW()`,
        [workspaceId],
      )
    : await sql.unsafe(
        `DELETE FROM memory.memories WHERE expires_at IS NOT NULL AND expires_at < NOW()`,
      );
  return result.count ?? 0;
}

/**
 * Delete memories older than maxAgeSeconds regardless of expires_at.
 * Useful for LRU-style eviction.
 */
export async function deleteMemoriesByAge(
  sql: Sql,
  workspaceId: string,
  maxAgeSeconds: number,
): Promise<number> {
  const result = await sql.unsafe(
    `DELETE FROM memory.memories WHERE workspace_id = $1 AND created_at < NOW() - INTERVAL '1 second' * $2`,
    [workspaceId, maxAgeSeconds],
  );
  return result.count ?? 0;
}

/**
 * Delete all memories in a namespace (optionally within a collection).
 */
export async function deleteMemoriesByNamespace(
  sql: Sql,
  workspaceId: string,
  namespace: string,
  collectionId?: string,
): Promise<number> {
  if (collectionId) {
    const result = await sql.unsafe(
      `DELETE FROM memory.memories m USING memory.collections c
       WHERE m.collection_id = c.id
         AND c.namespace = $2
         AND m.workspace_id = $1
         AND m.collection_id = $3`,
      [workspaceId, namespace, collectionId],
    );
    return result.count ?? 0;
  }
  const result = await sql.unsafe(
    `DELETE FROM memory.memories m USING memory.collections c
     WHERE m.collection_id = c.id
       AND c.namespace = $2
       AND m.workspace_id = $1`,
    [workspaceId, namespace],
  );
  return result.count ?? 0;
}

/**
 * Delete all memories for a collection.
 */
export async function deleteAllMemoriesInCollection(sql: Sql, collectionId: string): Promise<number> {
  const result = await sql.unsafe(
    `DELETE FROM memory.memories WHERE collection_id = $1`,
    [collectionId],
  );
  return result.count ?? 0;
}

/**
 * Refresh the TTL on a memory (reset its expires_at to now + ttl_seconds).
 * Only works for non-pinned memories. Returns the updated memory or null.
 */
export async function refreshMemoryTTL(sql: Sql, memoryId: string): Promise<string | null> {
  const [mem] = await sql.unsafe(`
    UPDATE memory.memories
    SET expires_at = CASE WHEN ttl_seconds > 0 THEN NOW() + (ttl_seconds || ' seconds')::interval ELSE NULL END
    WHERE id = $1 AND is_pinned = false AND ttl_seconds > 0
    RETURNING id
  `, [memoryId]) as any[];
  return mem?.id ?? null;
}

/**
 * Extend a memory's TTL by additional seconds from now.
 */
export async function extendMemoryTTL(sql: Sql, memoryId: string, additionalSeconds: number): Promise<string | null> {
  if (additionalSeconds <= 0) return null;
  const [mem] = await sql.unsafe(`
    UPDATE memory.memories
    SET expires_at = CASE
        WHEN ttl_seconds > 0 THEN NOW() + ((ttl_seconds + $2) || ' seconds')::interval
        ELSE NOW() + ($2 || ' seconds')::interval
      END,
      ttl_seconds = CASE WHEN ttl_seconds > 0 THEN ttl_seconds + $2 ELSE $2 END
    WHERE id = $1 AND is_pinned = false
    RETURNING id
  `, [memoryId, additionalSeconds]) as any[];
  return mem?.id ?? null;
}

/**
 * Auto-refresh TTL for frequently accessed memories (hotspot TTL renewal).
 * Called automatically when a memory is accessed via logMemoryAccess.
 */
export async function refreshTTLForHotMemory(sql: Sql, memoryId: string, hotThreshold = 5): Promise<void> {
  await sql.unsafe(`
    UPDATE memory.memories m
    SET expires_at = CASE WHEN m.ttl_seconds > 0 THEN NOW() + (m.ttl_seconds || ' seconds')::interval ELSE NULL END
    FROM memory.memory_access_log al
    WHERE al.memory_id = m.id
      AND al.accessed_at > NOW() - INTERVAL '1 hour'
      AND m.is_pinned = false
      AND m.ttl_seconds > 0
    HAVING COUNT(al.id) >= $2
  `, [memoryId, hotThreshold]);
}

/**
 * Get TTL statistics broken down by namespace and memory type.
 */
export async function getMemoryExpiryStats(
  sql: Sql,
  workspaceId: string,
): Promise<Array<{
  namespace: string | null;
  memory_type: string;
  total: number;
  expired: number;
  expiring_soon: number;
  no_ttl: number;
}>> {
  return sql.unsafe(`
    SELECT
      m.metadata->>'namespace' AS namespace,
      m.memory_type,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE m.expires_at < NOW()) AS expired,
      COUNT(*) FILTER (WHERE m.expires_at > NOW() AND m.expires_at < NOW() + INTERVAL '1 day') AS expiring_soon,
      COUNT(*) FILTER (WHERE m.expires_at IS NULL) AS no_ttl
    FROM memory.memories m
    JOIN memory.collections c ON c.id = m.collection_id
    WHERE m.workspace_id = $1
    GROUP BY m.metadata->>'namespace', m.memory_type
    ORDER BY namespace, m.memory_type
  `, [workspaceId]) as any[];
}

/**
 * Set a default TTL for a namespace. All new memories in this namespace
 * will inherit this TTL unless overridden at insert time.
 */
export async function setNamespaceDefaultTTL(
  sql: Sql,
  workspaceId: string,
  namespace: string,
  ttlSeconds: number | null,
): Promise<void> {
  await sql.unsafe(`
    UPDATE memory.namespaces
    SET default_ttl_seconds = $3, updated_at = NOW()
    WHERE workspace_id = $1 AND name = $2
  `, [workspaceId, namespace, ttlSeconds]);
}

/**
 * Get all memories that will expire within a given time window (for pre-emptive alerting).
 */
export async function getExpiringMemories(
  sql: Sql,
  workspaceId: string,
  withinSeconds: number,
  limit = 100,
): Promise<Array<{ id: string; collection_id: string; expires_at: string; memory_type: string }>> {
  return sql.unsafe(`
    SELECT m.id, m.collection_id, m.expires_at::text, m.memory_type
    FROM memory.memories m
    JOIN memory.collections c ON c.id = m.collection_id
    WHERE m.workspace_id = $1
      AND m.expires_at IS NOT NULL
      AND m.expires_at > NOW()
      AND m.expires_at <= NOW() + ($2 || ' seconds')::interval
      AND m.is_pinned = false
    ORDER BY m.expires_at ASC
    LIMIT $3
  `, [workspaceId, withinSeconds, limit]) as any[];
}
