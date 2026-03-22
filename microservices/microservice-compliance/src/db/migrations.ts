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
      CREATE TABLE IF NOT EXISTS requirements (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        framework TEXT CHECK(framework IN ('gdpr','soc2','hipaa','pci','tax','iso27001','custom')),
        status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('compliant','non_compliant','in_progress','not_applicable')),
        description TEXT,
        evidence TEXT,
        due_date TEXT,
        reviewed_at TEXT,
        reviewer TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS licenses (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT CHECK(type IN ('software','business','professional','patent','trademark')),
        issuer TEXT,
        license_number TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','pending_renewal')),
        issued_at TEXT,
        expires_at TEXT,
        auto_renew INTEGER NOT NULL DEFAULT 0,
        cost REAL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS audits (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        framework TEXT,
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','in_progress','completed','failed')),
        findings TEXT NOT NULL DEFAULT '[]',
        auditor TEXT,
        scheduled_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_requirements_framework ON requirements(framework);
      CREATE INDEX IF NOT EXISTS idx_requirements_status ON requirements(status);
      CREATE INDEX IF NOT EXISTS idx_requirements_due_date ON requirements(due_date);
      CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
      CREATE INDEX IF NOT EXISTS idx_licenses_expires_at ON licenses(expires_at);
      CREATE INDEX IF NOT EXISTS idx_audits_framework ON audits(framework);
      CREATE INDEX IF NOT EXISTS idx_audits_status ON audits(status);
    `,
  },
];
