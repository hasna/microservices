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
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('charge', 'refund', 'transfer', 'payout')),
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'disputed', 'refunded')),
        customer_name TEXT,
        customer_email TEXT,
        description TEXT,
        provider TEXT CHECK (provider IN ('stripe', 'square', 'mercury', 'manual')),
        provider_id TEXT,
        invoice_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS disputes (
        id TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'under_review', 'won', 'lost')),
        amount REAL,
        evidence TEXT NOT NULL DEFAULT '{}',
        opened_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS payouts (
        id TEXT PRIMARY KEY,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        destination TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_transit', 'paid', 'failed')),
        initiated_at TEXT NOT NULL DEFAULT (datetime('now')),
        arrived_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
      CREATE INDEX IF NOT EXISTS idx_payments_customer_email ON payments(customer_email);
      CREATE INDEX IF NOT EXISTS idx_payments_provider ON payments(provider);
      CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);
      CREATE INDEX IF NOT EXISTS idx_payments_type ON payments(type);
      CREATE INDEX IF NOT EXISTS idx_disputes_payment_id ON disputes(payment_id);
      CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
      CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
    `,
  },
  {
    id: 2,
    name: "retry_attempts",
    sql: `
      CREATE TABLE IF NOT EXISTS retry_attempts (
        id TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
        attempt INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'succeeded', 'failed')),
        attempted_at TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_retry_attempts_payment_id ON retry_attempts(payment_id);
      CREATE INDEX IF NOT EXISTS idx_retry_attempts_status ON retry_attempts(status);
    `,
  },
];
