import type { Sql } from "postgres";

/**
 * A scheduled notification stored separately from the main notifications table.
 * Allows scheduling far in advance without cluttering the main table.
 */
export interface ScheduledNotification {
  id: string;
  workspace_id: string | null;
  channel_type: string;
  payload: Record<string, any>;
  scheduled_for: string;
  status: "pending" | "sent" | "cancelled" | "failed";
  created_at: string;
}

export interface CreateScheduledData {
  workspaceId?: string;
  channelType: string;
  payload: Record<string, any>;
  scheduledFor: string;
}

/**
 * Schedule a notification for future delivery.
 */
export async function scheduleNotification(
  sql: Sql,
  data: CreateScheduledData,
): Promise<ScheduledNotification> {
  const [n] = await sql<ScheduledNotification[]>`
    INSERT INTO notify.scheduled_notifications
      (workspace_id, channel_type, payload, scheduled_for, status)
    VALUES (
      ${data.workspaceId ?? null},
      ${data.channelType},
      ${sql.json(data.payload)},
      ${data.scheduledFor},
      'pending'
    )
    RETURNING *
  `;
  return n;
}

/**
 * Cancel a pending scheduled notification.
 */
export async function cancelScheduled(
  sql: Sql,
  id: string,
): Promise<ScheduledNotification | null> {
  const [n] = await sql<ScheduledNotification[]>`
    UPDATE notify.scheduled_notifications
    SET status = 'cancelled'
    WHERE id = ${id} AND status = 'pending'
    RETURNING *
  `;
  return n ?? null;
}

/**
 * Get pending scheduled notifications that are due before a given time.
 * Used by workers to pick up due items.
 */
export async function getPendingScheduled(
  sql: Sql,
  before: Date,
  limit = 50,
): Promise<ScheduledNotification[]> {
  return sql<ScheduledNotification[]>`
    SELECT * FROM notify.scheduled_notifications
    WHERE status = 'pending'
      AND scheduled_for <= ${before}
    ORDER BY scheduled_for ASC
    LIMIT ${limit}
  `;
}

/**
 * Mark a scheduled notification as sent (or failed).
 */
export async function markScheduledSent(
  sql: Sql,
  id: string,
  newStatus: "sent" | "failed" = "sent",
): Promise<ScheduledNotification | null> {
  const [n] = await sql<ScheduledNotification[]>`
    UPDATE notify.scheduled_notifications
    SET status = ${newStatus}
    WHERE id = ${id}
    RETURNING *
  `;
  return n ?? null;
}

/**
 * Reschedule a pending notification to a new time.
 */
export async function rescheduleScheduled(
  sql: Sql,
  id: string,
  newScheduledFor: string,
): Promise<ScheduledNotification | null> {
  const [n] = await sql<ScheduledNotification[]>`
    UPDATE notify.scheduled_notifications
    SET scheduled_for = ${newScheduledFor}
    WHERE id = ${id} AND status = 'pending'
    RETURNING *
  `;
  return n ?? null;
}

/**
 * List all scheduled notifications for a workspace.
 */
export async function listScheduled(
  sql: Sql,
  workspaceId: string,
  status?: "pending" | "sent" | "cancelled" | "failed",
): Promise<ScheduledNotification[]> {
  if (status) {
    return sql<ScheduledNotification[]>`
      SELECT * FROM notify.scheduled_notifications
      WHERE workspace_id = ${workspaceId} AND status = ${status}
      ORDER BY scheduled_for ASC
    `;
  }
  return sql<ScheduledNotification[]>`
    SELECT * FROM notify.scheduled_notifications
    WHERE workspace_id = ${workspaceId}
    ORDER BY scheduled_for ASC
  `;
}

/**
 * Schedule multiple notifications at once. Returns created notifications.
 * Useful for recurring/digest notifications where multiple items go out together.
 */
export async function scheduleBatch(
  sql: Sql,
  items: CreateScheduledData[],
  idempotencyKey?: string,
): Promise<ScheduledNotification[]> {
  if (items.length === 0) return [];

  // Build batch insert
  const rows = items.map((item) => ({
    workspace_id: item.workspaceId ?? null,
    channel_type: item.channelType,
    payload: item.payload,
    scheduled_for: item.scheduledFor,
  }));

  const result = await sql<ScheduledNotification[]>`
    INSERT INTO notify.scheduled_notifications
      (workspace_id, channel_type, payload, scheduled_for, status)
    SELECT * FROM ${sql(rows)}
    RETURNING *
  `;

  return result;
}

/**
 * Detect scheduling conflicts — overlapping scheduled notifications for the same user/channel
 * within a time window. Useful for digest merging or rate-limit avoidance.
 */
export async function getScheduleConflicts(
  sql: Sql,
  opts: {
    userId: string;
    channelType: string;
    windowMinutes?: number;
    after?: Date;
  },
): Promise<Array<{ id: string; scheduled_for: string; payload: any; conflict_with: string | null }>> {
  const windowMs = (opts.windowMinutes ?? 60) * 60 * 1000;

  // Get all pending scheduled within the window
  const pending = await sql<ScheduledNotification[]>`
    SELECT * FROM notify.scheduled_notifications
    WHERE status = 'pending'
      AND channel_type = ${opts.channelType}
      AND scheduled_for >= ${opts.after ?? new Date()}
      AND scheduled_for <= ${new Date(Date.now() + windowMs)}
    ORDER BY scheduled_for ASC
  `;

  // Find conflicts (items within window that could be merged)
  const conflicts: Array<{ id: string; scheduled_for: string; payload: any; conflict_with: string | null }> = [];
  for (let i = 0; i < pending.length; i++) {
    const a = pending[i]!;
    let conflictWith: string | null = null;

    for (let j = i + 1; j < pending.length; j++) {
      const b = pending[j]!;
      const diff = Math.abs(
        new Date(b.scheduled_for).getTime() - new Date(a.scheduled_for).getTime()
      );
      if (diff <= windowMs) {
        conflictWith = b.id;
        break; // Only report first conflict
      }
    }

    if (conflictWith) {
      conflicts.push({
        id: a.id,
        scheduled_for: a.scheduled_for,
        payload: a.payload,
        conflict_with: conflictWith,
      });
    }
  }

  return conflicts;
}
