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
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        interval TEXT NOT NULL DEFAULT 'monthly' CHECK (interval IN ('monthly', 'yearly', 'lifetime')),
        features TEXT NOT NULL DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS subscribers (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired')),
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        trial_ends_at TEXT,
        current_period_start TEXT NOT NULL DEFAULT (datetime('now')),
        current_period_end TEXT,
        canceled_at TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('created', 'upgraded', 'downgraded', 'canceled', 'renewed', 'payment_failed')),
        occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
        details TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(active);
      CREATE INDEX IF NOT EXISTS idx_subscribers_plan ON subscribers(plan_id);
      CREATE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(customer_email);
      CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);
      CREATE INDEX IF NOT EXISTS idx_subscribers_period_end ON subscribers(current_period_end);
      CREATE INDEX IF NOT EXISTS idx_events_subscriber ON events(subscriber_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_occurred ON events(occurred_at);
    `,
  },
];
