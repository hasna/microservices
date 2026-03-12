export interface MigrationEntry {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: MigrationEntry[] = [
  {
    id: 1,
    name: "initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        start_at TEXT NOT NULL,
        end_at TEXT,
        all_day INTEGER NOT NULL DEFAULT 0,
        location TEXT,
        calendar TEXT NOT NULL DEFAULT 'default',
        status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'tentative', 'cancelled')),
        recurrence_rule TEXT,
        reminder_minutes INTEGER,
        tags TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        remind_at TEXT NOT NULL,
        sent INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at);
      CREATE INDEX IF NOT EXISTS idx_events_end ON events(end_at);
      CREATE INDEX IF NOT EXISTS idx_events_calendar ON events(calendar);
      CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
      CREATE INDEX IF NOT EXISTS idx_reminders_event ON reminders(event_id);
      CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON reminders(remind_at);
      CREATE INDEX IF NOT EXISTS idx_reminders_sent ON reminders(sent);
    `,
  },
];
