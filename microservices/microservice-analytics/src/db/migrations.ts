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
      CREATE TABLE IF NOT EXISTS kpis (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT,
        value REAL NOT NULL,
        period TEXT,
        source_service TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS dashboards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        widgets TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('daily','weekly','monthly','quarterly','annual','custom')),
        content TEXT,
        period TEXT,
        generated_at TEXT NOT NULL DEFAULT (datetime('now')),
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_kpis_name ON kpis(name);
      CREATE INDEX IF NOT EXISTS idx_kpis_category ON kpis(category);
      CREATE INDEX IF NOT EXISTS idx_kpis_recorded_at ON kpis(recorded_at);
      CREATE INDEX IF NOT EXISTS idx_kpis_name_recorded ON kpis(name, recorded_at);
      CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type);
      CREATE INDEX IF NOT EXISTS idx_reports_generated_at ON reports(generated_at);
      CREATE INDEX IF NOT EXISTS idx_dashboards_name ON dashboards(name);
    `,
  },
];
