/**
 * Memory archival policies — define automatic archival rules for memories
 * based on age, importance, memory type, or access patterns.
 *
 * archival_policies table: define per-workspace/namespace/archive-tier rules.
 * archival_history table: immutable log of every memory that was archived/restored.
 */

import type { Sql } from "postgres";

export type ArchiveTier = "cold" | "frozen" | "deleted";
export type ArchiveTrigger = "age" | "importance_threshold" | "access_threshold" | "namespace_quota" | "manual";

export interface ArchivalPolicy {
  id: string;
  workspace_id: string;
  namespace: string | null; // null = all namespaces
  memory_type: string | null; // null = all types
  archive_tier: ArchiveTier;
  trigger: ArchiveTrigger;
  /** For trigger=age: archive memories older than this (seconds) */
  age_threshold_seconds: number | null;
  /** For trigger=importance_threshold: archive below this importance (0-1) */
  importance_floor: number | null;
  /** For trigger=access_threshold: archive if accessed fewer than N times */
  access_count_floor: number | null;
  /** For trigger=namespace_quota: max memories per namespace before archiving oldest */
  namespace_quota: number | null;
  enabled: boolean;
  retain_forever: boolean; // If true, archival is metadata-only (never delete)
  created_at: Date;
  updated_at: Date;
}

export interface CreatePolicyInput {
  workspaceId: string;
  namespace?: string | null;
  memoryType?: string | null;
  archiveTier: ArchiveTier;
  trigger: ArchiveTrigger;
  ageThresholdSeconds?: number | null;
  importanceFloor?: number | null;
  accessCountFloor?: number | null;
  namespaceQuota?: number | null;
  enabled?: boolean;
  retainForever?: boolean;
}

export interface ArchivalHistoryEntry {
  id: string;
  memory_id: string;
  archive_tier: ArchiveTier;
  archived_by: string; // policy_id or 'manual'
  workspace_id: string;
  content_preview: string;
  importance: number;
  memory_type: string;
  archived_at: Date;
}

export interface ExecuteArchivalResult {
  archived: number;
  tier_changed: number;
  errors: string[];
}

// ---- CRUD ------------------------------------------------------------------

/**
 * Create an archival policy.
 */
export async function createArchivalPolicy(
  sql: Sql,
  input: CreatePolicyInput,
): Promise<ArchivalPolicy> {
  const [row] = await sql<any[]>`
    INSERT INTO memory.archival_policies (
      workspace_id, namespace, memory_type, archive_tier, trigger,
      age_threshold_seconds, importance_floor, access_count_floor,
      namespace_quota, enabled, retain_forever
    )
    VALUES (
      ${input.workspaceId},
      ${input.namespace ?? null},
      ${input.memoryType ?? null},
      ${input.archiveTier},
      ${input.trigger},
      ${input.ageThresholdSeconds ?? null},
      ${input.importanceFloor ?? null},
      ${input.accessCountFloor ?? null},
      ${input.namespaceQuota ?? null},
      ${input.enabled ?? true},
      ${input.retainForever ?? false}
    )
    RETURNING *
  `;
  return formatPolicy(row);
}

/**
 * List archival policies for a workspace.
 */
export async function listArchivalPolicies(
  sql: Sql,
  workspaceId: string,
  opts?: { enabled?: boolean; namespace?: string },
): Promise<ArchivalPolicy[]> {
  let rows: any[];
  if (opts?.namespace) {
    rows = await sql<any[]>`
      SELECT * FROM memory.archival_policies
      WHERE workspace_id = ${workspaceId}
        AND (namespace = ${opts.namespace} OR namespace IS NULL)
        ${opts.enabled !== undefined ? sql`AND enabled = ${opts.enabled}` : sql``}
      ORDER BY created_at ASC
    `;
  } else {
    rows = await sql<any[]>`
      SELECT * FROM memory.archival_policies
      WHERE workspace_id = ${workspaceId}
        ${opts?.enabled !== undefined ? sql`AND enabled = ${opts.enabled}` : sql``}
      ORDER BY created_at ASC
    `;
  }
  return rows.map(formatPolicy);
}

/**
 * Update an archival policy.
 */
export async function updateArchivalPolicy(
  sql: Sql,
  id: string,
  updates: Partial<CreatePolicyInput>,
): Promise<ArchivalPolicy | null> {
  const sets: string[] = ["updated_at = NOW()"];
  const vals: any[] = [];
  let idx = 1;

  if (updates.namespace !== undefined) { sets.push(`namespace = $${idx++}`); vals.push(updates.namespace ?? null); }
  if (updates.memoryType !== undefined) { sets.push(`memory_type = $${idx++}`); vals.push(updates.memoryType ?? null); }
  if (updates.archiveTier !== undefined) { sets.push(`archive_tier = $${idx++}`); vals.push(updates.archiveTier); }
  if (updates.trigger !== undefined) { sets.push(`trigger = $${idx++}`); vals.push(updates.trigger); }
  if (updates.ageThresholdSeconds !== undefined) { sets.push(`age_threshold_seconds = $${idx++}`); vals.push(updates.ageThresholdSeconds); }
  if (updates.importanceFloor !== undefined) { sets.push(`importance_floor = $${idx++}`); vals.push(updates.importanceFloor); }
  if (updates.accessCountFloor !== undefined) { sets.push(`access_count_floor = $${idx++}`); vals.push(updates.accessCountFloor); }
  if (updates.namespaceQuota !== undefined) { sets.push(`namespace_quota = $${idx++}`); vals.push(updates.namespaceQuota); }
  if (updates.enabled !== undefined) { sets.push(`enabled = $${idx++}`); vals.push(updates.enabled); }
  if (updates.retainForever !== undefined) { sets.push(`retain_forever = $${idx++}`); vals.push(updates.retainForever); }

  if (sets.length === 1) return null;

  vals.push(id);
  const [row] = await sql.unsafe(
    `UPDATE memory.archival_policies SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    vals,
  ) as any[];
  return row ? formatPolicy(row) : null;
}

/**
 * Delete an archival policy.
 */
export async function deleteArchivalPolicy(
  sql: Sql,
  id: string,
): Promise<boolean> {
  const r = await sql`DELETE FROM memory.archival_policies WHERE id = ${id}`;
  return r.count > 0;
}

// ---- Execution -------------------------------------------------------------

/**
 * Execute archival policies for a workspace.
 * Archives memories matching each enabled policy's criteria.
 * Returns counts of archived memories.
 */
export async function executeArchivalPolicies(
  sql: Sql,
  workspaceId: string,
): Promise<ExecuteArchivalResult> {
  const result: ExecuteArchivalResult = { archived: 0, tier_changed: 0, errors: [] };

  const policies = await listArchivalPolicies(sql, workspaceId, { enabled: true });

  for (const policy of policies) {
    try {
      const affected = await executePolicy(sql, policy);
      result.archived += affected;
    } catch (err: any) {
      result.errors.push(`Policy ${policy.id}: ${err.message}`);
    }
  }

  return result;
}

async function executePolicy(sql: Sql, policy: ArchivalPolicy): Promise<number> {
  let archived = 0;
  const baseQuery = `
    UPDATE memory.memories
    SET expires_at = NOW()
    WHERE workspace_id = $1
      AND (expires_at IS NULL OR expires_at > NOW())
      ${policy.memory_type ? `AND memory_type = $2` : `AND TRUE`}
      ${policy.retain_forever ? `AND FALSE` : `AND TRUE`}
  `;

  switch (policy.trigger) {
    case "age": {
      if (!policy.age_threshold_seconds) break;
      const cutoff = new Date(Date.now() - policy.age_threshold_seconds * 1000);
      if (policy.namespace) {
        const res = await sql.unsafe(`
          UPDATE memory.memories m
          SET expires_at = NOW()
          FROM memory.collections c
          WHERE m.collection_id = c.id
            AND c.workspace_id = $1
            AND c.namespace = $3
            AND m.created_at < $4
            AND (m.expires_at IS NULL OR m.expires_at > NOW())
            AND m.is_pinned = false
          RETURNING m.id
        `, [policy.workspace_id, policy.memory_type ?? "", policy.namespace, cutoff]) as any;
        archived = res.length;
      } else {
        const res = await sql.unsafe(`
          UPDATE memory.memories
          SET expires_at = NOW()
          WHERE workspace_id = $1
            AND created_at < $2
            AND (expires_at IS NULL OR expires_at > NOW())
            AND is_pinned = false
          RETURNING id
        `, [policy.workspace_id, cutoff]) as any;
        archived = res.length;
      }
      break;
    }
    case "importance_threshold": {
      if (policy.importance_floor === null) break;
      const res = await sql.unsafe(`
        UPDATE memory.memories
        SET expires_at = NOW()
        WHERE workspace_id = $1
          AND importance < $2
          AND (expires_at IS NULL OR expires_at > NOW())
          AND is_pinned = false
        RETURNING id
      `, [policy.workspace_id, policy.importance_floor]) as any;
      archived = res.length;
      break;
    }
    case "namespace_quota": {
      if (!policy.namespace || !policy.namespace_quota) break;
      const res = await sql.unsafe(`
        UPDATE memory.memories m
        SET expires_at = NOW()
        FROM memory.collections c
        WHERE m.collection_id = c.id
          AND c.workspace_id = $1
          AND c.namespace = $2
          AND (m.expires_at IS NULL OR m.expires_at > NOW())
          AND m.is_pinned = false
          AND m.id NOT IN (
            SELECT id FROM memory.memories
            WHERE workspace_id = $1
              AND collection_id = m.collection_id
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY priority DESC, created_at DESC
            LIMIT $3
          )
        RETURNING m.id
      `, [policy.workspace_id, policy.namespace, policy.namespace_quota]) as any;
      archived = res.length;
      break;
    }
  }

  // Record archival history
  if (archived > 0) {
    await sql`
      INSERT INTO memory.archival_history (memory_id, archive_tier, archived_by, workspace_id)
      SELECT id, ${policy.archive_tier}, ${policy.id}, ${policy.workspace_id}
      FROM memory.memories
      WHERE workspace_id = ${policy.workspace_id}
        AND expires_at IS NOT NULL
        AND expires_at = NOW()
    `;
  }

  return archived;
}

/**
 * List archival history for a workspace.
 */
export async function listArchivalHistory(
  sql: Sql,
  workspaceId: string,
  opts?: {
    memoryId?: string;
    archiveTier?: ArchiveTier;
    since?: Date;
    limit?: number;
  },
): Promise<ArchivalHistoryEntry[]> {
  const limit = opts?.limit ?? 100;
  const sinceFilter = opts?.since ? sql`AND archived_at >= ${opts.since}` : sql``;
  const tierFilter = opts?.archiveTier ? sql`AND archive_tier = ${opts.archiveTier}` : sql``;
  const memFilter = opts?.memoryId ? sql`AND memory_id = ${opts.memoryId}` : sql``;

  return sql<ArchivalHistoryEntry[]>`
    SELECT * FROM memory.archival_history
    WHERE workspace_id = ${workspaceId}
      ${tierFilter} ${memFilter} ${sinceFilter}
    ORDER BY archived_at DESC
    LIMIT ${limit}
  `;
}

// ---- Helpers ---------------------------------------------------------------

function formatPolicy(row: any): ArchivalPolicy {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    namespace: row.namespace,
    memory_type: row.memory_type,
    archive_tier: row.archive_tier as ArchiveTier,
    trigger: row.trigger as ArchiveTrigger,
    age_threshold_seconds: row.age_threshold_seconds,
    importance_floor: row.importance_floor,
    access_count_floor: row.access_count_floor,
    namespace_quota: row.namespace_quota,
    enabled: row.enabled,
    retain_forever: row.retain_forever,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
