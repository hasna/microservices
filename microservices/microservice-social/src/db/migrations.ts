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
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL CHECK (platform IN ('x', 'linkedin', 'instagram', 'threads', 'bluesky')),
        handle TEXT NOT NULL,
        display_name TEXT,
        connected INTEGER NOT NULL DEFAULT 0,
        access_token_env TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        media_urls TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published', 'failed')),
        scheduled_at TEXT,
        published_at TEXT,
        platform_post_id TEXT,
        engagement TEXT NOT NULL DEFAULT '{}',
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        variables TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_accounts_platform ON accounts(platform);
      CREATE INDEX IF NOT EXISTS idx_accounts_handle ON accounts(handle);
      CREATE INDEX IF NOT EXISTS idx_posts_account ON posts(account_id);
      CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
      CREATE INDEX IF NOT EXISTS idx_posts_scheduled ON posts(scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published_at);
      CREATE INDEX IF NOT EXISTS idx_templates_name ON templates(name);
    `,
  },
  {
    id: 2,
    name: "add_pending_review_and_recurrence",
    sql: `
      -- Recreate posts table with expanded status enum and recurrence column.
      -- SQLite doesn't support ALTER CHECK constraints, so we recreate the table.
      CREATE TABLE IF NOT EXISTS posts_new (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        media_urls TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published', 'failed', 'pending_review')),
        scheduled_at TEXT,
        published_at TEXT,
        platform_post_id TEXT,
        engagement TEXT NOT NULL DEFAULT '{}',
        tags TEXT NOT NULL DEFAULT '[]',
        recurrence TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO posts_new SELECT id, account_id, content, media_urls, status, scheduled_at, published_at, platform_post_id, engagement, tags, NULL, created_at, updated_at FROM posts;
      DROP TABLE posts;
      ALTER TABLE posts_new RENAME TO posts;

      CREATE INDEX IF NOT EXISTS idx_posts_account ON posts(account_id);
      CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
      CREATE INDEX IF NOT EXISTS idx_posts_scheduled ON posts(scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published_at);
      CREATE INDEX IF NOT EXISTS idx_posts_recurrence ON posts(recurrence);
    `,
  },
];
