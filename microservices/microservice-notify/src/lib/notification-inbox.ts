/**
 * Notification inbox — persistent notification inbox with read/unread/archived state.
 */

import type { Sql } from "postgres";

export type InboxItemStatus = "unread" | "read" | "archived" | "deleted";

export interface InboxItem {
  id: string;
  user_id: string;
  notification_id: string | null;
  workspace_id: string | null;
  title: string;
  body: string;
  channel: string;
  priority: number;
  status: InboxItemStatus;
  archived_at: string | null;
  read_at: string | null;
  created_at: string;
}

export interface InboxBadgeCount {
  unread: number;
  unread_urgent: number;
}

/**
 * Add a notification to a user's inbox (creates an inbox item linked to the notification).
 */
export async function addToInbox(
  sql: Sql,
  data: {
    userId: string;
    workspaceId?: string;
    notificationId?: string;
    title: string;
    body: string;
    channel: string;
    priority?: number;
  },
): Promise<InboxItem> {
  const [row] = await sql<InboxItem[]>`
    INSERT INTO notify.inbox_items
      (user_id, notification_id, workspace_id, title, body, channel, priority)
    VALUES (
      ${data.userId},
      ${data.notificationId ?? null},
      ${data.workspaceId ?? null},
      ${data.title},
      ${data.body},
      ${data.channel},
      ${data.priority ?? 0}
    )
    RETURNING *
  `;
  return row;
}

/**
 * Get unread badge counts for a user.
 */
export async function getInboxBadgeCount(sql: Sql, userId: string): Promise<InboxBadgeCount> {
  const [row] = await sql<any[]>`
    SELECT
      COUNT(*) FILTER (WHERE status = 'unread') as unread,
      COUNT(*) FILTER (WHERE status = 'unread' AND priority >= 5) as unread_urgent
    FROM notify.inbox_items
    WHERE user_id = ${userId}
  `;
  return {
    unread: Number(row?.unread ?? 0),
    unread_urgent: Number(row?.unread_urgent ?? 0),
  };
}

/**
 * List inbox items for a user with filtering.
 */
export async function listInboxItems(
  sql: Sql,
  userId: string,
  opts?: {
    status?: InboxItemStatus;
    channel?: string;
    limit?: number;
    offset?: number;
    search?: string;
  },
): Promise<InboxItem[]> {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  let query = `SELECT * FROM notify.inbox_items WHERE user_id = $1`;
  const params: any[] = [userId];
  let idx = 2;

  if (opts?.status) {
    query += ` AND status = $${idx++}`;
    params.push(opts.status);
  }
  if (opts?.channel) {
    query += ` AND channel = $${idx++}`;
    params.push(opts.channel);
  }
  if (opts?.search) {
    query += ` AND (title ILIKE $${idx} OR body ILIKE $${idx})`;
    params.push(`%${opts.search}%`);
    idx++;
  }

  query += ` ORDER BY priority DESC, created_at DESC LIMIT $${idx++} OFFSET $${idx}`;
  params.push(limit, offset);

  const [rows] = await sql.unsafe(query, ...params) as any as [InboxItem[]];
  return rows ?? [];
}

/**
 * Mark an inbox item as read.
 */
export async function markInboxRead(sql: Sql, itemId: string, userId: string): Promise<boolean> {
  const [row] = await sql<[{ id: string }][]>`
    UPDATE notify.inbox_items
    SET status = 'read', read_at = NOW()
    WHERE id = ${itemId} AND user_id = ${userId}
    RETURNING id
  `;
  return !!row;
}

/**
 * Archive an inbox item (soft-delete, user can still view in archive).
 */
export async function archiveInboxItem(sql: Sql, itemId: string, userId: string): Promise<boolean> {
  const [row] = await sql<[{ id: string }][]>`
    UPDATE notify.inbox_items
    SET status = 'archived', archived_at = NOW()
    WHERE id = ${itemId} AND user_id = ${userId}
    RETURNING id
  `;
  return !!row;
}

/**
 * Permanently delete an inbox item.
 */
export async function deleteInboxItem(sql: Sql, itemId: string, userId: string): Promise<boolean> {
  const [row] = await sql<[{ id: string }][]>`
    DELETE FROM notify.inbox_items
    WHERE id = ${itemId} AND user_id = ${userId}
    RETURNING id
  `;
  return !!row;
}

/**
 * Bulk archive old read items for a user.
 */
export async function pruneReadItems(
  sql: Sql,
  userId: string,
  olderThanDays = 30,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86400 * 1000).toISOString();
  const result = await sql.unsafe(`
    DELETE FROM notify.inbox_items
    WHERE user_id = $1 AND status IN ('read', 'archived') AND created_at < $2
  `, userId, cutoff) as any;
  return (result as any).count ?? 0;
}

/**
 * Mark all unread inbox items as read.
 */
export async function markAllInboxRead(sql: Sql, userId: string): Promise<number> {
  const result = await sql.unsafe(`
    UPDATE notify.inbox_items
    SET status = 'read', read_at = NOW()
    WHERE user_id = $1 AND status = 'unread'
  `, userId) as any;
  return (result as any).count ?? 0;
}
