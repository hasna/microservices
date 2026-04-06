import type { Sql } from "postgres";

export interface Notification {
  id: string;
  user_id: string;
  workspace_id: string | null;
  channel: "email" | "sms" | "in_app" | "webhook";
  type: string;
  title: string | null;
  body: string;
  data: any;
  read_at: string | null;
  created_at: string;
  scheduled_at: string | null;
  priority: number;
  expires_at: string | null;
  status: "pending" | "sent" | "failed" | "cancelled";
}

export interface CreateNotificationData {
  userId: string;
  workspaceId?: string;
  channel: "email" | "sms" | "in_app" | "webhook";
  type: string;
  title?: string;
  body: string;
  data?: any;
  scheduledAt?: string;
  priority?: number;
  expiresAt?: string;
}

export async function createNotification(
  sql: Sql,
  data: CreateNotificationData,
): Promise<Notification> {
  const [n] = await sql<Notification[]>`
    INSERT INTO notify.notifications (user_id, workspace_id, channel, type, title, body, data, scheduled_at, priority, expires_at, status)
    VALUES (
      ${data.userId},
      ${data.workspaceId ?? null},
      ${data.channel},
      ${data.type},
      ${data.title ?? null},
      ${data.body},
      ${sql.json(data.data ?? {})},
      ${data.scheduledAt ?? null},
      ${data.priority ?? 5},
      ${data.expiresAt ?? null},
      ${data.scheduledAt ? "pending" : "pending"}
    )
    RETURNING *`;
  return n;
}

export async function getNotification(
  sql: Sql,
  id: string,
): Promise<Notification | null> {
  const [n] = await sql<
    Notification[]
  >`SELECT * FROM notify.notifications WHERE id = ${id}`;
  return n ?? null;
}

export interface ListNotificationsOptions {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
  channel?: string;
  type?: string;
}

export async function listUserNotifications(
  sql: Sql,
  userId: string,
  opts: ListNotificationsOptions = {},
): Promise<Notification[]> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  if (opts.unreadOnly && opts.channel && opts.type) {
    return sql<
      Notification[]
    >`SELECT * FROM notify.notifications WHERE user_id = ${userId} AND read_at IS NULL AND channel = ${opts.channel} AND type = ${opts.type} ORDER BY priority DESC, created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  }
  if (opts.unreadOnly && opts.channel) {
    return sql<
      Notification[]
    >`SELECT * FROM notify.notifications WHERE user_id = ${userId} AND read_at IS NULL AND channel = ${opts.channel} ORDER BY priority DESC, created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  }
  if (opts.unreadOnly && opts.type) {
    return sql<
      Notification[]
    >`SELECT * FROM notify.notifications WHERE user_id = ${userId} AND read_at IS NULL AND type = ${opts.type} ORDER BY priority DESC, created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  }
  if (opts.unreadOnly) {
    return sql<
      Notification[]
    >`SELECT * FROM notify.notifications WHERE user_id = ${userId} AND read_at IS NULL ORDER BY priority DESC, created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  }
  if (opts.channel && opts.type) {
    return sql<
      Notification[]
    >`SELECT * FROM notify.notifications WHERE user_id = ${userId} AND channel = ${opts.channel} AND type = ${opts.type} ORDER BY priority DESC, created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  }
  if (opts.channel) {
    return sql<
      Notification[]
    >`SELECT * FROM notify.notifications WHERE user_id = ${userId} AND channel = ${opts.channel} ORDER BY priority DESC, created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  }
  if (opts.type) {
    return sql<
      Notification[]
    >`SELECT * FROM notify.notifications WHERE user_id = ${userId} AND type = ${opts.type} ORDER BY priority DESC, created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  }
  return sql<
    Notification[]
  >`SELECT * FROM notify.notifications WHERE user_id = ${userId} ORDER BY priority DESC, created_at DESC LIMIT ${limit} OFFSET ${offset}`;
}

export async function markRead(
  sql: Sql,
  id: string,
): Promise<Notification | null> {
  const [n] = await sql<
    Notification[]
  >`UPDATE notify.notifications SET read_at = NOW() WHERE id = ${id} AND read_at IS NULL RETURNING *`;
  return n ?? null;
}

export async function markAllRead(sql: Sql, userId: string): Promise<number> {
  const r =
    await sql`UPDATE notify.notifications SET read_at = NOW() WHERE user_id = ${userId} AND read_at IS NULL`;
  return r.count;
}

export async function deleteNotification(
  sql: Sql,
  id: string,
): Promise<boolean> {
  const r = await sql`DELETE FROM notify.notifications WHERE id = ${id}`;
  return r.count > 0;
}

export async function countUnread(sql: Sql, userId: string): Promise<number> {
  const [{ count }] = await sql<
    [{ count: string }]
  >`SELECT COUNT(*) as count FROM notify.notifications WHERE user_id = ${userId} AND read_at IS NULL`;
  return parseInt(count, 10);
}

/**
 * Cancel a scheduled notification.
 */
export async function cancelNotification(
  sql: Sql,
  id: string,
): Promise<Notification | null> {
  const [n] = await sql<Notification[]>`
    UPDATE notify.notifications
    SET status = 'cancelled'
    WHERE id = ${id} AND status = 'pending'
    RETURNING *`;
  return n ?? null;
}

/**
 * List pending scheduled notifications due before a given time.
 */
export async function listScheduledDue(
  sql: Sql,
  before: Date,
  limit = 50,
): Promise<Notification[]> {
  return sql<Notification[]>`
    SELECT * FROM notify.notifications
    WHERE status = 'pending'
      AND scheduled_at IS NOT NULL
      AND scheduled_at <= ${before}
    ORDER BY priority DESC, scheduled_at ASC
    LIMIT ${limit}
  `;
}

/**
 * Reschedule a notification to a new time.
 */
export async function rescheduleNotification(
  sql: Sql,
  id: string,
  newScheduledAt: string,
): Promise<Notification | null> {
  const [n] = await sql<Notification[]>`
    UPDATE notify.notifications
    SET scheduled_at = ${newScheduledAt}, status = 'pending'
    WHERE id = ${id} AND status IN ('pending', 'cancelled')
    RETURNING *`;
  return n ?? null;
}

/**
 * Batch send notifications by channel — processes high-priority first.
 */
export async function batchSendByChannel(
  sql: Sql,
  userId: string,
  channel: "email" | "sms" | "in_app" | "webhook",
  limit = 20,
): Promise<number> {
  const rows = await sql<Notification[]>`
    SELECT * FROM notify.notifications
    WHERE user_id = ${userId}
      AND channel = ${channel}
      AND status = 'pending'
      AND (scheduled_at IS NULL OR scheduled_at <= NOW())
    ORDER BY priority DESC, created_at ASC
    LIMIT ${limit}
  `;
  for (const row of rows) {
    try {
      const { sendNotification } = await import("./send.js");
      await sendNotification(sql, row as any);
      await sql`
        UPDATE notify.notifications SET status = 'sent' WHERE id = ${row.id}
      `;
    } catch {
      await sql`
        UPDATE notify.notifications SET status = 'failed' WHERE id = ${row.id}
      `;
    }
  }
  return rows.length;
}
