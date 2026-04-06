/**
 * Tiered TTL enforcement — soft-expire then hard-delete with grace periods.
 * Memories past expires_at enter a soft-expired state (soft_expires_at = now + grace_period)
 * A separate purge step handles hard deletion.
 */

import type { Sql } from "postgres";

export interface SoftExpiredResult {
  workspaceId: string;
  namespace: string | null;
  softExpired: number;
  hardPurged: number;
  quotaEnforced: number;
}

/**
 * Apply soft-expire to all memories past their expires_at.
 * Uses namespace grace_period to determine when soft_expires_at fires.
 */
export async function applySoftExpire(
  sql: Sql,
  workspaceId?: string,
): Promise<number> {
  // Get namespaces with grace_periods
  const namespaces = await sql<[{ id: string; workspace_id: string; namespace: string; grace_period_seconds: number }]>`
    SELECT ns.id, ns.workspace_id, ns.namespace, COALESCE(ns.grace_period_seconds, 0) as grace_period_seconds
    FROM memory.namespaces ns
  `;

  let count = 0;
  for (const ns of namespaces) {
    if (workspaceId && ns.workspace_id !== workspaceId) continue;
    const graceSec = ns.grace_period_seconds ?? 0;
    const query = graceSec > 0
      ? sql.unsafe(
          `UPDATE memory.memories m
           SET soft_expires_at = NOW() + ($1 || ' seconds')::interval
           FROM memory.collections c
           WHERE m.collection_id = c.id
             AND c.namespace = $2
             AND m.workspace_id = $3
             AND m.expires_at IS NOT NULL
             AND m.expires_at < NOW()
             AND (m.soft_expires_at IS NULL OR m.soft_expires_at < NOW())
           RETURNING m.id`,
          [String(graceSec), ns.namespace, ns.workspace_id],
        )
      : sql.unsafe(
          `UPDATE memory.memories m
           SET soft_expires_at = NOW()
           FROM memory.collections c
           WHERE m.collection_id = c.id
             AND c.namespace = $1
             AND m.workspace_id = $2
             AND m.expires_at IS NOT NULL
             AND m.expires_at < NOW()
             AND (m.soft_expires_at IS NULL OR m.soft_expires_at < NOW())
           RETURNING m.id`,
          [ns.namespace, ns.workspace_id],
        );
    const result = await query;
    count += result.count ?? 0;
  }
  return count;
}

/**
 * Hard-purge all memories past their soft_expires_at.
 */
export async function purgeSoftExpired(
  sql: Sql,
  workspaceId?: string,
): Promise<number> {
  if (workspaceId) {
    const result = await sql.unsafe(
      `DELETE FROM memory.memories
       WHERE workspace_id = $1
         AND soft_expires_at IS NOT NULL
         AND soft_expires_at < NOW()
       RETURNING id`,
      [workspaceId],
    );
    return result.count ?? 0;
  }
  const result = await sql.unsafe(
    `DELETE FROM memory.memories
     WHERE soft_expires_at IS NOT NULL
       AND soft_expires_at < NOW()
     RETURNING id`,
  );
  return result.count ?? 0;
}

/**
 * Get TTL enforcement statistics for a workspace.
 */
export async function getTtlStats(
  sql: Sql,
  workspaceId: string,
): Promise<{ active: number; softExpired: number; pastExpiry: number; purged: number }> {
  const [active] = await sql.unsafe(
    `SELECT COUNT(*) as c FROM memory.memories WHERE workspace_id = $1 AND expires_at IS NULL AND (soft_expires_at IS NULL OR soft_expires_at > NOW())`,
    [workspaceId],
  );
  const [softExpired] = await sql.unsafe(
    `SELECT COUNT(*) as c FROM memory.memories WHERE workspace_id = $1 AND soft_expires_at IS NOT NULL AND soft_expires_at > NOW()`,
    [workspaceId],
  );
  const [pastExpiry] = await sql.unsafe(
    `SELECT COUNT(*) as c FROM memory.memories WHERE workspace_id = $1 AND expires_at IS NOT NULL AND expires_at < NOW()`,
    [workspaceId],
  );
  const [purged] = await sql.unsafe(
    `SELECT COUNT(*) as c FROM memory.archival_history ah WHERE ah.workspace_id = $1 AND archive_tier = 'deleted' AND archived_at > NOW() - INTERVAL '24 hours'`,
    [workspaceId],
  );
  return {
    active: Number(active?.c ?? 0),
    softExpired: Number(softExpired?.c ?? 0),
    pastExpiry: Number(pastExpiry?.c ?? 0),
    purged: Number(purged?.c ?? 0),
  };
}