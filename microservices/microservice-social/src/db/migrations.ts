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
  {
    id: 3,
    name: "add_mentions",
    sql: `
      CREATE TABLE IF NOT EXISTS mentions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        author TEXT,
        author_handle TEXT,
        content TEXT,
        type TEXT CHECK (type IN ('mention', 'reply', 'quote', 'dm')),
        platform_post_id TEXT,
        sentiment TEXT,
        read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT,
        fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_mentions_account ON mentions(account_id);
      CREATE INDEX IF NOT EXISTS idx_mentions_read ON mentions(read);
      CREATE INDEX IF NOT EXISTS idx_mentions_type ON mentions(type);
    `,
  },
  {
    id: 4,
    name: "add_last_metrics_sync",
    sql: `
      ALTER TABLE posts ADD COLUMN last_metrics_sync TEXT;
      CREATE INDEX IF NOT EXISTS idx_posts_last_metrics_sync ON posts(last_metrics_sync);
    `,
  },
  {
    id: 5,
    name: "add_thread_support",
    sql: `
      ALTER TABLE posts ADD COLUMN thread_id TEXT;
      ALTER TABLE posts ADD COLUMN thread_position INTEGER;
      CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id);
    `,
  },
  {
    id: 6,
    name: "add_followers_and_audience_snapshots",
    sql: `
      CREATE TABLE IF NOT EXISTS followers (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        platform_user_id TEXT,
        username TEXT,
        display_name TEXT,
        follower_count INTEGER DEFAULT 0,
        following INTEGER DEFAULT 1,
        followed_at TEXT,
        unfollowed_at TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS audience_snapshots (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        follower_count INTEGER DEFAULT 0,
        following_count INTEGER DEFAULT 0,
        snapshot_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_followers_account ON followers(account_id);
      CREATE INDEX IF NOT EXISTS idx_followers_following ON followers(following);
      CREATE INDEX IF NOT EXISTS idx_snapshots_account ON audience_snapshots(account_id);
    `,
  },
];
