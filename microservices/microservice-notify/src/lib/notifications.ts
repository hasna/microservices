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
}

export interface CreateNotificationData {
  userId: string;
  workspaceId?: string;
  channel: "email" | "sms" | "in_app" | "webhook";
  type: string;
  title?: string;
  body: string;
  data?: any;
}

export async function createNotification(
  sql: Sql,
  data: CreateNotificationData,
): Promise<Notification> {
  const [n] = await sql<Notification[]>`
    INSERT INTO notify.notifications (user_id, workspace_id, channel, type, title, body, data)
    VALUES (${data.userId}, ${data.workspaceId ?? null}, ${data.channel}, ${data.type}, ${data.title ?? null}, ${data.body}, ${sql.json(data.data ?? {})})
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
    >`SELECT * FROM notify.notifications WHERE user_id = ${userId} AND read_at IS NULL AND channel = ${opts.channel} AND type = ${opts.type} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  }
  if (opts.unreadOnly && opts.channel) {
    return sql<
      Notification[]
    >`SELECT * FROM notify.notifications WHERE user_id = ${userId} AND read_at IS NULL AND channel = ${opts.channel} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  }
  if (opts.unreadOnly && opts.type) {
    return sql<
      Notification[]
    >`SELECT * FROM notify.notifications WHERE user_id = ${userId} AND read_at IS NULL AND type = ${opts.type} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  }
  if (opts.unreadOnly) {
    return sql<
      Notification[]
    >`SELECT * FROM notify.notifications WHERE user_id = ${userId} AND read_at IS NULL ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  }
  if (opts.channel && opts.type) {
    return sql<
      Notification[]
    >`SELECT * FROM notify.notifications WHERE user_id = ${userId} AND channel = ${opts.channel} AND type = ${opts.type} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  }
  if (opts.channel) {
    return sql<
      Notification[]
    >`SELECT * FROM notify.notifications WHERE user_id = ${userId} AND channel = ${opts.channel} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  }
  if (opts.type) {
    return sql<
      Notification[]
    >`SELECT * FROM notify.notifications WHERE user_id = ${userId} AND type = ${opts.type} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  }
  return sql<
    Notification[]
  >`SELECT * FROM notify.notifications WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
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
