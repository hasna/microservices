/**
 * Channel failover rules — automatic fallback to a secondary channel
 * when the primary channel delivery fails or is unavailable.
 */

import type { Sql } from "postgres";

export type FailoverTrigger = "delivery_failure" | "channel_disabled" | "rate_limit" | "user_preference_off";

export interface ChannelFailoverRule {
  id: string;
  workspace_id: string | null;   // null = global rule
  user_id: string | null;        // null = workspace rule
  primary_channel: string;
  failover_channel: string;
  trigger: FailoverTrigger;
  max_retries: number;
  retry_delay_seconds: number;
  enabled: boolean;
  created_at: string;
}

/**
 * Create a failover rule for a channel.
 */
export async function createFailoverRule(
  sql: Sql,
  data: {
    workspaceId?: string;
    userId?: string;
    primaryChannel: string;
    failoverChannel: string;
    trigger?: FailoverTrigger;
    maxRetries?: number;
    retryDelaySeconds?: number;
  },
): Promise<ChannelFailoverRule> {
  const [row] = await sql<ChannelFailoverRule[]>`
    INSERT INTO notify.channel_failover_rules
      (workspace_id, user_id, primary_channel, failover_channel, trigger,
       max_retries, retry_delay_seconds)
    VALUES (
      ${data.workspaceId ?? null},
      ${data.userId ?? null},
      ${data.primaryChannel},
      ${data.failoverChannel},
      ${data.trigger ?? "delivery_failure"},
      ${data.maxRetries ?? 3},
      ${data.retryDelaySeconds ?? 60}
    )
    RETURNING *
  `;
  return row;
}

/**
 * Get the failover rule for a primary channel (user > workspace > global).
 */
export async function getFailoverRule(
  sql: Sql,
  primaryChannel: string,
  userId?: string,
  workspaceId?: string,
): Promise<ChannelFailoverRule | null> {
  // User-level first
  if (userId) {
    const [userRule] = await sql<ChannelFailoverRule[]>`
      SELECT * FROM notify.channel_failover_rules
      WHERE primary_channel = ${primaryChannel}
        AND user_id = ${userId}
        AND enabled = TRUE
      LIMIT 1
    `;
    if (userRule) return userRule;
  }

  // Workspace-level
  if (workspaceId) {
    const [wsRule] = await sql<ChannelFailoverRule[]>`
      SELECT * FROM notify.channel_failover_rules
      WHERE primary_channel = ${primaryChannel}
        AND workspace_id = ${workspaceId}
        AND user_id IS NULL
        AND enabled = TRUE
      LIMIT 1
    `;
    if (wsRule) return wsRule;
  }

  // Global
  const [globalRule] = await sql<ChannelFailoverRule[]>`
    SELECT * FROM notify.channel_failover_rules
    WHERE primary_channel = ${primaryChannel}
      AND workspace_id IS NULL
      AND user_id IS NULL
      AND enabled = TRUE
    LIMIT 1
  `;
  return globalRule ?? null;
}

/**
 * List all failover rules for a workspace.
 */
export async function listFailoverRules(
  sql: Sql,
  workspaceId?: string,
): Promise<ChannelFailoverRule[]> {
  const [rows] = await sql<ChannelFailoverRule[]>`
    SELECT * FROM notify.channel_failover_rules
    WHERE workspace_id ${workspaceId ? sql`= ${workspaceId}` : sql`IS NULL`}
      AND user_id IS NULL
    ORDER BY primary_channel
  `;
  return rows;
}

/**
 * Delete a failover rule.
 */
export async function deleteFailoverRule(sql: Sql, ruleId: string): Promise<boolean> {
  const [row] = await sql<[{ id: string }][]>`
    DELETE FROM notify.channel_failover_rules WHERE id = ${ruleId} RETURNING id
  `;
  return !!row;
}

/**
 * Record a failover event for analytics.
 */
export async function recordFailoverEvent(
  sql: Sql,
  data: {
    ruleId?: string;
    workspaceId?: string;
    userId?: string;
    primaryChannel: string;
    failoverChannel: string;
    trigger: FailoverTrigger;
    originalNotificationId?: string;
    failoverNotificationId?: string;
  },
): Promise<void> {
  await sql`
    INSERT INTO notify.failover_events
      (rule_id, workspace_id, user_id, primary_channel, failover_channel,
       trigger, original_notification_id, failover_notification_id)
    VALUES (
      ${data.ruleId ?? null},
      ${data.workspaceId ?? null},
      ${data.userId ?? null},
      ${data.primaryChannel},
      ${data.failoverChannel},
      ${data.trigger},
      ${data.originalNotificationId ?? null},
      ${data.failoverNotificationId ?? null}
    )
  `;
}

/**
 * Get failover event statistics for a time window.
 */
export async function getFailoverStats(
  sql: Sql,
  workspaceId?: string,
  days = 7,
): Promise<{ channel: string; total_failovers: number; success_rate: number }[]> {
  const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();
  const [rows] = await sql<any[]>`
    SELECT
      primary_channel as channel,
      COUNT(*) as total_failovers,
      COUNT(*) FILTER (WHERE failover_notification_id IS NOT NULL) as successful_failovers
    FROM notify.failover_events
    WHERE created_at > ${cutoff}
      AND (${workspaceId ? sql`workspace_id = ${workspaceId}` : sql`true`})
    GROUP BY primary_channel
  `;
  return (rows ?? []).map((r: any) => ({
    channel: r.channel,
    total_failovers: Number(r.total_failovers),
    success_rate: r.total_failovers > 0
      ? Math.round((Number(r.successful_failovers) / Number(r.total_failovers)) * 100)
      : 0,
  }));
}

/**
 * Toggle a failover rule enabled/disabled.
 */
export async function setFailoverRuleEnabled(
  sql: Sql,
  ruleId: string,
  enabled: boolean,
): Promise<boolean> {
  const [row] = await sql<[{ id: string }][]>`
    UPDATE notify.channel_failover_rules
    SET enabled = ${enabled}
    WHERE id = ${ruleId}
    RETURNING id
  `;
  return !!row;
}
