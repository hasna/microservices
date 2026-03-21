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
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        customer_name TEXT NOT NULL,
        customer_email TEXT,
        address TEXT NOT NULL DEFAULT '{}',
        items TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','shipped','delivered','returned')),
        total_value REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS shipments (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        carrier TEXT NOT NULL CHECK(carrier IN ('ups','fedex','usps','dhl')),
        tracking_number TEXT,
        service TEXT NOT NULL DEFAULT 'ground' CHECK(service IN ('ground','express','overnight')),
        status TEXT NOT NULL DEFAULT 'label_created' CHECK(status IN ('label_created','in_transit','out_for_delivery','delivered','exception')),
        shipped_at TEXT,
        estimated_delivery TEXT,
        delivered_at TEXT,
        cost REAL,
        weight REAL,
        dimensions TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS returns (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','received','refunded')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);
      CREATE INDEX IF NOT EXISTS idx_orders_customer_name ON orders(customer_name);
      CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
      CREATE INDEX IF NOT EXISTS idx_shipments_carrier ON shipments(carrier);
      CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipments(tracking_number);
      CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
      CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(order_id);
      CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status);
    `,
  },
  {
    id: 2,
    name: "add_rma_code",
    sql: `
      ALTER TABLE returns ADD COLUMN rma_code TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_returns_rma_code ON returns(rma_code);
    `,
  },
];
