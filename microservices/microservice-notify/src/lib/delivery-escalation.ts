/**
 * Notification delivery escalation — escalate notification priority
 * based on time sensitivity and retry history.
 */

import type { Sql } from "postgres";

export interface EscalationRule {
  id: string;
  workspace_id: string;
  channel: string;
  trigger_type: "time_delay" | "retry_count" | "engagement_threshold" | "manual";
  trigger_value: number;
  priority_boost: number;
  additional_channels: string[];
  is_active: boolean;
}

export interface EscalationEvent {
  notification_id: string;
  old_priority: number;
  new_priority: number;
  trigger_type: string;
  triggered_at: string;
  channels_added: string[];
}

/**
 * Create an escalation rule for a workspace + channel.
 */
export async function createEscalationRule(
  sql: Sql,
  workspaceId: string,
  channel: string,
  opts: {
    triggerType: "time_delay" | "retry_count" | "engagement_threshold" | "manual";
    triggerValue: number;
    priorityBoost?: number;
    additionalChannels?: string[];
  },
): Promise<EscalationRule> {
  const [rule] = await sql<EscalationRule[]>`
    INSERT INTO notify.escalation_rules (
      workspace_id, channel, trigger_type, trigger_value,
      priority_boost, additional_channels, is_active
    )
    VALUES (
      ${workspaceId},
      ${channel},
      ${opts.triggerType},
      ${opts.triggerValue},
      ${opts.priorityBoost ?? 1},
      ${opts.additionalChannels ?? []},
      true
    )
    RETURNING *
  `;
  return rule;
}

/**
 * Evaluate escalation rules for a notification and apply if triggered.
 */
export async function evaluateEscalation(
  sql: Sql,
  notificationId: string,
): Promise<EscalationEvent | null> {
  const [notification] = await sql<{
    id: string;
    workspace_id: string;
    channel: string;
    priority: number;
    retry_count: number;
    created_at: Date;
    engagement_score: number | null;
  }[]>`
    SELECT id, workspace_id, channel, priority,
           COALESCE((metadata->>'retry_count')::int, 0)::int as retry_count,
           created_at,
           (metadata->>'engagement_score')::float as engagement_score
    FROM notify.notifications
    WHERE id = ${notificationId}
  `;

  if (!notification) return null;

  const rules = await sql<EscalationRule[]>`
    SELECT * FROM notify.escalation_rules
    WHERE workspace_id = ${notification.workspace_id}
      AND channel = ${notification.channel}
      AND is_active = true
  `;

  let triggeredRule: EscalationRule | null = null;

  for (const rule of rules) {
    let triggered = false;

    switch (rule.trigger_type) {
      case "time_delay": {
        const ageMinutes = (Date.now() - new Date(notification.created_at).getTime()) / 60000;
        triggered = ageMinutes >= rule.trigger_value;
        break;
      }
      case "retry_count":
        triggered = notification.retry_count >= rule.trigger_value;
        break;
      case "engagement_threshold":
        triggered = notification.engagement_score !== null
          && notification.engagement_score < rule.trigger_value;
        break;
      case "manual":
        break;
    }

    if (triggered) {
      triggeredRule = rule;
      break;
    }
  }

  if (!triggeredRule) return null;

  const newPriority = notification.priority + triggeredRule.priority_boost;

  await sql`
    UPDATE notify.notifications
    SET priority = ${newPriority},
        metadata = jsonb_set(
          COALESCE(metadata, '{}'),
          '{escalated_at}',
          ${new Date().toISOString()}::text::jsonb
        )
    WHERE id = ${notificationId}
  `;

  return {
    notification_id: notificationId,
    old_priority: notification.priority,
    new_priority: newPriority,
    trigger_type: triggeredRule.trigger_type,
    triggered_at: new Date().toISOString(),
    channels_added: triggeredRule.additional_channels,
  };
}

/**
 * Manually trigger escalation for a notification.
 */
export async function manualEscalate(
  sql: Sql,
  notificationId: string,
  priorityBoost: number,
  additionalChannels?: string[],
): Promise<EscalationEvent | null> {
  const [notification] = await sql<{ id: string; priority: number }[]>`
    SELECT id, priority FROM notify.notifications WHERE id = ${notificationId}
  `;

  if (!notification) return null;

  const newPriority = notification.priority + priorityBoost;

  await sql`
    UPDATE notify.notifications
    SET priority = ${newPriority},
        metadata = jsonb_set(
          COALESCE(metadata, '{}'),
          '{manually_escalated_at}',
          ${new Date().toISOString()}::text::jsonb
        )
    WHERE id = ${notificationId}
  `;

  return {
    notification_id: notificationId,
    old_priority: notification.priority,
    new_priority: newPriority,
    trigger_type: "manual",
    triggered_at: new Date().toISOString(),
    channels_added: additionalChannels ?? [],
  };
}

/**
 * List escalation rules for a workspace.
 */
export async function listEscalationRules(
  sql: Sql,
  workspaceId: string,
  channel?: string,
): Promise<EscalationRule[]> {
  if (channel) {
    return sql<EscalationRule[]>`
      SELECT * FROM notify.escalation_rules
      WHERE workspace_id = ${workspaceId} AND channel = ${channel}
      ORDER BY trigger_type
    `;
  }
  return sql<EscalationRule[]>`
    SELECT * FROM notify.escalation_rules
    WHERE workspace_id = ${workspaceId}
    ORDER BY channel, trigger_type
  `;
}

/**
 * Delete an escalation rule.
 */
export async function deleteEscalationRule(
  sql: Sql,
  ruleId: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM notify.escalation_rules WHERE id = ${ruleId}
  `;
  return result.count > 0;
}