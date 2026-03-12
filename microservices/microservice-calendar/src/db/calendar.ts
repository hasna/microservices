/**
 * Calendar CRUD operations
 */

import { getDatabase } from "./database.js";

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  location: string | null;
  calendar: string;
  status: "confirmed" | "tentative" | "cancelled";
  recurrence_rule: string | null;
  reminder_minutes: number | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  all_day: number;
  location: string | null;
  calendar: string;
  status: string;
  recurrence_rule: string | null;
  reminder_minutes: number | null;
  tags: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToEvent(row: EventRow): CalendarEvent {
  return {
    ...row,
    all_day: row.all_day === 1,
    status: row.status as CalendarEvent["status"],
    tags: JSON.parse(row.tags || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface Reminder {
  id: string;
  event_id: string;
  remind_at: string;
  sent: boolean;
  created_at: string;
}

interface ReminderRow {
  id: string;
  event_id: string;
  remind_at: string;
  sent: number;
  created_at: string;
}

function rowToReminder(row: ReminderRow): Reminder {
  return {
    ...row,
    sent: row.sent === 1,
  };
}

// --- Events ---

export interface CreateEventInput {
  title: string;
  description?: string;
  start_at: string;
  end_at?: string;
  all_day?: boolean;
  location?: string;
  calendar?: string;
  status?: CalendarEvent["status"];
  recurrence_rule?: string;
  reminder_minutes?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function createEvent(input: CreateEventInput): CalendarEvent {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const tags = JSON.stringify(input.tags || []);
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO events (id, title, description, start_at, end_at, all_day, location, calendar, status, recurrence_rule, reminder_minutes, tags, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.title,
    input.description || null,
    input.start_at,
    input.end_at || null,
    input.all_day ? 1 : 0,
    input.location || null,
    input.calendar || "default",
    input.status || "confirmed",
    input.recurrence_rule || null,
    input.reminder_minutes ?? null,
    tags,
    metadata
  );

  return getEvent(id)!;
}

export function getEvent(id: string): CalendarEvent | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRow | null;
  return row ? rowToEvent(row) : null;
}

export interface ListEventsOptions {
  from?: string;
  to?: string;
  calendar?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export function listEvents(options: ListEventsOptions = {}): CalendarEvent[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.from) {
    conditions.push("start_at >= ?");
    params.push(options.from);
  }

  if (options.to) {
    conditions.push("start_at <= ?");
    params.push(options.to);
  }

  if (options.calendar) {
    conditions.push("calendar = ?");
    params.push(options.calendar);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  let sql = "SELECT * FROM events";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY start_at ASC";

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

export interface UpdateEventInput {
  title?: string;
  description?: string;
  start_at?: string;
  end_at?: string;
  all_day?: boolean;
  location?: string;
  calendar?: string;
  status?: CalendarEvent["status"];
  recurrence_rule?: string;
  reminder_minutes?: number | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function updateEvent(
  id: string,
  input: UpdateEventInput
): CalendarEvent | null {
  const db = getDatabase();
  const existing = getEvent(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.title !== undefined) {
    sets.push("title = ?");
    params.push(input.title);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.start_at !== undefined) {
    sets.push("start_at = ?");
    params.push(input.start_at);
  }
  if (input.end_at !== undefined) {
    sets.push("end_at = ?");
    params.push(input.end_at);
  }
  if (input.all_day !== undefined) {
    sets.push("all_day = ?");
    params.push(input.all_day ? 1 : 0);
  }
  if (input.location !== undefined) {
    sets.push("location = ?");
    params.push(input.location);
  }
  if (input.calendar !== undefined) {
    sets.push("calendar = ?");
    params.push(input.calendar);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.recurrence_rule !== undefined) {
    sets.push("recurrence_rule = ?");
    params.push(input.recurrence_rule);
  }
  if (input.reminder_minutes !== undefined) {
    sets.push("reminder_minutes = ?");
    params.push(input.reminder_minutes);
  }
  if (input.tags !== undefined) {
    sets.push("tags = ?");
    params.push(JSON.stringify(input.tags));
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE events SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getEvent(id);
}

export function deleteEvent(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM events WHERE id = ?").run(id);
  return result.changes > 0;
}

export function getUpcoming(limit: number = 10): CalendarEvent[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      "SELECT * FROM events WHERE start_at >= datetime('now') AND status != 'cancelled' ORDER BY start_at ASC LIMIT ?"
    )
    .all(limit) as EventRow[];
  return rows.map(rowToEvent);
}

export function getToday(): CalendarEvent[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      "SELECT * FROM events WHERE date(start_at) = date('now') AND status != 'cancelled' ORDER BY start_at ASC"
    )
    .all() as EventRow[];
  return rows.map(rowToEvent);
}

// --- Reminders ---

export interface CreateReminderInput {
  event_id: string;
  remind_at: string;
}

export function createReminder(input: CreateReminderInput): Reminder {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO reminders (id, event_id, remind_at) VALUES (?, ?, ?)`
  ).run(id, input.event_id, input.remind_at);

  const row = db.prepare("SELECT * FROM reminders WHERE id = ?").get(id) as ReminderRow;
  return rowToReminder(row);
}

export function listPendingReminders(): Reminder[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      "SELECT * FROM reminders WHERE sent = 0 AND remind_at <= datetime('now') ORDER BY remind_at ASC"
    )
    .all() as ReminderRow[];
  return rows.map(rowToReminder);
}

export function markReminderSent(id: string): boolean {
  const db = getDatabase();
  const result = db
    .prepare("UPDATE reminders SET sent = 1 WHERE id = ?")
    .run(id);
  return result.changes > 0;
}
