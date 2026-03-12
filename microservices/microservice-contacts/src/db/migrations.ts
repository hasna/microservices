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
      CREATE TABLE IF NOT EXISTS companies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        domain TEXT,
        industry TEXT,
        notes TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT,
        email TEXT,
        phone TEXT,
        company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
        title TEXT,
        notes TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS contact_tags (
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (contact_id, tag)
      );

      CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
      CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
      CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(last_name, first_name);
      CREATE INDEX IF NOT EXISTS idx_contact_tags_tag ON contact_tags(tag);
      CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);
      CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies(domain);
    `,
  },
  {
    id: 2,
    name: "add_relationships",
    sql: `
      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        related_contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'knows',
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (contact_id != related_contact_id),
        UNIQUE(contact_id, related_contact_id, type)
      );

      CREATE INDEX IF NOT EXISTS idx_relationships_contact ON relationships(contact_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_related ON relationships(related_contact_id);
    `,
  },
];
