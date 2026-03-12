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
      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        address TEXT,
        tax_id TEXT,
        notes TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        invoice_number TEXT NOT NULL UNIQUE,
        client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled', 'refunded')),
        issue_date TEXT NOT NULL DEFAULT (date('now')),
        due_date TEXT,
        currency TEXT NOT NULL DEFAULT 'USD',
        subtotal REAL NOT NULL DEFAULT 0,
        tax_rate REAL NOT NULL DEFAULT 0,
        tax_amount REAL NOT NULL DEFAULT 0,
        discount REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        notes TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        paid_at TEXT
      );

      CREATE TABLE IF NOT EXISTS line_items (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1,
        unit_price REAL NOT NULL DEFAULT 0,
        amount REAL NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        method TEXT,
        reference TEXT,
        notes TEXT,
        paid_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS invoice_counter (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        prefix TEXT NOT NULL DEFAULT 'INV',
        next_number INTEGER NOT NULL DEFAULT 1
      );

      INSERT OR IGNORE INTO invoice_counter (id, prefix, next_number) VALUES (1, 'INV', 1);

      CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
      CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
      CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_date);
      CREATE INDEX IF NOT EXISTS idx_line_items_invoice ON line_items(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
      CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
    `,
  },
];
