/**
 * Retention policy management for audit events.
 */

import type { Sql } from "postgres";

export interface RetentionPolicy {
  id: string;
  workspace_id: string;
  retain_days: number;
  created_at: Date;
  updated_at: Date;
}

export async function getRetentionPolicy(
  sql: Sql,
  workspaceId: string,
): Promise<RetentionPolicy | null> {
  const [policy] = await sql<RetentionPolicy[]>`
    SELECT * FROM audit.retention_policies WHERE workspace_id = ${workspaceId}
  `;
  return policy ?? null;
}

export async function setRetentionPolicy(
  sql: Sql,
  workspaceId: string,
  retainDays: number,
): Promise<RetentionPolicy> {
  const [policy] = await sql<RetentionPolicy[]>`
    INSERT INTO audit.retention_policies (workspace_id, retain_days)
    VALUES (${workspaceId}, ${retainDays})
    ON CONFLICT (workspace_id)
    DO UPDATE SET retain_days = ${retainDays}, updated_at = NOW()
    RETURNING *
  `;
  return policy;
}

/**
 * Delete events older than retain_days for the given workspace.
 * Returns the number of events deleted.
 */
export async function applyRetention(
  sql: Sql,
  workspaceId: string,
): Promise<number> {
  const policy = await getRetentionPolicy(sql, workspaceId);
  if (!policy) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - policy.retain_days);

  const result = await sql`
    DELETE FROM audit.events
    WHERE workspace_id = ${workspaceId}
      AND created_at < ${cutoff.toISOString()}
  `;
  return result.count;
}
