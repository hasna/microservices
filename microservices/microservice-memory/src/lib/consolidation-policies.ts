/**
 * Consolidation policies — scheduled rules for automatic episodic memory consolidation.
 */

import type { Sql } from "postgres";
import { consolidateEpisodicMemories } from "./consolidation.js";

export type ConsolidationTrigger = "schedule" | "count_threshold" | "size_threshold" | "manual";
export type ConsolidationMode = "summary_only" | "delete_source" | "archive";

export interface ConsolidationPolicy {
  id: string;
  workspace_id: string;
  namespace: string;
  name: string;
  enabled: boolean;
  trigger: ConsolidationTrigger;
  // Schedule-based
  cron_expression: string | null;
  // Count-based
  min_episodic_count: number | null;
  // Size-based
  min_total_size_bytes: number | null;
  // Behavior
  window_hours: number;
  consolidation_mode: ConsolidationMode;
  priority_threshold: number | null;
  memory_type_filter: string | null;
  last_triggered_at: Date | null;
  next_scheduled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertConsolidationPolicyInput {
  workspaceId: string;
  namespace: string;
  name: string;
  trigger?: ConsolidationTrigger;
  cronExpression?: string | null;
  minEpisodicCount?: number | null;
  minTotalSizeBytes?: number | null;
  windowHours?: number;
  consolidationMode?: ConsolidationMode;
  priorityThreshold?: number | null;
  memoryTypeFilter?: string | null;
}

/**
 * Create or update a consolidation policy.
 */
export async function upsertConsolidationPolicy(
  sql: Sql,
  input: UpsertConsolidationPolicyInput & { enabled?: boolean },
): Promise<ConsolidationPolicy> {
  const [policy] = await sql<ConsolidationPolicy[]>`
    INSERT INTO memory.consolidation_policies (
      workspace_id, namespace, name, trigger,
      cron_expression, min_episodic_count, min_total_size_bytes,
      window_hours, consolidation_mode, priority_threshold, memory_type_filter
    )
    VALUES (
      ${input.workspaceId}, ${input.namespace}, ${input.name},
      ${input.trigger ?? "schedule"},
      ${input.cronExpression ?? null},
      ${input.minEpisodicCount ?? null},
      ${input.minTotalSizeBytes ?? null},
      ${input.windowHours ?? 24},
      ${input.consolidationMode ?? "summary_only"},
      ${input.priorityThreshold ?? null},
      ${input.memoryTypeFilter ?? null}
    )
    ON CONFLICT (workspace_id, namespace, name) DO UPDATE SET
      trigger = EXCLUDED.trigger,
      cron_expression = EXCLUDED.cron_expression,
      min_episodic_count = EXCLUDED.min_episodic_count,
      min_total_size_bytes = EXCLUDED.min_total_size_bytes,
      window_hours = EXCLUDED.window_hours,
      consolidation_mode = EXCLUDED.consolidation_mode,
      priority_threshold = EXCLUDED.priority_threshold,
      memory_type_filter = EXCLUDED.memory_type_filter,
      updated_at = NOW()
    RETURNING *
  `;
  return policy;
}

/**
 * Enable or disable a consolidation policy.
 */
export async function setConsolidationPolicyEnabled(
  sql: Sql,
  policyId: string,
  enabled: boolean,
): Promise<void> {
  await sql`
    UPDATE memory.consolidation_policies
    SET enabled = ${enabled}, updated_at = NOW()
    WHERE id = ${policyId}
  `;
}

/**
 * Get a consolidation policy by ID.
 */
export async function getConsolidationPolicy(
  sql: Sql,
  policyId: string,
): Promise<ConsolidationPolicy | null> {
  const [policy] = await sql<ConsolidationPolicy[]>`
    SELECT * FROM memory.consolidation_policies WHERE id = ${policyId}
  `;
  return policy ?? null;
}

/**
 * List all consolidation policies for a workspace.
 */
export async function listConsolidationPolicies(
  sql: Sql,
  workspaceId: string,
): Promise<ConsolidationPolicy[]> {
  return sql<ConsolidationPolicy[]>`
    SELECT * FROM memory.consolidation_policies
    WHERE workspace_id = ${workspaceId}
    ORDER BY namespace, name
  `;
}

/**
 * List enabled consolidation policies that are due to run.
 */
export async function getDueConsolidationPolicies(
  sql: Sql,
  workspaceId: string,
): Promise<ConsolidationPolicy[]> {
  return sql<ConsolidationPolicy[]>`
    SELECT * FROM memory.consolidation_policies
    WHERE workspace_id = ${workspaceId}
      AND enabled = true
      AND (
        (trigger = 'schedule' AND (next_scheduled_at IS NULL OR next_scheduled_at <= NOW()))
        OR trigger = 'manual'
      )
    ORDER BY namespace, name
  `;
}

/**
 * Delete a consolidation policy.
 */
export async function deleteConsolidationPolicy(
  sql: Sql,
  policyId: string,
): Promise<boolean> {
  const result = await sql.unsafe(
    `DELETE FROM memory.consolidation_policies WHERE id = $1`,
    [policyId],
  );
  return (result.count ?? 0) > 0;
}

/**
 * Run a consolidation policy — fetch episodic memories and consolidate them.
 */
export async function runConsolidationPolicy(
  sql: Sql,
  policyId: string,
): Promise<{ consolidated_count: number; summary_memory_id: string; policy: ConsolidationPolicy }> {
  const policy = await getConsolidationPolicy(sql, policyId);
  if (!policy) throw new Error(`Policy ${policyId} not found`);
  if (!policy.enabled) throw new Error(`Policy ${policyId} is disabled`);

  // Collect episodic memories matching the policy filters
  let query = sql<{ id: string; content: string; created_at: Date; importance: number }[]>`
    SELECT id, content, created_at, importance
    FROM memory.memories m
    JOIN memory.collections c ON c.id = m.collection_id
    WHERE m.workspace_id = ${policy.workspace_id}
      AND c.namespace = ${policy.namespace}
      AND m.memory_type = 'episodic'
      AND m.created_at >= NOW() - INTERVAL '1 hour' * ${policy.window_hours}
  `;

  if (policy.priority_threshold !== null) {
    // We filter in JS since dynamic interval + param is tricky
  }

  const rows = await sql<{ id: string; content: string; created_at: Date; importance: number }[]>`
    SELECT id, content, created_at, importance
    FROM memory.memories m
    JOIN memory.collections c ON c.id = m.collection_id
    WHERE m.workspace_id = ${policy.workspace_id}
      AND c.namespace = ${policy.namespace}
      AND m.memory_type = 'episodic'
      AND m.created_at >= NOW() - INTERVAL '1 hour' * ${policy.window_hours}
      ${policy.priority_threshold !== null ? sql`AND m.priority >= ${policy.priority_threshold}` : sql``}
  `;

  if (rows.length === 0) {
    return {
      consolidated_count: 0,
      summary_memory_id: "",
      policy,
    };
  }

  const deleteOld = policy.consolidation_mode === "delete_source";
  const result = await consolidateEpisodicMemories(
    sql,
    policy.workspace_id,
    policy.window_hours,
    deleteOld,
  );

  // Update last_triggered_at
  await sql`
    UPDATE memory.consolidation_policies
    SET last_triggered_at = NOW(),
        next_scheduled_at = CASE
          WHEN trigger = 'schedule' AND cron_expression IS NOT NULL
          THEN NOW() + INTERVAL '1 hour' * ${policy.window_hours}
          ELSE next_scheduled_at
        END
    WHERE id = ${policyId}
  `;

  return {
    consolidated_count: result.consolidated_count,
    summary_memory_id: result.summary_memory_id,
    policy: { ...policy, last_triggered_at: new Date() },
  };
}

/**
 * Get a summary of all consolidation policy statuses for a workspace.
 */
export async function getConsolidationPolicyStats(
  sql: Sql,
  workspaceId: string,
): Promise<{
  total: number;
  enabled: number;
  disabled: number;
  last_run: Date | null;
}> {
  const rows = await sql<{ total: number; enabled: number; last_run: Date | null }[]>`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE enabled = true) as enabled,
      COUNT(*) FILTER (WHERE enabled = false) as disabled,
      MAX(last_triggered_at) as last_run
    FROM memory.consolidation_policies
    WHERE workspace_id = ${workspaceId}
  `;
  const row = rows[0];
  return {
    total: Number(row?.total ?? 0),
    enabled: Number(row?.enabled ?? 0),
    disabled: Number(row?.disabled ?? 0),
    last_run: row?.last_run ?? null,
  };
}
