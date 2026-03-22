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
      CREATE TABLE IF NOT EXISTS habits (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        frequency TEXT NOT NULL DEFAULT 'daily' CHECK(frequency IN ('daily', 'weekly', 'monthly')),
        target_count INTEGER NOT NULL DEFAULT 1,
        category TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS completions (
        id TEXT PRIMARY KEY,
        habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
        completed_at TEXT NOT NULL DEFAULT (datetime('now')),
        notes TEXT,
        value REAL
      );

      CREATE TABLE IF NOT EXISTS streaks (
        habit_id TEXT PRIMARY KEY REFERENCES habits(id) ON DELETE CASCADE,
        current_streak INTEGER NOT NULL DEFAULT 0,
        longest_streak INTEGER NOT NULL DEFAULT 0,
        last_completed TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_habits_category ON habits(category);
      CREATE INDEX IF NOT EXISTS idx_habits_active ON habits(active);
      CREATE INDEX IF NOT EXISTS idx_habits_frequency ON habits(frequency);
      CREATE INDEX IF NOT EXISTS idx_completions_habit ON completions(habit_id);
      CREATE INDEX IF NOT EXISTS idx_completions_date ON completions(completed_at);
    `,
  },
];
