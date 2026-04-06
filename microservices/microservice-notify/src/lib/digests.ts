import type { Sql } from "postgres";

/**
 * Notification digests: group multiple unread notifications into a single
 * consolidated notification, delivered on a schedule (e.g., daily/weekly digest).
 */

export interface NotificationDigest {
  id: string;
  user_id: string;
  workspace_id: string | null;
  channel: "email" | "sms" | "in_app" | "webhook";
  frequency: "hourly" | "daily" | "weekly";
  subject: string;
  body: string;
  notification_ids: string[];
  rendered_data: Record<string, any>;
  status: "pending" | "sent" | "cancelled";
  sent_at: string | null;
  created_at: string;
}

export interface CreateDigestData {
  userId: string;
  workspaceId?: string;
  channel: "email" | "sms" | "in_app" | "webhook";
  frequency: "hourly" | "daily" | "weekly";
  subject: string;
  body: string;
  notificationIds: string[];
  renderedData?: Record<string, any>;
}

export interface DigestSchedule {
  id: string;
  user_id: string;
  workspace_id: string | null;
  channel: "email" | "sms" | "in_app" | "webhook";
  frequency: "hourly" | "daily" | "weekly";
  enabled: boolean;
  hour_of_day: number | null;  // 0-23, for daily/weekly
  day_of_week: number | null;  // 0-6, for weekly (0=Sunday)
  created_at: string;
}

export interface CreateDigestScheduleData {
  userId: string;
  workspaceId?: string;
  channel: "email" | "sms" | "in_app" | "webhook";
  frequency: "hourly" | "daily" | "weekly";
  hourOfDay?: number;
  dayOfWeek?: number;
}

/**
 * Create a digest record grouping several notifications.
 */
export async function createDigest(
  sql: Sql,
  data: CreateDigestData,
): Promise<NotificationDigest> {
  const [d] = await sql<NotificationDigest[]>`
    INSERT INTO notify.digests (user_id, workspace_id, channel, frequency, subject, body, notification_ids, rendered_data, status)
    VALUES (
      ${data.userId},
      ${data.workspaceId ?? null},
      ${data.channel},
      ${data.frequency},
      ${data.subject},
      ${data.body},
      ${data.notificationIds},
      ${sql.json(data.renderedData ?? {})},
      'pending'
    )
    RETURNING *
  `;
  return d;
}

/**
 * Mark a digest as sent.
 */
export async function markDigestSent(
  sql: Sql,
  id: string,
): Promise<NotificationDigest | null> {
  const [d] = await sql<NotificationDigest[]>`
    UPDATE notify.digests
    SET status = 'sent', sent_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return d ?? null;
}

/**
 * Cancel a pending digest.
 */
export async function cancelDigest(
  sql: Sql,
  id: string,
): Promise<NotificationDigest | null> {
  const [d] = await sql<NotificationDigest[]>`
    UPDATE notify.digests
    SET status = 'cancelled'
    WHERE id = ${id} AND status = 'pending'
    RETURNING *
  `;
  return d ?? null;
}

/**
 * Get a digest by ID.
 */
export async function getDigest(
  sql: Sql,
  id: string,
): Promise<NotificationDigest | null> {
  const [d] = await sql<NotificationDigest[]>`
    SELECT * FROM notify.digests WHERE id = ${id}
  `;
  return d ?? null;
}

/**
 * List digests for a user, optionally filtering by status.
 */
export async function listDigests(
  sql: Sql,
  userId: string,
  opts: { status?: "pending" | "sent" | "cancelled"; limit?: number; offset?: number } = {},
): Promise<NotificationDigest[]> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const statusFilter = opts.status
    ? sql`AND status = ${opts.status}`
    : sql``;
  return sql<NotificationDigest[]>`
    SELECT * FROM notify.digests
    WHERE user_id = ${userId} ${statusFilter}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

/**
 * Create or update a digest delivery schedule for a user.
 */
export async function upsertDigestSchedule(
  sql: Sql,
  data: CreateDigestScheduleData,
): Promise<DigestSchedule> {
  const [s] = await sql<DigestSchedule[]>`
    INSERT INTO notify.digest_schedules (user_id, workspace_id, channel, frequency, enabled, hour_of_day, day_of_week)
    VALUES (
      ${data.userId},
      ${data.workspaceId ?? null},
      ${data.channel},
      ${data.frequency},
      true,
      ${data.hourOfDay ?? null},
      ${data.dayOfWeek ?? null}
    )
    ON CONFLICT (user_id, channel, frequency) DO UPDATE SET
      enabled = true,
      hour_of_day = COALESCE(${data.hourOfDay ?? null}, digest_schedules.hour_of_day),
      day_of_week = COALESCE(${data.dayOfWeek ?? null}, digest_schedules.day_of_week)
    RETURNING *
  `;
  return s;
}

/**
 * Disable a digest schedule.
 */
export async function disableDigestSchedule(
  sql: Sql,
  userId: string,
  channel: string,
  frequency: "hourly" | "daily" | "weekly",
): Promise<boolean> {
  const r = await sql`
    UPDATE notify.digest_schedules
    SET enabled = false
    WHERE user_id = ${userId}
      AND channel = ${channel}
      AND frequency = ${frequency}
  `;
  return r.count > 0;
}

/**
 * List digest schedules for a user.
 */
export async function listDigestSchedules(
  sql: Sql,
  userId: string,
): Promise<DigestSchedule[]> {
  return sql<DigestSchedule[]>`
    SELECT * FROM notify.digest_schedules
    WHERE user_id = ${userId} AND enabled = true
    ORDER BY frequency, channel
  `;
}

/**
 * Collect pending notifications for a user's digest and render them
 * into a summary body. Returns the collected notification IDs.
 */
export async function collectDigestNotifications(
  sql: Sql,
  userId: string,
  channel: string,
  limit = 20,
): Promise<{ ids: string[]; notifications: Array<{ id: string; type: string; title: string | null; body: string; created_at: string }> }> {
  const notifications = await sql<Array<{ id: string; type: string; title: string | null; body: string; created_at: string }>>`
    SELECT id, type, title, body, created_at
    FROM notify.notifications
    WHERE user_id = ${userId}
      AND channel = ${channel}
      AND read_at IS NULL
      AND status = 'pending'
    ORDER BY priority DESC, created_at DESC
    LIMIT ${limit}
  `;
  return {
    ids: notifications.map(n => n.id),
    notifications,
  };
}

/**
 * Generate a digest summary body from collected notifications.
 */
export function renderDigestBody(
  notifications: Array<{ type: string; title: string | null; body: string }>,
  frequency: "hourly" | "daily" | "weekly",
): string {
  if (notifications.length === 0) return "No new notifications.";
  const header = frequency === "daily"
    ? "Your daily digest"
    : frequency === "weekly"
    ? "Your weekly digest"
    : "Your hourly digest";
  const lines = notifications.map(n =>
    n.title ? `• ${n.title}: ${n.body}` : `• ${n.body}`
  );
  return `${header} (${notifications.length} items)\n\n${lines.join("\n")}`;
}
