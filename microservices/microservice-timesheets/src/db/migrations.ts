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
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        client TEXT,
        hourly_rate REAL NOT NULL DEFAULT 0,
        budget_hours REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'archived')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS time_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        date TEXT NOT NULL DEFAULT (date('now')),
        hours REAL NOT NULL DEFAULT 0,
        billable INTEGER NOT NULL DEFAULT 1,
        tags TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
      CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client);
      CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
      CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries(project_id);
      CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(date);
      CREATE INDEX IF NOT EXISTS idx_time_entries_billable ON time_entries(billable);
    `,
  },
  {
    id: 2,
    name: "locale_and_overtime",
    sql: `
      -- Add locale/currency support to projects
      ALTER TABLE projects ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
      ALTER TABLE projects ADD COLUMN country TEXT NOT NULL DEFAULT 'US';
      ALTER TABLE projects ADD COLUMN overtime_rate_multiplier REAL NOT NULL DEFAULT 1.5;
      ALTER TABLE projects ADD COLUMN max_daily_hours REAL NOT NULL DEFAULT 8;
      ALTER TABLE projects ADD COLUMN max_weekly_hours REAL NOT NULL DEFAULT 40;

      -- Add overtime tracking to time entries
      ALTER TABLE time_entries ADD COLUMN overtime INTEGER NOT NULL DEFAULT 0;

      -- Settings table for global locale preferences
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Seed default settings
      INSERT OR IGNORE INTO settings (key, value) VALUES
        ('locale', 'en-US'),
        ('default_currency', 'USD'),
        ('default_country', 'US'),
        ('date_format', 'YYYY-MM-DD'),
        ('week_start', 'monday');
    `,
  },
];
