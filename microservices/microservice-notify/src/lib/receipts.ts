import type { Sql } from "postgres";

/**
 * Delivery receipts: structured proof-of-delivery records for each channel.
 * Unlike engagement (read/click), receipts capture the technical delivery
 * acknowledgment from the underlying provider (email MTA, SMS gateway, etc.).
 */

export type DeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "bounced"
  | "dropped"
  | "spam"
  | "failed";

export interface DeliveryReceipt {
  id: string;
  notification_id: string;
  channel: "email" | "sms" | "in_app" | "webhook";
  provider_message_id: string | null;
  status: DeliveryStatus;
  provider_status: string | null;  // Provider-specific status code
  provider_response: Record<string, any> | null;  // Raw provider response
  delivered_at: string | null;
  bounced_at: string | null;
  created_at: string;
}

/**
 * Record a delivery receipt update.
 */
export async function upsertReceipt(
  sql: Sql,
  data: {
    notificationId: string;
    channel: "email" | "sms" | "in_app" | "webhook";
    providerMessageId?: string;
    status: DeliveryStatus;
    providerStatus?: string;
    providerResponse?: Record<string, any>;
  },
): Promise<DeliveryReceipt> {
  const deliveredAt =
    data.status === "delivered" ? new Date().toISOString() : null;
  const bouncedAt =
    data.status === "bounced" || data.status === "dropped" ? new Date().toISOString() : null;

  const [r] = await sql<DeliveryReceipt[]>`
    INSERT INTO notify.delivery_receipts
      (notification_id, channel, provider_message_id, status, provider_status, provider_response, delivered_at, bounced_at)
    VALUES (
      ${data.notificationId},
      ${data.channel},
      ${data.providerMessageId ?? null},
      ${data.status},
      ${data.providerStatus ?? null},
      ${data.providerResponse ? sql.json(data.providerResponse) : null},
      ${deliveredAt},
      ${bouncedAt}
    )
    ON CONFLICT (notification_id, channel) DO UPDATE SET
      status = COALESCE(${data.status}, delivery_receipts.status),
      provider_status = COALESCE(${data.providerStatus ?? null}, delivery_receipts.provider_status),
      provider_response = COALESCE(${data.providerResponse ? sql.json(data.providerResponse) : null}, delivery_receipts.provider_response),
      delivered_at = COALESCE(${deliveredAt}, delivery_receipts.delivered_at),
      bounced_at = COALESCE(${bouncedAt}, delivery_receipts.bounced_at)
    RETURNING *
  `;
  return r;
}

/**
 * Get receipt for a notification/channel.
 */
export async function getReceipt(
  sql: Sql,
  notificationId: string,
  channel: string,
): Promise<DeliveryReceipt | null> {
  const [r] = await sql<DeliveryReceipt[]>`
    SELECT * FROM notify.delivery_receipts
    WHERE notification_id = ${notificationId} AND channel = ${channel}
  `;
  return r ?? null;
}

/**
 * List all receipts for a notification.
 */
export async function listReceipts(
  sql: Sql,
  notificationId: string,
): Promise<DeliveryReceipt[]> {
  return sql<DeliveryReceipt[]>`
    SELECT * FROM notify.delivery_receipts
    WHERE notification_id = ${notificationId}
    ORDER BY created_at DESC
  `;
}

/**
 * Mark a receipt as bounced (permanent failure).
 */
export async function markBounced(
  sql: Sql,
  notificationId: string,
  channel: string,
  providerResponse?: Record<string, any>,
): Promise<DeliveryReceipt | null> {
  const [r] = await sql<DeliveryReceipt[]>`
    UPDATE notify.delivery_receipts
    SET status = 'bounced',
        bounced_at = NOW(),
        provider_response = COALESCE(
          ${providerResponse ? sql.json(providerResponse) : null},
          delivery_receipts.provider_response
        )
    WHERE notification_id = ${notificationId} AND channel = ${channel}
    RETURNING *
  `;
  return r ?? null;
}

/**
 * Get delivery receipt summary statistics.
 */
export async function getReceiptStats(
  sql: Sql,
  opts: {
    workspaceId?: string;
    channel?: string;
    since?: Date;
    until?: Date;
  } = {},
): Promise<{
  channel: string;
  total: number;
  delivered: number;
  bounced: number;
  dropped: number;
  failed: number;
  delivery_rate: string;
}[]> {
  const workspaceFilter = opts.workspaceId
    ? sql`AND n.workspace_id = ${opts.workspaceId}`
    : sql``;
  const channelFilter = opts.channel
    ? sql`AND r.channel = ${opts.channel}`
    : sql``;
  const sinceFilter = opts.since
    ? sql`AND r.created_at >= ${opts.since}`
    : sql``;
  const untilFilter = opts.until
    ? sql`AND r.created_at <= ${opts.until}`
    : sql``;

  return sql<Array<{
    channel: string;
    total: number;
    delivered: number;
    bounced: number;
    dropped: number;
    failed: number;
    delivery_rate: string;
  }>>`
    SELECT
      r.channel,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE r.status = 'delivered') AS delivered,
      COUNT(*) FILTER (WHERE r.status = 'bounced') AS bounced,
      COUNT(*) FILTER (WHERE r.status = 'dropped') AS dropped,
      COUNT(*) FILTER (WHERE r.status = 'failed') AS failed,
      CASE
        WHEN COUNT(*) = 0 THEN '0%'
        ELSE ROUND(
          100.0 * COUNT(*) FILTER (WHERE r.status = 'delivered') / COUNT(*), 2
        )::text || '%'
      END AS delivery_rate
    FROM notify.delivery_receipts r
    JOIN notify.notifications n ON n.id = r.notification_id
    WHERE true ${workspaceFilter} ${channelFilter} ${sinceFilter} ${untilFilter}
    GROUP BY r.channel
    ORDER BY r.channel
  `;
}

/**
 * List recent bounced/dropped receipts for a workspace (for suppression analysis).
 */
export async function listBounces(
  sql: Sql,
  workspaceId: string,
  opts: { limit?: number; since?: Date } = {},
): Promise<DeliveryReceipt[]> {
  const limit = opts.limit ?? 100;
  const sinceFilter = opts.since ? sql`AND r.created_at >= ${opts.since}` : sql``;
  return sql<DeliveryReceipt[]>`
    SELECT r.*
    FROM notify.delivery_receipts r
    JOIN notify.notifications n ON n.id = r.notification_id
    WHERE n.workspace_id = ${workspaceId}
      AND r.status IN ('bounced', 'dropped')
      ${sinceFilter}
    ORDER BY r.bounced_at DESC
    LIMIT ${limit}
  `;
}
