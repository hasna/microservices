/**
 * Notification snooze and quiet hours — microservice-notify.
 *
 * Users can snooze notifications for a period (e.g., "snooze for 30 minutes")
 * or set quiet hours where no notifications are delivered.
 */

import type { Sql } from "postgres";

export interface QuietHours {
  id: string;
  user_id: string;
  start_hour: number;       // 0-23
  start_minute: number;     // 0-59
  end_hour: number;         // 0-23
  end_minute: number;       // 0-59
  timezone: string;
  is_active: boolean;
  channels_affected: string[];
  created_at: string;
}

export interface SnoozedNotification {
  notification_id: string;
  user_id: string;
  snoozed_until: string;
  original_channel: string;
  original_priority: number;
}

/**
 * Set quiet hours for a user.
 */
export async function setQuietHours(
  sql: Sql,
  userId: string,
  opts: {
    startHour: number;
    startMinute: number;
    endHour: number;
    endMinute: number;
    timezone?: string;
    channelsAffected?: string[];
  },
): Promise<QuietHours> {
  const [qh] = await sql<QuietHours[]>`
    INSERT INTO notify.quiet_hours (user_id, start_hour, start_minute, end_hour, end_minute, timezone, is_active, channels_affected)
    VALUES (${userId}, ${opts.startHour}, ${opts.startMinute}, ${opts.endHour}, ${opts.endMinute}, ${opts.timezone ?? "UTC"}, true, ${opts.channelsAffected ?? ["email", "in_app"]})
    ON CONFLICT (user_id) DO UPDATE SET
      start_hour = EXCLUDED.start_hour,
      start_minute = EXCLUDED.start_minute,
      end_hour = EXCLUDED.end_hour,
      end_minute = EXCLUDED.end_minute,
      timezone = EXCLUDED.timezone,
      channels_affected = EXCLUDED.channels_affected,
      is_active = true
    RETURNING *
  `;
  return qh;
}

/**
 * Check if current time is in quiet hours for a user+channel.
 */
export async function isInQuietHours(
  sql: Sql,
  userId: string,
  channel: string,
): Promise<{ inQuietHours: boolean; quietHours: QuietHours | null }> {
  const [qh] = await sql<QuietHours[]>`
    SELECT * FROM notify.quiet_hours
    WHERE user_id = ${userId} AND is_active = true
  `;
  if (!qh) return { inQuietHours: false, quietHours: null };

  // Check if channel is affected
  if (!qh.channels_affected.includes(channel)) {
    return { inQuietHours: false, quietHours: qh };
  }

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const windowStart = qh.start_hour * 60 + qh.start_minute;
  const windowEnd = qh.end_hour * 60 + qh.end_minute;

  // Handle overnight quiet hours (e.g., 22:00 - 07:00)
  if (windowStart > windowEnd) {
    // Overnight window: active if current time is >= start OR <= end
    if (currentMinutes >= windowStart || currentMinutes <= windowEnd) {
      return { inQuietHours: true, quietHours: qh };
    }
  } else {
    // Same-day window
    if (currentMinutes >= windowStart && currentMinutes <= windowEnd) {
      return { inQuietHours: true, quietHours: qh };
    }
  }

  return { inQuietHours: false, quietHours: qh };
}

/**
 * Snooze a specific notification for a duration.
 */
export async function snoozeNotification(
  sql: Sql,
  notificationId: string,
  userId: string,
  durationMinutes = 30,
): Promise<SnoozedNotification> {
  const snoozedUntil = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

  // Get original notification to preserve channel/priority
  const [n] = await sql<{ channel: string; priority: number }[]>`
    SELECT channel, priority FROM notify.notifications WHERE id = ${notificationId}
  `;

  await sql`
    INSERT INTO notify.snoozed_notifications (notification_id, user_id, snoozed_until, original_channel, original_priority)
    VALUES (${notificationId}, ${userId}, ${snoozedUntil}, ${n?.channel ?? "in_app"}, ${n?.priority ?? 5})
    ON CONFLICT (notification_id) DO UPDATE SET snoozed_until = EXCLUDED.snoozed_until
  `;

  return {
    notification_id: notificationId,
    user_id: userId,
    snoozed_until: snoozedUntil,
    original_channel: n?.channel ?? "in_app",
    original_priority: n?.priority ?? 5,
  };
}

/**
 * Get active snooze for a notification.
 */
export async function getNotificationSnooze(
  sql: Sql,
  notificationId: string,
): Promise<SnoozedNotification | null> {
  const [s] = await sql<SnoozedNotification[]>`
    SELECT * FROM notify.snoozed_notifications
    WHERE notification_id = ${notificationId} AND snoozed_until > NOW()
  `;
  return s ?? null;
}

/**
 * Check if a notification should be delivered or is still snoozed.
 */
export async function isSnoozed(
  sql: Sql,
  notificationId: string,
): Promise<boolean> {
  const snooze = await getNotificationSnooze(sql, notificationId);
  return snooze !== null;
}

/**
 * List all active snoozes for a user.
 */
export async function listUserSnoozes(
  sql: Sql,
  userId: string,
): Promise<SnoozedNotification[]> {
  return await sql<SnoozedNotification[]>`
    SELECT * FROM notify.snoozed_notifications
    WHERE user_id = ${userId} AND snoozed_until > NOW()
    ORDER BY snoozed_until ASC
  `;
}

/**
 * Dismiss snooze for a notification (deliver now).
 */
export async function dismissSnooze(
  sql: Sql,
  notificationId: string,
): Promise<void> {
  await sql`
    DELETE FROM notify.snoozed_notifications
    WHERE notification_id = ${notificationId}
  `;
}

/**
 * Get quiet hours for a user.
 */
export async function getQuietHours(
  sql: Sql,
  userId: string,
): Promise<QuietHours | null> {
  const [qh] = await sql<QuietHours[]>`
    SELECT * FROM notify.quiet_hours WHERE user_id = ${userId} AND is_active = true
  `;
  return qh ?? null;
}

/**
 * Disable quiet hours for a user.
 */
export async function disableQuietHours(
  sql: Sql,
  userId: string,
): Promise<void> {
  await sql`
    UPDATE notify.quiet_hours SET is_active = false WHERE user_id = ${userId}
  `;
}