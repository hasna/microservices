/**
 * Session retention policies — TTL-based automatic archiving and deletion.
 */

import type { Sql } from "postgres";

export type RetentionAction = "archive" | "delete" | "snapshot_then_delete";
export type RetentionScope = "workspace" | "user" | "global";

export interface RetentionPolicy {
  id: string;
  workspace_id: string | null;
  user_id: string | null;
  scope: RetentionScope;
  name: string;
  enabled: boolean;
  retention_days: number;
  action: RetentionAction;
  min_session_messages: number | null;
  max_session_messages: number | null;
  exclude_pinned: boolean;
  exclude_archived: boolean;
  created_at: Date;
  updated_at: Date;
  last_run_at: Date | null;
}

export interface UpsertRetentionPolicyInput {
  workspaceId?: string | null;
  userId?: string | null;
  scope?: RetentionScope;
  name: string;
  retentionDays: number;
  action?: RetentionAction;
  minSessionMessages?: number | null;
  maxSessionMessages?: number | null;
  excludePinned?: boolean;
  excludeArchived?: boolean;
}

/**
 * Create or update a retention policy.
 */
export async function upsertRetentionPolicy(
  sql: Sql,
  input: UpsertRetentionPolicyInput & { enabled?: boolean },
): Promise<RetentionPolicy> {
  const scope = input.scope ?? (input.workspaceId ? "workspace" : input.userId ? "user" : "global");
  const [policy] = await sql<RetentionPolicy[]>`
    INSERT INTO sessions.retention_policies (
      workspace_id, user_id, scope, name,
      retention_days, action,
      min_session_messages, max_session_messages,
      exclude_pinned, exclude_archived
    )
    VALUES (
      ${input.workspaceId ?? null},
      ${input.userId ?? null},
      ${scope},
      ${input.name},
      ${input.retentionDays},
      ${input.action ?? "archive"},
      ${input.minSessionMessages ?? null},
      ${input.maxSessionMessages ?? null},
      ${input.excludePinned ?? true},
      ${input.excludeArchived ?? true}
    )
    ON CONFLICT (workspace_id, user_id, name) DO UPDATE SET
      retention_days = EXCLUDED.retention_days,
      action = EXCLUDED.action,
      min_session_messages = EXCLUDED.min_session_messages,
      max_session_messages = EXCLUDED.max_session_messages,
      exclude_pinned = EXCLUDED.exclude_pinned,
      exclude_archived = EXCLUDED.exclude_archived,
      updated_at = NOW()
    RETURNING *
  `;
  return policy;
}

/**
 * Enable or disable a retention policy.
 */
export async function setRetentionPolicyEnabled(
  sql: Sql,
  policyId: string,
  enabled: boolean,
): Promise<void> {
  await sql`
    UPDATE sessions.retention_policies
    SET enabled = ${enabled}, updated_at = NOW()
    WHERE id = ${policyId}
  `;
}

/**
 * Get a retention policy by ID.
 */
export async function getRetentionPolicy(
  sql: Sql,
  policyId: string,
): Promise<RetentionPolicy | null> {
  const [policy] = await sql<RetentionPolicy[]>`
    SELECT * FROM sessions.retention_policies WHERE id = ${policyId}
  `;
  return policy ?? null;
}

/**
 * List retention policies for a workspace (includes global policies).
 */
export async function listRetentionPolicies(
  sql: Sql,
  workspaceId: string,
): Promise<RetentionPolicy[]> {
  return sql<RetentionPolicy[]>`
    SELECT * FROM sessions.retention_policies
    WHERE workspace_id = ${workspaceId}
       OR workspace_id IS NULL
    ORDER BY scope, name
  `;
}

/**
 * Delete a retention policy.
 */
export async function deleteRetentionPolicy(
  sql: Sql,
  policyId: string,
): Promise<boolean> {
  const result = await sql.unsafe(
    `DELETE FROM sessions.retention_policies WHERE id = $1`,
    [policyId],
  );
  return (result.count ?? 0) > 0;
}

/**
 * Apply a retention policy to all matching sessions.
 * Returns count of sessions affected.
 */
export async function applyRetentionPolicy(
  sql: Sql,
  policyId: string,
): Promise<{ archived: number; deleted: number; snapshots_created: number }> {
  const policy = await getRetentionPolicy(sql, policyId);
  if (!policy) throw new Error(`Retention policy ${policyId} not found`);
  if (!policy.enabled) throw new Error(`Retention policy ${policyId} is disabled`);

  const cutoff = new Date(Date.now() - policy.retention_days * 24 * 60 * 60 * 1000).toISOString();

  // Build WHERE clause dynamically
  const conditions: string[] = [`created_at < '${cutoff}'`];
  if (policy.exclude_pinned) conditions.push(`is_pinned = false`);
  if (policy.exclude_archived) conditions.push(`is_archived = false`);
  if (policy.workspace_id) conditions.push(`workspace_id = '${policy.workspace_id}'`);
  if (policy.user_id) conditions.push(`user_id = '${policy.user_id}'`);
  if (policy.min_session_messages !== null) conditions.push(`message_count >= ${policy.min_session_messages}`);
  if (policy.max_session_messages !== null) conditions.push(`message_count <= ${policy.max_session_messages}`);

  const where = conditions.join(" AND ");

  let archived = 0;
  let deleted = 0;
  let snapshotsCreated = 0;

  if (policy.action === "archive") {
    const result = await sql.unsafe(
      `UPDATE sessions.conversations SET is_archived = true WHERE ${where} AND is_archived = false RETURNING id`,
    );
    archived = result.count ?? 0;
  } else if (policy.action === "delete") {
    const result = await sql.unsafe(
      `DELETE FROM sessions.conversations WHERE ${where} RETURNING id`,
    );
    deleted = result.count ?? 0;
  } else if (policy.action === "snapshot_then_delete") {
    // Select sessions to snapshot
    const sessions = await sql.unsafe(
      `SELECT id FROM sessions.conversations WHERE ${where}`,
    ) as Array<{ id: string }>;

    for (const s of sessions) {
      await sql.unsafe(
        `INSERT INTO sessions.session_snapshots (session_id, label, snapshot_data, message_count, total_tokens)
         SELECT id, 'auto-retention-backup', '{}', message_count, total_tokens
         FROM sessions.conversations WHERE id = $1`,
        [s.id],
      );
      snapshotsCreated++;
    }

    const result = await sql.unsafe(
      `DELETE FROM sessions.conversations WHERE ${where} RETURNING id`,
    );
    deleted = result.count ?? 0;
  }

  // Update last_run_at
  await sql`
    UPDATE sessions.retention_policies
    SET last_run_at = NOW()
    WHERE id = ${policyId}
  `;

  return { archived, deleted, snapshots_created: snapshotsCreated };
}

/**
 * Get retention policy summary stats for a workspace.
 */
export async function getRetentionStats(
  sql: Sql,
  workspaceId: string,
): Promise<{
  total_policies: number;
  enabled_policies: number;
  sessions_at_risk: number;
  oldest_active_session: string | null;
}> {
  const [row] = await sql<{
    total: number;
    enabled: number;
    at_risk: number;
    oldest: string | null;
  }[]>`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE enabled = true) as enabled,
      COUNT(*) FILTER (
        WHERE is_archived = false
          AND is_pinned = false
          AND created_at < NOW() - INTERVAL '90 days'
      ) as at_risk,
      MIN(created_at) FILTER (WHERE is_archived = false AND is_pinned = false) as oldest
    FROM sessions.conversations
    WHERE workspace_id = ${workspaceId}
  `;

  return {
    total_policies: Number(row?.total ?? 0),
    enabled_policies: Number(row?.enabled ?? 0),
    sessions_at_risk: Number(row?.at_risk ?? 0),
    oldest_active_session: row?.oldest ?? null,
  };
}
