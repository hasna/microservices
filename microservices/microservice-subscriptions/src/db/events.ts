/**
 * Subscription events (audit log)
 */

import { getDatabase } from "./database.js";

// --- Types ---

export interface SubscriptionEvent {
  id: string;
  subscriber_id: string;
  type: "created" | "upgraded" | "downgraded" | "canceled" | "renewed" | "payment_failed" | "paused" | "resumed" | "trial_extended";
  occurred_at: string;
  details: Record<string, unknown>;
}

export interface EventRow {
  id: string;
  subscriber_id: string;
  type: string;
  occurred_at: string;
  details: string;
}

export function rowToEvent(row: EventRow): SubscriptionEvent {
  return {
    ...row,
    type: row.type as SubscriptionEvent["type"],
    details: JSON.parse(row.details || "{}"),
  };
}

// --- Events CRUD ---

export function recordEvent(
  subscriberId: string,
  type: SubscriptionEvent["type"],
  details: Record<string, unknown> = {}
): SubscriptionEvent {
  const db = getDatabase();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO events (id, subscriber_id, type, details) VALUES (?, ?, ?, ?)`
  ).run(id, subscriberId, type, JSON.stringify(details));

  return getEvent(id)!;
}

export function getEvent(id: string): SubscriptionEvent | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRow | null;
  return row ? rowToEvent(row) : null;
}

export interface ListEventsOptions {
  subscriber_id?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

export function listEvents(options: ListEventsOptions = {}): SubscriptionEvent[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.subscriber_id) {
    conditions.push("subscriber_id = ?");
    params.push(options.subscriber_id);
  }

  if (options.type) {
    conditions.push("type = ?");
    params.push(options.type);
  }

  let sql = "SELECT * FROM events";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY occurred_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as EventRow[];
  return rows.map(rowToEvent);
}
