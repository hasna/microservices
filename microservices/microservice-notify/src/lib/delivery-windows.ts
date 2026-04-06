/**
 * Delivery windows — microservice-notify.
 *
 * Restrict notification delivery to user-defined time windows
 * (e.g., "only send between 9am-9pm weekdays"). Outside windows,
 * notifications are held and sent at the window open time.
 *
 * Usage:
 *   const canSend = await checkDeliveryWindow(sql, userId, channel)
 *   if (canSend.ok) { await send(...) } else { await holdForWindow(...) }
 */

import type { Sql } from "postgres";

export interface DeliveryWindow {
  id: string;
  user_id: string;
  channel: string;
  day_of_week: number[];       // 0=Sun, 1=Mon, ... 6=Sat
  start_hour: number;           // 0-23 local time
  start_minute: number;         // 0-59
  end_hour: number;
  end_minute: number;
  timezone: string;            // e.g. "America/New_York"
  is_active: boolean;
  created_at: string;
}

export interface WindowCheckResult {
  ok: boolean;
  reason: string | null;
  next_window_open: string | null;
  window: DeliveryWindow | null;
}

/**
 * Create a delivery window for a user+channel.
 */
export async function createDeliveryWindow(
  sql: Sql,
  userId: string,
  channel: string,
  opts: {
    dayOfWeek?: number[];
    startHour?: number;
    startMinute?: number;
    endHour?: number;
    endMinute?: number;
    timezone?: string;
  },
): Promise<DeliveryWindow> {
  const [w] = await sql<DeliveryWindow[]>`
    INSERT INTO notify.delivery_windows (
      user_id, channel, day_of_week,
      start_hour, start_minute, end_hour, end_minute,
      timezone, is_active
    )
    VALUES (
      ${userId}, ${channel},
      ${opts.dayOfWeek ?? [0, 1, 2, 3, 4, 5, 6]},
      ${opts.startHour ?? 9},
      ${opts.startMinute ?? 0},
      ${opts.endHour ?? 21},
      ${opts.endMinute ?? 0},
      ${opts.timezone ?? "UTC"},
      true
    )
    RETURNING *
  `;
  return w;
}

/**
 * Get delivery window for a user+channel.
 */
export async function getDeliveryWindow(
  sql: Sql,
  userId: string,
  channel: string,
): Promise<DeliveryWindow | null> {
  const [w] = await sql<DeliveryWindow[]>`
    SELECT * FROM notify.delivery_windows
    WHERE user_id = ${userId} AND channel = ${channel} AND is_active = true
  `;
  return w ?? null;
}

/**
 * Check if current time falls within user's delivery window.
 * Returns result with next window open time if currently outside.
 */
export async function checkDeliveryWindow(
  sql: Sql,
  userId: string,
  channel: string,
): Promise<WindowCheckResult> {
  const window = await getDeliveryWindow(sql, userId, channel);
  if (!window) {
    return { ok: true, reason: null, next_window_open: null, window: null };
  }

  const now = new Date();
  const currentDay = now.getDay();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentMinutes = currentHour * 60 + currentMinute;

  // Check day
  if (!window.day_of_week.includes(currentDay)) {
    const nextDay = findNextWindowDay(window.day_of_week, currentDay);
    const nextOpen = buildNextWindowDatetime(now, nextDay, window.start_hour, window.start_minute, window.timezone);
    return {
      ok: false,
      reason: `Outside delivery days (window: ${window.start_hour}:${window.start_minute}-${window.end_hour}:${window.end_minute})`,
      next_window_open: nextOpen.toISOString(),
      window,
    };
  }

  const windowStartMinutes = window.start_hour * 60 + window.start_minute;
  const windowEndMinutes = window.end_hour * 60 + window.end_minute;

  if (currentMinutes < windowStartMinutes) {
    const nextOpen = buildNextWindowDatetime(now, currentDay, window.start_hour, window.start_minute, window.timezone);
    return {
      ok: false,
      reason: `Before window opens (opens at ${window.start_hour}:${window.start_minute})`,
      next_window_open: nextOpen.toISOString(),
      window,
    };
  }

  if (currentMinutes >= windowEndMinutes) {
    // Window already closed today
    const nextDay = findNextWindowDay(window.day_of_week, currentDay + 1);
    const nextOpen = buildNextWindowDatetime(now, nextDay, window.start_hour, window.start_minute, window.timezone);
    return {
      ok: false,
      reason: `After window closes (closed at ${window.end_hour}:${window.end_minute})`,
      next_window_open: nextOpen.toISOString(),
      window,
    };
  }

  return { ok: true, reason: null, next_window_open: null, window };
}

/**
 * Hold a notification until the next open window.
 * Returns the scheduled time as an ISO string.
 */
export async function holdForWindow(
  sql: Sql,
  notificationId: string,
  userId: string,
  channel: string,
): Promise<string> {
  const check = await checkDeliveryWindow(sql, userId, channel);
  if (check.ok) {
    // Shouldn't happen but handle gracefully
    return new Date().toISOString();
  }
  // Update the notification's scheduled_for to next window open
  await sql`
    UPDATE notify.notifications
    SET
      metadata = jsonb_set(metadata, '{held_for_window}', ${check.next_window_open ?? new Date().toISOString()}),
      scheduled_for = ${check.next_window_open ?? new Date().toISOString()}
    WHERE id = ${notificationId}
  `;
  return check.next_window_open ?? new Date().toISOString();
}

/**
 * List all delivery windows for a user.
 */
export async function listUserDeliveryWindows(
  sql: Sql,
  userId: string,
): Promise<DeliveryWindow[]> {
  return await sql<DeliveryWindow[]>`
    SELECT * FROM notify.delivery_windows
    WHERE user_id = ${userId} AND is_active = true
    ORDER BY channel
  `;
}

/**
 * Delete a delivery window.
 */
export async function deleteDeliveryWindow(
  sql: Sql,
  id: string,
): Promise<void> {
  await sql`DELETE FROM notify.delivery_windows WHERE id = ${id}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findNextWindowDay(days: number[], fromDay: number): number {
  for (let i = 1; i <= 7; i++) {
    const day = (fromDay + i) % 7;
    if (days.includes(day)) return day;
  }
  return days[0];
}

function buildNextWindowDatetime(now: Date, dayOfWeek: number, hour: number, minute: number, timezone: string): Date {
  const result = new Date(now);
  const currentDay = result.getDay();
  const daysToAdd = (dayOfWeek - currentDay + 7) % 7;
  result.setDate(result.getDate() + (daysToAdd === 0 ? 7 : daysToAdd));
  result.setHours(hour, minute, 0, 0);
  return result;
}