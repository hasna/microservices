import type { Sql } from "postgres";

/**
 * Channel priority: higher number = higher priority for delivery.
 * Priority 0 = background/bulk, 10 = critical real-time.
 */
export async function setChannelPriority(
  sql: Sql,
  channelId: string,
  priority: number,
): Promise<void> {
  await sql`
    UPDATE notify.channels
    SET priority = ${priority}
    WHERE id = ${channelId}
  `;
}

export async function getChannelPriority(
  sql: Sql,
  channelId: string,
): Promise<number> {
  const [row] = await sql<[{ priority: number }]>`
    SELECT priority FROM notify.channels WHERE id = ${channelId}
  `;
  return row?.priority ?? 0;
}

/**
 * Returns pending delivery records ordered by priority DESC, created_at ASC.
 * Used by workers to pick up the highest-priority work first.
 */
export async function getDeliveryQueue(
  sql: Sql,
  limit = 50,
): Promise<DeliveryQueueItem[]> {
  return sql<DeliveryQueueItem[]>`
    SELECT
      dr.id,
      dr.notification_id,
      dr.channel,
      dr.priority,
      dr.status,
      dr.retry_count,
      dr.max_retries,
      dr.next_retry_at,
      dr.created_at,
      n.user_id,
      n.workspace_id,
      n.title,
      n.body,
      n.data,
      n.type
    FROM notify.delivery_records dr
    JOIN notify.notifications n ON n.id = dr.notification_id
    WHERE dr.status = 'pending'
      AND (dr.next_retry_at IS NULL OR dr.next_retry_at <= NOW())
    ORDER BY dr.priority DESC, dr.created_at ASC
    LIMIT ${limit}
  `;
}

export interface DeliveryQueueItem {
  id: string;
  notification_id: string;
  channel: string;
  priority: number;
  status: string;
  retry_count: number;
  max_retries: number;
  next_retry_at: string | null;
  created_at: string;
  user_id: string;
  workspace_id: string | null;
  title: string | null;
  body: string;
  data: any;
  type: string;
}

/**
 * Reschedule a channel's pending records to a new priority.
 * Useful for deprioritizing a noisy channel or boosting a critical one.
 */
export async function rescheduleByPriority(
  sql: Sql,
  channelId: string,
  newPriority: number,
): Promise<number> {
  const result = await sql`
    UPDATE notify.delivery_records
    SET priority = ${newPriority}
    WHERE channel = ${channelId}
      AND status = 'pending'
      AND next_retry_at IS NOT NULL
      AND next_retry_at > NOW()
    RETURNING id
  `;
  return result.count;
}

// ---- Priority Rules Engine ---------------------------------------------------

export interface PriorityRule {
  id: string;
  name: string;
  channel: string | null;
  type: string | null;
  condition: string; // JSON condition expression
  priority_boost: number;
  enabled: boolean;
}

/**
 * Add a priority rule that boosts priority when condition matches.
 * Condition is a JSON object: { field: "type|channel|body|title", operator: "contains"|"equals"|"starts_with", value: string }
 */
export async function addPriorityRule(
  sql: Sql,
  opts: {
    name: string;
    channel?: string;
    type?: string;
    condition: { field: string; operator: string; value: string };
    priorityBoost?: number;
    enabled?: boolean;
  },
): Promise<PriorityRule> {
  const [rule] = await sql<PriorityRule[]>`
    INSERT INTO notify.priority_rules (name, channel, type, condition, priority_boost, enabled)
    VALUES (
      ${opts.name},
      ${opts.channel ?? null},
      ${opts.type ?? null},
      ${JSON.stringify(opts.condition)},
      ${opts.priorityBoost ?? 0},
      ${opts.enabled ?? true}
    )
    RETURNING *
  `;
  return rule;
}

/**
 * Evaluate a notification against all enabled priority rules and compute the total boost.
 */
export async function evaluatePriorityBoost(
  sql: Sql,
  notification: { channel: string; type: string; body?: string; title?: string },
): Promise<number> {
  const rules = await sql<PriorityRule[]>`
    SELECT * FROM notify.priority_rules
    WHERE enabled = true
      AND (channel IS NULL OR channel = ${notification.channel})
      AND (type IS NULL OR type = ${notification.type})
  `;

  let totalBoost = 0;
  for (const rule of rules) {
    const cond = JSON.parse(rule.condition) as { field: string; operator: string; value: string };
    const fieldValue = notification[cond.field as keyof typeof notification] ?? "";
    let matched = false;
    switch (cond.operator) {
      case "equals":
        matched = fieldValue === cond.value;
        break;
      case "contains":
        matched = String(fieldValue).toLowerCase().includes(cond.value.toLowerCase());
        break;
      case "starts_with":
        matched = String(fieldValue).toLowerCase().startsWith(cond.value.toLowerCase());
        break;
      case "ends_with":
        matched = String(fieldValue).toLowerCase().endsWith(cond.value.toLowerCase());
        break;
    }
    if (matched) totalBoost += rule.priority_boost;
  }
  return totalBoost;
}

/**
 * Get all channels with their current priority and recent delivery stats.
 */
export async function getChannelPriorityMatrix(
  sql: Sql,
): Promise<Array<{ channel: string; priority: number; pending: number; sent_24h: number; failed_24h: number }>> {
  return sql`
    SELECT
      c.id AS channel,
      c.priority,
      COUNT(dr.id) FILTER (WHERE dr.status = 'pending') AS pending,
      COUNT(ne.id) FILTER (WHERE ne.event_type = 'sent' AND ne.created_at >= NOW() - INTERVAL '24 hours') AS sent_24h,
      COUNT(ne.id) FILTER (WHERE ne.event_type = 'failed' AND ne.created_at >= NOW() - INTERVAL '24 hours') AS failed_24h
    FROM notify.channels c
    LEFT JOIN notify.delivery_records dr ON dr.channel = c.id AND dr.status = 'pending'
    LEFT JOIN notify.notification_events ne ON ne.channel = c.id
    GROUP BY c.id, c.priority
    ORDER BY c.priority DESC, c.id
  `;
}
