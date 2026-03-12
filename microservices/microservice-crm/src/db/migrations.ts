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
      CREATE TABLE IF NOT EXISTS pipelines (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS stages (
        id TEXT PRIMARY KEY,
        pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS deals (
        id TEXT PRIMARY KEY,
        pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
        stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE RESTRICT,
        title TEXT NOT NULL,
        value REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        contact_name TEXT,
        contact_email TEXT,
        probability INTEGER NOT NULL DEFAULT 0,
        expected_close_date TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'won', 'lost')),
        notes TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        closed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS deal_activities (
        id TEXT PRIMARY KEY,
        deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'note' CHECK(type IN ('note', 'call', 'email', 'meeting')),
        description TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_stages_pipeline ON stages(pipeline_id);
      CREATE INDEX IF NOT EXISTS idx_stages_sort ON stages(pipeline_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_deals_pipeline ON deals(pipeline_id);
      CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage_id);
      CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
      CREATE INDEX IF NOT EXISTS idx_deals_contact_email ON deals(contact_email);
      CREATE INDEX IF NOT EXISTS idx_deals_expected_close ON deals(expected_close_date);
      CREATE INDEX IF NOT EXISTS idx_deal_activities_deal ON deal_activities(deal_id);
      CREATE INDEX IF NOT EXISTS idx_pipelines_name ON pipelines(name);
    `,
  },
];
