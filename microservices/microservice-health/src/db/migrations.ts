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
      CREATE TABLE IF NOT EXISTS metrics (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT,
        notes TEXT,
        recorded_at TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS medications (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        dosage TEXT,
        frequency TEXT,
        start_date TEXT,
        end_date TEXT,
        refill_date TEXT,
        notes TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS appointments (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        specialty TEXT,
        location TEXT,
        scheduled_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled','rescheduled')),
        notes TEXT,
        follow_up_date TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS fitness_logs (
        id TEXT PRIMARY KEY,
        activity TEXT NOT NULL,
        duration_min INTEGER,
        calories_burned INTEGER,
        distance REAL,
        notes TEXT,
        logged_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_metrics_type ON metrics(type);
      CREATE INDEX IF NOT EXISTS idx_metrics_recorded_at ON metrics(recorded_at);
      CREATE INDEX IF NOT EXISTS idx_medications_active ON medications(active);
      CREATE INDEX IF NOT EXISTS idx_medications_name ON medications(name);
      CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_at ON appointments(scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
      CREATE INDEX IF NOT EXISTS idx_fitness_logs_activity ON fitness_logs(activity);
      CREATE INDEX IF NOT EXISTS idx_fitness_logs_logged_at ON fitness_logs(logged_at);
    `,
  },
];
