/**
 * Session retention policies — automatically archive or delete sessions
 * based on importance scores, age, and access patterns.
 *
 * Policies are per-workspace and define:
 *   - Age thresholds (e.g., archive sessions older than 90 days)
 *   - Importance floor (e.g., never archive sessions with importance > 0.7)
 *   - Access thresholds (e.g., archive if accessed fewer than 3 times in 30 days)
 *   - Special handling for root vs fork sessions
 */

import type { Sql } from "postgres";

export type RetentionAction = "archive" | "soft_delete" | "hard_delete" | "summarize";
export type RetentionTrigger = "age" | "importance_floor" | "access_count" | "manual";

export interface RetentionPolicy {
  id: string;
  workspaceId: string;
  name: string;
  trigger: RetentionTrigger;
  action: RetentionAction;
  ageThresholdDays: number | null;
  importanceFloor: number | null; // 0–1; sessions below are affected
  accessCountFloor: number | null; // min accesses in the lookback period
  accessLookbackDays: number | null;
  applyToForks: boolean;
  applyToRoot: boolean;
  retainPinned: boolean;
  enabled: boolean;
  dryRun: boolean; // if true, records what would happen without executing
  createdAt: Date;
  updatedAt: Date;
}

export interface RetentionPolicyResult {
  policyId: string;
  action: RetentionAction;
  archived: number;
  deleted: number;
  preserved: number; // pinned or above importance floor
  dryRun: boolean;
  evaluatedAt: Date;
}

export interface RetentionHistoryEntry {
  id: string;
  policyId: string;
  conversationId: string;
  action: RetentionAction;
  importanceScore: number | null;
  accessCount: number | null;
  ageDays: number | null;
  reason: string;
  executedAt: Date;
}

/**
 * Create a retention policy for a workspace.
 */
export async function createRetentionPolicy(
  sql: Sql,
  opts: {
    workspaceId: string;
    name: string;
    trigger: RetentionTrigger;
    action: RetentionAction;
    ageThresholdDays?: number;
    importanceFloor?: number;
    accessCountFloor?: number;
    accessLookbackDays?: number;
    applyToForks?: boolean;
    applyToRoot?: boolean;
    retainPinned?: boolean;
    dryRun?: boolean;
  },
): Promise<RetentionPolicy> {
  const [row] = await sql<RetentionPolicy[]>`
    INSERT INTO sessions.retention_policies (
      workspace_id, name, trigger, action,
      age_threshold_days, importance_floor, access_count_floor, access_lookback_days,
      apply_to_forks, apply_to_root, retain_pinned, enabled, dry_run
    )
    VALUES (
      ${opts.workspaceId},
      ${opts.name},
      ${opts.trigger},
      ${opts.action},
      ${opts.ageThresholdDays ?? null},
      ${opts.importanceFloor ?? null},
      ${opts.accessCountFloor ?? null},
      ${opts.accessLookbackDays ?? null},
      ${opts.applyToForks ?? true},
      ${opts.applyToRoot ?? true},
      ${opts.retainPinned ?? true},
      true,
      ${opts.dryRun ?? false}
    )
    RETURNING *
  `;
  return row;
}

/**
 * List retention policy rules for a workspace.
 */
export async function listRetentionPolicyRules(
  sql: Sql,
  workspaceId: string,
  opts: { enabled?: boolean; trigger?: string; action?: string; userId?: string; limit?: number; offset?: number } = {},
): Promise<RetentionPolicy[]> {
  let results: RetentionPolicy[];

  if (opts.userId && opts.enabled !== undefined) {
    results = await sql<RetentionPolicy[]>`
      SELECT * FROM sessions.retention_policies
      WHERE workspace_id = ${workspaceId} AND user_id = ${opts.userId} AND enabled = ${opts.enabled}
      ORDER BY created_at
    `;
  } else if (opts.userId) {
    results = await sql<RetentionPolicy[]>`
      SELECT * FROM sessions.retention_policies
      WHERE workspace_id = ${workspaceId} AND user_id = ${opts.userId}
      ORDER BY created_at
    `;
  } else if (opts.enabled !== undefined) {
    results = await sql<RetentionPolicy[]>`
      SELECT * FROM sessions.retention_policies
      WHERE workspace_id = ${workspaceId} AND enabled = ${opts.enabled}
      ORDER BY created_at
    `;
  } else {
    results = await sql<RetentionPolicy[]>`
      SELECT * FROM sessions.retention_policies
      WHERE workspace_id = ${workspaceId}
      ORDER BY created_at
    `;
  }

  return results.slice(opts.offset ?? 0, opts.limit ? (opts.offset ?? 0) + opts.limit : undefined);
}

/**
 * Execute a single retention policy and return the result.
 */
export async function executeRetentionPolicy(
  sql: Sql,
  policyId: string,
): Promise<RetentionPolicyResult> {
  const [policy] = await sql<RetentionPolicy[]>`
    SELECT * FROM sessions.retention_policies WHERE id = ${policyId}
  `;
  if (!policy || !policy.enabled) {
    return {
      policyId,
      action: policy?.action ?? "archive",
      archived: 0,
      deleted: 0,
      preserved: 0,
      dryRun: false,
      evaluatedAt: new Date(),
    };
  }

  let query = sql<[{ id: string; importance_score: number | null }]>`
    SELECT c.id, c.importance_score FROM sessions.conversations c
    WHERE c.workspace_id = ${policy.workspace_id}
  `;

  const conversations = await query;

  let archived = 0;
  let deleted = 0;
  let preserved = 0;

  for (const conv of conversations) {
    // Check if pinned
    if (policy.retain_pinned && conv.importance_score !== null && conv.importance_score > 0.8) {
      preserved++;
      continue;
    }

    // Check importance floor
    if (
      policy.importance_floor !== null &&
      conv.importance_score !== null &&
      conv.importance_score >= policy.importance_floor
    ) {
      preserved++;
      continue;
    }

    // Check age
    if (policy.trigger === "age" && policy.age_threshold_days !== null) {
      const [{ created_at }] = await sql<[{ created_at: Date }]>`
        SELECT created_at FROM sessions.conversations WHERE id = ${conv.id}
      `;
      const ageDays = (Date.now() - new Date(created_at).getTime()) / 86_400_000;
      if (ageDays < policy.age_threshold_days) {
        preserved++;
        continue;
      }
    }

    // Check access count
    if (policy.trigger === "access_count" && policy.access_count_floor !== null) {
      const lookback = policy.access_lookback_days ?? 30;
      const [{ access_count }] = await sql<[{ access_count: number }]>`
        SELECT COUNT(*) as access_count FROM sessions.memory_access
        WHERE conversation_id = ${conv.id}
          AND accessed_at > NOW() - INTERVAL '${sql.unsafe(String(lookback))} days'
      `;
      if (access_count >= policy.access_count_floor) {
        preserved++;
        continue;
      }
    }

    if (policy.dry_run) {
      preserved++;
      continue;
    }

    // Execute action
    if (policy.action === "archive") {
      await sql`UPDATE sessions.conversations SET is_archived = true WHERE id = ${conv.id}`;
      archived++;
    } else if (policy.action === "soft_delete") {
      await sql`UPDATE sessions.conversations SET deleted_at = NOW() WHERE id = ${conv.id}`;
      archived++;
    } else if (policy.action === "hard_delete") {
      await sql`DELETE FROM sessions.conversations WHERE id = ${conv.id}`;
      deleted++;
    }

    // Record history
    await sql`
      INSERT INTO sessions.retention_history (
        policy_id, conversation_id, action, importance_score, reason
      )
      VALUES (
        ${policyId},
        ${conv.id},
        ${policy.action},
        ${conv.importance_score},
        ${`trigger=${policy.trigger}`}
      )
    `;
  }

  return {
    policyId,
    action: policy.action,
    archived,
    deleted,
    preserved,
    dryRun: policy.dry_run,
    evaluatedAt: new Date(),
  };
}

/**
 * Execute all enabled retention policies for a workspace.
 */
export async function executeAllRetentionPolicies(
  sql: Sql,
  workspaceId: string,
): Promise<RetentionPolicyResult[]> {
  const policies = await listRetentionPolicies(sql, workspaceId, { enabled: true });
  const results: RetentionPolicyResult[] = [];
  for (const policy of policies) {
    const result = await executeRetentionPolicy(sql, policy.id);
    results.push(result);
  }
  return results;
}

/**
 * Get retention history for a workspace.
 */
export async function getRetentionHistory(
  sql: Sql,
  workspaceId: string,
  opts: { limit?: number; since?: Date } = {},
): Promise<RetentionHistoryEntry[]> {
  return sql<RetentionHistoryEntry[]>`
    SELECT rh.* FROM sessions.retention_history rh
    JOIN sessions.retention_policies rp ON rp.id = rh.policy_id
    WHERE rp.workspace_id = ${workspaceId}
      AND (${opts.since} IS NULL OR rh.executed_at > ${opts.since})
    ORDER BY rh.executed_at DESC
    LIMIT ${opts.limit ?? 100}
  `;
}
