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
      CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        slug TEXT UNIQUE,
        content TEXT,
        format TEXT NOT NULL DEFAULT 'markdown' CHECK(format IN ('markdown', 'html')),
        category TEXT,
        parent_id TEXT,
        author TEXT,
        status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft', 'published', 'archived')),
        tags TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 1,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS page_versions (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        title TEXT,
        content TEXT,
        author TEXT,
        changed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS page_links (
        source_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        PRIMARY KEY (source_id, target_id)
      );

      CREATE INDEX IF NOT EXISTS idx_pages_slug ON pages(slug);
      CREATE INDEX IF NOT EXISTS idx_pages_category ON pages(category);
      CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id);
      CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status);
      CREATE INDEX IF NOT EXISTS idx_pages_updated ON pages(updated_at);
      CREATE INDEX IF NOT EXISTS idx_page_versions_page ON page_versions(page_id);
      CREATE INDEX IF NOT EXISTS idx_page_links_source ON page_links(source_id);
      CREATE INDEX IF NOT EXISTS idx_page_links_target ON page_links(target_id);
    `,
  },
];
