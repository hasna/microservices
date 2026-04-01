/**
 * Track usage events and maintain aggregates.
 * The events table is append-only — track is the only write operation.
 */

import type { Sql } from "postgres";

export interface TrackInput {
  workspaceId: string;
  metric: string;
  quantity: number;
  unit?: string;
  metadata?: any;
}

/**
 * Insert a usage event and upsert daily/monthly aggregates.
 */
export async function track(sql: Sql, data: TrackInput): Promise<void> {
  const now = new Date();
  const unit = data.unit ?? "count";

  // Insert the raw event (append-only)
  await sql`
    INSERT INTO usage.events (workspace_id, metric, quantity, unit, metadata, recorded_at)
    VALUES (
      ${data.workspaceId},
      ${data.metric},
      ${data.quantity},
      ${unit},
      ${sql.json(data.metadata ?? {})},
      ${now.toISOString()}
    )
  `;

  // Upsert daily aggregate
  const dayStart = getPeriodStart(now, "day");
  await sql`
    INSERT INTO usage.aggregates (workspace_id, metric, period, period_start, total)
    VALUES (${data.workspaceId}, ${data.metric}, 'day', ${dayStart}, ${data.quantity})
    ON CONFLICT (workspace_id, metric, period, period_start)
    DO UPDATE SET total = usage.aggregates.total + EXCLUDED.total
  `;

  // Upsert monthly aggregate
  const monthStart = getPeriodStart(now, "month");
  await sql`
    INSERT INTO usage.aggregates (workspace_id, metric, period, period_start, total)
    VALUES (${data.workspaceId}, ${data.metric}, 'month', ${monthStart}, ${data.quantity})
    ON CONFLICT (workspace_id, metric, period, period_start)
    DO UPDATE SET total = usage.aggregates.total + EXCLUDED.total
  `;
}

/**
 * Get the start of a period as a DATE string (YYYY-MM-DD).
 */
export function getPeriodStart(date: Date, period: "day" | "month"): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");

  if (period === "day") {
    return `${y}-${m}-${d}`;
  }
  // month: first day of month
  return `${y}-${m}-01`;
}
