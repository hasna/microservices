/**
 * TTL escalation — automatically extend TTL for high-value memories
 * before they expire, based on importance, access frequency, and links.
 * Prevents accidentally deleting important memories that are still relevant.
 */

import type { Sql } from "postgres";

export interface TTLEscalationResult {
  escalatedCount: number;
  extendedMemories: string[];
  skippedCount: number;
  totalProcessed: number;
}

export interface TTLEscalationPolicy {
  workspaceId: string;
  minImportanceScore: number;
  escalationMultiplier: number; // multiply existing TTL by this (e.g., 2.0 = double)
  maxTTLSeconds: number | null; // cap at this TTL (null = no cap)
  checkAccessLog: boolean; // require recent access to escalate
  accessLogHoursThreshold: number; // must have been accessed within this many hours
  checkLinks: boolean; // boost if memory has incoming links
  dryRun: boolean;
}

/**
 * Get memories that are about to expire but qualify for TTL escalation.
 * Returns memories where:
 * - expires_at is within the next `windowHours` AND
 * - importance >= policy.minImportanceScore AND
 * - (if checkAccessLog) accessed within accessLogHoursThreshold hours AND
 * - (if checkLinks) has incoming links
 */
export async function getEscalationCandidates(
  sql: Sql,
  workspaceId: string,
  windowHours: number = 72,
): Promise<Array<{
  id: string;
  workspaceId: string;
  content: string;
  importance: number;
  expiresAt: Date;
  ttlSeconds: number | null;
  accessCount: number;
  incomingLinkCount: number;
  lastAccessedAt: Date | null;
}>> {
  const rows = await sql<any[]>`
    WITH access_counts AS (
      SELECT memory_id,
             COUNT(*)::int AS access_count,
             MAX(accessed_at) AS last_accessed_at
        FROM memory.memory_access_log
       WHERE accessed_at >= NOW() - INTERVAL '1 hour' * ${windowHours}
    GROUP BY memory_id
    ),
    link_counts AS (
      SELECT target_memory_id AS memory_id,
             COUNT(*)::int AS incoming_link_count
        FROM memory.memory_links
    GROUP BY target_memory_id
    )
    SELECT
      m.id,
      m.workspace_id,
      LEFT(m.content, 200) AS content,
      m.importance,
      m.expires_at,
      m.ttl_seconds,
      COALESCE(ac.access_count, 0)::int AS access_count,
      COALESCE(lc.incoming_link_count, 0)::int AS incoming_link_count,
      ac.last_accessed_at
    FROM memory.memories m
    LEFT JOIN access_counts ac ON ac.memory_id = m.id
    LEFT JOIN link_counts lc ON lc.memory_id = m.id
    WHERE m.workspace_id = ${workspaceId}
      AND m.expires_at IS NOT NULL
      AND m.expires_at > NOW()
      AND m.expires_at <= NOW() + INTERVAL '1 hour' * ${windowHours}
      AND m.is_pinned = false
    ORDER BY m.importance DESC, m.expires_at ASC
  `;

  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    content: r.content,
    importance: Number(r.importance),
    expiresAt: r.expires_at,
    ttlSeconds: r.ttl_seconds,
    accessCount: r.access_count,
    incomingLinkCount: r.incoming_link_count,
    lastAccessedAt: r.last_accessed_at,
  }));
}

/**
 * Escalate TTL for qualifying memories — extend their expires_at
 * based on importance and other signals.
 */
export async function escalateMemories(
  sql: Sql,
  workspaceId: string,
  policy: TTLEscalationPolicy,
): Promise<TTLEscalationResult> {
  if (policy.dryRun) {
    const candidates = await getEscalationCandidates(sql, workspaceId, 72);
    const filtered = candidates.filter((c) => {
      if (c.importance < policy.minImportanceScore) return false;
      if (policy.checkAccessLog && c.accessCount === 0) return false;
      if (policy.checkLinks && c.incomingLinkCount === 0) return false;
      return true;
    });
    return {
      escalatedCount: filtered.length,
      extendedMemories: filtered.map((m) => m.id),
      skippedCount: candidates.length - filtered.length,
      totalProcessed: candidates.length,
    };
  }

  // Get candidates
  const candidates = await getEscalationCandidates(sql, workspaceId, 72);

  const toEscalate: string[] = [];
  let skippedCount = 0;

  for (const candidate of candidates) {
    // Check importance threshold
    if (candidate.importance < policy.minImportanceScore) {
      skippedCount++;
      continue;
    }

    // Check access log requirement
    if (policy.checkAccessLog && candidate.accessCount === 0) {
      skippedCount++;
      continue;
    }

    // Check links requirement
    if (policy.checkLinks && candidate.incomingLinkCount === 0) {
      skippedCount++;
      continue;
    }

    toEscalate.push(candidate.id);
  }

  // Escalate each memory
  const extendedMemories: string[] = [];
  for (const memoryId of toEscalate) {
    const candidate = candidates.find((c) => c.id === memoryId)!;

    // Calculate new TTL
    let baseTTL = candidate.ttlSeconds ?? 7 * 24 * 3600; // default 7 days
    let newTTL = Math.round(baseTTL * policy.escalationMultiplier);

    if (policy.maxTTLSeconds !== null && newTTL > policy.maxTTLSeconds) {
      newTTL = policy.maxTTLSeconds;
    }

    const newExpiresAt = new Date(Date.now() + newTTL * 1000);

    await sql`
      UPDATE memory.memories
      SET expires_at = ${newExpiresAt},
          updated_at = NOW()
      WHERE id = ${memoryId}
    `;

    extendedMemories.push(memoryId);
  }

  return {
    escalatedCount: extendedMemories.length,
    extendedMemories,
    skippedCount,
    totalProcessed: candidates.length,
  };
}

/**
 * Get TTL escalation stats for a workspace — how many memories
 * are in each escalation tier.
 */
export async function getEscalationStats(
  sql: Sql,
  workspaceId: string,
  windowHours: number = 72,
): Promise<{
  totalExpiringSoon: number;
  highValue: number;
  mediumValue: number;
  lowValue: number;
  lastEscalationAt: Date | null;
}> {
  const candidates = await getEscalationCandidates(sql, workspaceId, windowHours);

  const highValue = candidates.filter((c) => c.importance >= 0.8).length;
  const mediumValue = candidates.filter((c) => c.importance >= 0.5 && c.importance < 0.8).length;
  const lowValue = candidates.filter((c) => c.importance < 0.5).length;

  const [lastRun] = await sql<any[]>`
    SELECT MAX(updated_at) AS last_escalation_at
    FROM memory.memories
    WHERE workspace_id = ${workspaceId}
      AND expires_at IS NOT NULL
      AND updated_at > NOW() - INTERVAL '1 hour' * ${windowHours}
  `;

  return {
    totalExpiringSoon: candidates.length,
    highValue,
    mediumValue,
    lowValue,
    lastEscalationAt: lastRun?.last_escalation_at ?? null,
  };
}

/**
 * Set a workspace-level escalation policy (stored in namespace metadata).
 */
export async function setEscalationPolicy(
  sql: Sql,
  workspaceId: string,
  policy: Omit<TTLEscalationPolicy, "workspaceId" | "dryRun">,
): Promise<void> {
  await sql`
    INSERT INTO memory.namespaces (workspace_id, name, description, default_ttl_seconds)
    VALUES (${workspaceId}, '_escalation_policy', 'TTL escalation config', NULL)
    ON CONFLICT (workspace_id, name) DO UPDATE
    SET description = ${JSON.stringify(policy)}
  `;
}

/**
 * Get the escalation policy for a workspace.
 */
export async function getEscalationPolicy(
  sql: Sql,
  workspaceId: string,
): Promise<Omit<TTLEscalationPolicy, "workspaceId" | "dryRun"> | null> {
  const [ns] = await sql<any[]>`
    SELECT description FROM memory.namespaces
    WHERE workspace_id = ${workspaceId} AND name = '_escalation_policy'
  `;

  if (!ns?.description) return null;
  try {
    return JSON.parse(ns.description);
  } catch {
    return null;
  }
}
