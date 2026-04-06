import type { Sql } from "postgres";

/**
 * Tracks delivery, read, and click events for notifications.
 */
export interface NotificationEngagement {
  notification_id: string;
  delivered_at: string | null;
  read_at: string | null;
  clicked_at: string | null;
  channel_type: string;
  metadata: Record<string, any> | null;
}

/**
 * Record that a notification was delivered to a channel.
 */
export async function recordDelivery(
  sql: Sql,
  notificationId: string,
  channelType: string,
  metadata?: Record<string, any>,
): Promise<void> {
  await sql`
    INSERT INTO notify.notification_engagement (notification_id, channel_type, delivered_at, metadata)
    VALUES (${notificationId}, ${channelType}, NOW(), ${metadata ? sql.json(metadata) : null})
    ON CONFLICT (notification_id, channel_type) DO UPDATE SET
      delivered_at = COALESCE(notify.notification_engagement.delivered_at, NOW()),
      metadata = COALESCE(${metadata ? sql.json(metadata) : null}, notify.notification_engagement.metadata)
  `;
}

/**
 * Record that a notification was read by the user.
 */
export async function recordRead(
  sql: Sql,
  notificationId: string,
): Promise<void> {
  await sql`
    UPDATE notify.notification_engagement
    SET read_at = NOW()
    WHERE notification_id = ${notificationId} AND read_at IS NULL
  `;
}

/**
 * Mark a notification as read for a specific user (per-user read receipt).
 */
export async function markNotificationRead(
  sql: Sql,
  notificationId: string,
  userId: string,
): Promise<void> {
  await sql`
    INSERT INTO notify.notification_read_receipts (notification_id, user_id, read_at)
    VALUES (${notificationId}, ${userId}, NOW())
    ON CONFLICT (notification_id, user_id) DO UPDATE SET read_at = NOW()
  `;
}

/**
 * List all read receipts for a user across their notifications.
 */
export async function listReadReceiptsForUser(
  sql: Sql,
  userId: string,
  limit = 50,
  offset = 0,
): Promise<ReadReceipt[]> {
  return sql<ReadReceipt[]>`
    SELECT r.notification_id, r.user_id, r.read_at, n.title, n.type, n.channel_type
    FROM notify.notification_read_receipts r
    JOIN notify.notifications n ON n.id = r.notification_id
    WHERE r.user_id = ${userId}
    ORDER BY r.read_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}

export interface ReadReceipt {
  notification_id: string;
  user_id: string;
  read_at: Date;
  title: string | null;
  type: string | null;
  channel_type: string | null;
}

/**
 * Record that a notification link was clicked.
 */
export async function recordClick(
  sql: Sql,
  notificationId: string,
  metadata?: Record<string, any>,
): Promise<void> {
  await sql`
    UPDATE notify.notification_engagement
    SET clicked_at = NOW(),
        metadata = COALESCE(
          notify.notification_engagement.metadata || ${metadata ? sql.json(metadata) : sql.json({})},
          ${metadata ? sql.json(metadata) : null}
        )
    WHERE notification_id = ${notificationId} AND clicked_at IS NULL
  `;
}

/**
 * Get all engagement events for a single notification.
 */
export async function getNotificationEngagement(
  sql: Sql,
  notificationId: string,
): Promise<NotificationEngagement[]> {
  return sql<NotificationEngagement[]>`
    SELECT * FROM notify.notification_engagement
    WHERE notification_id = ${notificationId}
  `;
}

/**
 * Per-channel delivery/read/click statistics for a workspace.
 */
export async function getChannelStats(
  sql: Sql,
  workspaceId: string,
  since?: Date,
): Promise<ChannelStats[]> {
  const base = since
    ? sql`AND n.created_at >= ${since}`
    : sql``;

  return sql<ChannelStats[]>`
    SELECT
      e.channel_type,
      COUNT(e.notification_id) FILTER (WHERE e.delivered_at IS NOT NULL) AS delivered,
      COUNT(e.notification_id) FILTER (WHERE e.read_at IS NOT NULL) AS read,
      COUNT(e.notification_id) FILTER (WHERE e.clicked_at IS NOT NULL) AS clicked,
      COUNT(e.notification_id) AS total
    FROM notify.notification_engagement e
    JOIN notify.notifications n ON n.id = e.notification_id
    WHERE n.workspace_id = ${workspaceId}
    ${base}
    GROUP BY e.channel_type
    ORDER BY e.channel_type
  `;
}

export interface ChannelStats {
  channel_type: string;
  delivered: number;
  read: number;
  clicked: number;
  total: number;
  delivery_rate: string;
  read_rate: string;
  click_rate: string;
}

export interface EngagementTimeSeriesPoint {
  date: string;
  channel_type: string;
  delivered: number;
  read_count: number;
  clicked: number;
  bounced: number;
  failed: number;
}

/**
 * Get engagement time-series data for a workspace over a date range.
 */
export async function getEngagementTimeSeries(
  sql: Sql,
  workspaceId: string,
  opts: {
    since?: Date;
    until?: Date;
    channel?: string;
    granularity?: "day" | "hour";
  } = {},
): Promise<EngagementTimeSeriesPoint[]> {
  const { since, until, channel } = opts;

  const sinceFilter = since ? sql`AND n.created_at >= ${since}` : sql``;
  const untilFilter = until ? sql`AND n.created_at <= ${until}` : sql``;
  const channelFilter = channel ? sql`AND e.channel_type = ${channel}` : sql``;

  const rows = await sql<any[]>`
    SELECT
      DATE(e.delivered_at) AS date,
      e.channel_type,
      COUNT(*) FILTER (WHERE e.delivered_at IS NOT NULL) AS delivered,
      COUNT(*) FILTER (WHERE e.read_at IS NOT NULL) AS read_count,
      COUNT(*) FILTER (WHERE e.clicked_at IS NOT NULL) AS clicked,
      0 AS bounced,
      0 AS failed
    FROM notify.notification_engagement e
    JOIN notify.notifications n ON n.id = e.notification_id
    WHERE n.workspace_id = ${workspaceId}
      AND e.delivered_at IS NOT NULL
      ${sinceFilter} ${untilFilter} ${channelFilter}
    GROUP BY DATE(e.delivered_at), e.channel_type
    ORDER BY date ASC, e.channel_type
  `;

  return rows.map((r) => ({
    date: String(r.date),
    channel_type: r.channel_type,
    delivered: Number(r.delivered),
    read_count: Number(r.read_count),
    clicked: Number(r.clicked),
    bounced: Number(r.bounced),
    failed: Number(r.failed),
  }));
}

export interface EngagementFunnelStep {
  stage: string;
  count: number;
  percentage: string;
}

/**
 * Get a conversion funnel for a workspace: delivered → read → clicked.
 */
export async function getEngagementFunnel(
  sql: Sql,
  workspaceId: string,
  since?: Date,
  until?: Date,
): Promise<EngagementFunnelStep[]> {
  const sinceFilter = since ? sql`AND n.created_at >= ${since}` : sql``;
  const untilFilter = until ? sql`AND n.created_at <= ${until}` : sql``;

  const rows = await sql<any[]>`
    SELECT
      COUNT(*) FILTER (WHERE e.delivered_at IS NOT NULL) AS delivered,
      COUNT(*) FILTER (WHERE e.read_at IS NOT NULL) AS read,
      COUNT(*) FILTER (WHERE e.clicked_at IS NOT NULL) AS clicked
    FROM notify.notification_engagement e
    JOIN notify.notifications n ON n.id = e.notification_id
    WHERE n.workspace_id = ${workspaceId}
      ${sinceFilter} ${untilFilter}
  `;

  if (!rows || rows.length === 0) return [];

  const delivered = Number(rows[0]?.delivered ?? 0);
  const read = Number(rows[0]?.read ?? 0);
  const clicked = Number(rows[0]?.clicked ?? 0);

  const pct = (n: number, base: number) =>
    base === 0 ? "0.00%" : ((n / base) * 100).toFixed(2) + "%";

  return [
    { stage: "delivered", count: delivered, percentage: pct(delivered, delivered) },
    { stage: "read", count: read, percentage: pct(read, delivered) },
    { stage: "clicked", count: clicked, percentage: pct(clicked, delivered) },
  ];
}
