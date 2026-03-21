export interface MigrationEntry {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: MigrationEntry[] = [
  {
    id: 1,
    name: "core_leads",
    sql: `
      CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT,
        phone TEXT,
        company TEXT,
        title TEXT,
        website TEXT,
        linkedin_url TEXT,
        source TEXT DEFAULT 'manual',
        status TEXT DEFAULT 'new' CHECK(status IN ('new','contacted','qualified','unqualified','converted','lost')),
        score INTEGER DEFAULT 0,
        score_reason TEXT,
        tags TEXT DEFAULT '[]',
        notes TEXT,
        metadata TEXT DEFAULT '{}',
        enriched INTEGER DEFAULT 0,
        enriched_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_email ON leads(email) WHERE email IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
      CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(score DESC);
      CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);

      CREATE TABLE IF NOT EXISTS lead_activities (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('email_sent','email_opened','call','meeting','note','status_change','score_change','enriched')),
        description TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_activities_lead ON lead_activities(lead_id);
    `,
  },
  {
    id: 2,
    name: "enrichment_cache",
    sql: `
      CREATE TABLE IF NOT EXISTS enrichment_cache (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        company_data TEXT DEFAULT '{}',
        person_data TEXT DEFAULT '{}',
        social_profiles TEXT DEFAULT '{}',
        tech_stack TEXT DEFAULT '[]',
        company_size TEXT,
        industry TEXT,
        location TEXT,
        revenue_range TEXT,
        fetched_at TEXT,
        source TEXT
      );
    `,
  },
  {
    id: 3,
    name: "lead_lists",
    sql: `
      CREATE TABLE IF NOT EXISTS lead_lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        filter_query TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS lead_list_members (
        lead_list_id TEXT NOT NULL,
        lead_id TEXT NOT NULL,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(lead_list_id, lead_id),
        FOREIGN KEY(lead_list_id) REFERENCES lead_lists(id) ON DELETE CASCADE,
        FOREIGN KEY(lead_id) REFERENCES leads(id) ON DELETE CASCADE
      );
    `,
  },
];
