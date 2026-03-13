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
  {
    id: 2,
    name: "multi_country_support",
    sql: `
      CREATE TABLE IF NOT EXISTS business_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        address_line1 TEXT,
        address_line2 TEXT,
        city TEXT,
        state TEXT,
        postal_code TEXT,
        country TEXT NOT NULL DEFAULT 'US',
        tax_id TEXT,
        vat_number TEXT,
        registration_number TEXT,
        email TEXT,
        phone TEXT,
        website TEXT,
        bank_name TEXT,
        bank_iban TEXT,
        bank_swift TEXT,
        bank_account TEXT,
        logo_url TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS tax_rules (
        id TEXT PRIMARY KEY,
        country TEXT NOT NULL,
        region TEXT,
        tax_name TEXT NOT NULL,
        rate REAL NOT NULL,
        type TEXT NOT NULL DEFAULT 'vat' CHECK(type IN ('vat', 'sales_tax', 'gst', 'other')),
        is_default INTEGER NOT NULL DEFAULT 0,
        reverse_charge INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Add new columns to invoices
      ALTER TABLE invoices ADD COLUMN business_profile_id TEXT REFERENCES business_profiles(id) ON DELETE SET NULL;
      ALTER TABLE invoices ADD COLUMN tax_name TEXT DEFAULT 'Tax';
      ALTER TABLE invoices ADD COLUMN reverse_charge INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE invoices ADD COLUMN language TEXT NOT NULL DEFAULT 'en';
      ALTER TABLE invoices ADD COLUMN footer_text TEXT;

      -- Add new columns to clients
      ALTER TABLE clients ADD COLUMN address_line1 TEXT;
      ALTER TABLE clients ADD COLUMN address_line2 TEXT;
      ALTER TABLE clients ADD COLUMN city TEXT;
      ALTER TABLE clients ADD COLUMN state TEXT;
      ALTER TABLE clients ADD COLUMN postal_code TEXT;
      ALTER TABLE clients ADD COLUMN country TEXT DEFAULT 'US';
      ALTER TABLE clients ADD COLUMN vat_number TEXT;
      ALTER TABLE clients ADD COLUMN language TEXT DEFAULT 'en';

      -- Add per-line-item tax support
      ALTER TABLE line_items ADD COLUMN tax_rate REAL;
      ALTER TABLE line_items ADD COLUMN tax_amount REAL DEFAULT 0;

      -- Seed default tax rules
      INSERT INTO tax_rules (id, country, tax_name, rate, type, is_default, description) VALUES
        ('tax-ro-vat-19', 'RO', 'TVA', 19, 'vat', 1, 'Romania standard VAT 19%'),
        ('tax-ro-vat-9', 'RO', 'TVA', 9, 'vat', 0, 'Romania reduced VAT 9% (food, hotels)'),
        ('tax-ro-vat-5', 'RO', 'TVA', 5, 'vat', 0, 'Romania reduced VAT 5% (housing)'),
        ('tax-us-none', 'US', 'Sales Tax', 0, 'sales_tax', 1, 'US federal (no federal sales tax)'),
        ('tax-us-ca', 'US', 'Sales Tax', 7.25, 'sales_tax', 0, 'California base sales tax'),
        ('tax-us-ny', 'US', 'Sales Tax', 8, 'sales_tax', 0, 'New York sales tax'),
        ('tax-us-tx', 'US', 'Sales Tax', 6.25, 'sales_tax', 0, 'Texas sales tax'),
        ('tax-uk-vat-20', 'GB', 'VAT', 20, 'vat', 1, 'UK standard VAT 20%'),
        ('tax-uk-vat-5', 'GB', 'VAT', 5, 'vat', 0, 'UK reduced VAT 5%'),
        ('tax-uk-vat-0', 'GB', 'VAT', 0, 'vat', 0, 'UK zero-rated VAT'),
        ('tax-de-vat-19', 'DE', 'MwSt', 19, 'vat', 1, 'Germany standard VAT 19%'),
        ('tax-de-vat-7', 'DE', 'MwSt', 7, 'vat', 0, 'Germany reduced VAT 7%'),
        ('tax-fr-vat-20', 'FR', 'TVA', 20, 'vat', 1, 'France standard VAT 20%'),
        ('tax-fr-vat-10', 'FR', 'TVA', 10, 'vat', 0, 'France reduced VAT 10%'),
        ('tax-fr-vat-55', 'FR', 'TVA', 5.5, 'vat', 0, 'France reduced VAT 5.5%'),
        ('tax-nl-vat-21', 'NL', 'BTW', 21, 'vat', 1, 'Netherlands standard VAT 21%'),
        ('tax-it-vat-22', 'IT', 'IVA', 22, 'vat', 1, 'Italy standard VAT 22%'),
        ('tax-es-vat-21', 'ES', 'IVA', 21, 'vat', 1, 'Spain standard VAT 21%'),
        ('tax-at-vat-20', 'AT', 'USt', 20, 'vat', 1, 'Austria standard VAT 20%'),
        ('tax-be-vat-21', 'BE', 'BTW', 21, 'vat', 1, 'Belgium standard VAT 21%'),
        ('tax-pl-vat-23', 'PL', 'VAT', 23, 'vat', 1, 'Poland standard VAT 23%'),
        ('tax-ie-vat-23', 'IE', 'VAT', 23, 'vat', 1, 'Ireland standard VAT 23%'),
        ('tax-se-vat-25', 'SE', 'Moms', 25, 'vat', 1, 'Sweden standard VAT 25%'),
        ('tax-dk-vat-25', 'DK', 'Moms', 25, 'vat', 1, 'Denmark standard VAT 25%'),
        ('tax-hu-vat-27', 'HU', 'AFA', 27, 'vat', 1, 'Hungary standard VAT 27%'),
        ('tax-bg-vat-20', 'BG', 'DDC', 20, 'vat', 1, 'Bulgaria standard VAT 20%'),
        ('tax-eu-rc', 'EU', 'Reverse Charge', 0, 'vat', 0, 'EU B2B reverse charge mechanism');

      CREATE INDEX IF NOT EXISTS idx_business_profiles_default ON business_profiles(is_default);
      CREATE INDEX IF NOT EXISTS idx_tax_rules_country ON tax_rules(country);
      CREATE INDEX IF NOT EXISTS idx_invoices_business ON invoices(business_profile_id);
    `,
  },
];
