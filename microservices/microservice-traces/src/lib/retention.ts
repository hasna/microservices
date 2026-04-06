/**
 * Trace retention policies — TTL-based and count-based auto-pruning.
 * Keeps trace storage lean by automatically removing old data.
 */

import type { Sql } from "postgres";

export type RetentionType = "ttl_days" | "max_count";

export interface RetentionPolicy {
  id: string;
  workspace_id: string | null;
  name: string;
  type: RetentionType;
  days?: number;
  max_count?: number;
  enabled: boolean;
  created_at: Date;
}

/**
 * Upsert a retention policy.
 */
export async function upsertRetentionPolicy(
  sql: Sql,
  opts: {
    id?: string;
    workspace_id?: string;
    name: string;
    type: RetentionType;
    days?: number;
    max_count?: number;
    enabled?: boolean;
  },
): Promise<RetentionPolicy> {
  const {
    id,
    workspace_id = null,
    name,
    type,
    days,
    max_count,
    enabled = true,
  } = opts;

  const [row] = await sql<any[]>`
    INSERT INTO traces.trace_retention_policies
      (id, workspace_id, name, type, days, max_count, enabled)
    VALUES (${id ?? null}, ${workspace_id}, ${name}, ${type}, ${days ?? null}, ${max_count ?? null}, ${enabled})
    ON CONFLICT (id) DO UPDATE SET
      name      = EXCLUDED.name,
      type      = EXCLUDED.type,
      days      = EXCLUDED.days,
      max_count = EXCLUDED.max_count,
      enabled   = EXCLUDED.enabled
    RETURNING *
  `;

  return row as RetentionPolicy;
}

/**
 * List retention policies for a workspace.
 */
export async function listRetentionPolicies(
  sql: Sql,
  workspaceId?: string,
): Promise<RetentionPolicy[]> {
  if (workspaceId) {
    return sql<any[]>`
      SELECT * FROM traces.trace_retention_policies
      WHERE workspace_id = ${workspaceId} OR workspace_id IS NULL
      ORDER BY created_at ASC
    `;
  }
  return sql<any[]>`
    SELECT * FROM traces.trace_retention_policies
    ORDER BY created_at ASC
  `;
}

/**
 * Delete a retention policy.
 */
export async function deleteRetentionPolicy(sql: Sql, id: string): Promise<boolean> {
  const [{ count }] = await sql<{ count: string }[]>`
    DELETE FROM traces.trace_retention_policies WHERE id = ${id}
    RETURNING count(*) as count
  `;
  return parseInt(count) > 0;
}

/**
 * Prune traces older than the TTL for a workspace.
 * Returns the number of traces deleted.
 */
export async function pruneByTTL(
  sql: Sql,
  workspaceId: string,
  days: number,
): Promise<number> {
  const [{ count }] = await sql<{ count: string }[]>`
    WITH deleted AS (
      DELETE FROM traces.traces
      WHERE workspace_id = ${workspaceId}
        AND started_at < NOW() - INTERVAL '${String(days)} days'
      RETURNING id
    )
    SELECT COUNT(*) as count FROM deleted
  `;
  return parseInt(count);
}

/**
 * Prune oldest traces to keep under max_count for a workspace.
 * Returns the number of traces deleted.
 */
export async function pruneByCount(
  sql: Sql,
  workspaceId: string,
  maxCount: number,
): Promise<number> {
  const [{ count }] = await sql<{ count: string }[]>`
    WITH excess AS (
      SELECT id FROM traces.traces
      WHERE workspace_id = ${workspaceId}
      ORDER BY started_at ASC
      OFFSET ${maxCount}
    ),
    deleted AS (
      DELETE FROM traces.traces WHERE id IN (SELECT id FROM excess)
      RETURNING id
    )
    SELECT COUNT(*) as count FROM deleted
  `;
  return parseInt(count);
}

/**
 * Run all active retention policies for a workspace.
 * Returns breakdown of what was pruned.
 */
export async function runRetentionPolicies(
  sql: Sql,
  workspaceId: string,
): Promise<{
  ttl_deleted: number;
  count_deleted: number;
  policies_run: number;
}> {
  const policies = await listRetentionPolicies(sql, workspaceId);
  const active = policies.filter((p) => p.enabled);

  let ttlDeleted = 0;
  let countDeleted = 0;

  for (const policy of active) {
    if (policy.type === "ttl_days" && policy.days != null) {
      ttlDeleted += await pruneByTTL(sql, workspaceId, policy.days);
    } else if (policy.type === "max_count" && policy.max_count != null) {
      countDeleted += await pruneByCount(sql, workspaceId, policy.max_count);
    }
  }

  return {
    ttl_deleted: ttlDeleted,
    count_deleted: countDeleted,
    policies_run: active.length,
  };
}

/**
 * Get retention statistics for a workspace.
 */
export async function getRetentionStats(
  sql: Sql,
  workspaceId: string,
): Promise<{
  total_traces: number;
  oldest_trace: Date | null;
  newest_trace: Date | null;
  storage_bytes_estimate: number;
}> {
  const [row] = await sql<any[]>`
    SELECT
      COUNT(*)                                              AS total_traces,
      MIN(started_at)                                       AS oldest_trace,
      MAX(started_at)                                       AS newest_trace,
      (COUNT(*) * 5000)                                     AS storage_bytes_estimate
    FROM traces.traces
    WHERE workspace_id = ${workspaceId}
  `;
  return {
    total_traces: parseInt(row?.total_traces ?? "0"),
    oldest_trace: row?.oldest_trace ?? null,
    newest_trace: row?.newest_trace ?? null,
    storage_bytes_estimate: parseInt(row?.storage_bytes_estimate ?? "0"),
  };
}