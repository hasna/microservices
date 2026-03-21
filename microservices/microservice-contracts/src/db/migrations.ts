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
      CREATE TABLE IF NOT EXISTS contracts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('nda', 'service', 'employment', 'license', 'other')),
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_signature', 'active', 'expired', 'terminated')),
        counterparty TEXT,
        counterparty_email TEXT,
        start_date TEXT,
        end_date TEXT,
        auto_renew INTEGER NOT NULL DEFAULT 0,
        renewal_period TEXT,
        value REAL,
        currency TEXT NOT NULL DEFAULT 'USD',
        file_path TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS clauses (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        text TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'standard' CHECK (type IN ('standard', 'custom', 'negotiated')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        remind_at TEXT NOT NULL,
        message TEXT NOT NULL,
        sent INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
      CREATE INDEX IF NOT EXISTS idx_contracts_type ON contracts(type);
      CREATE INDEX IF NOT EXISTS idx_contracts_counterparty ON contracts(counterparty);
      CREATE INDEX IF NOT EXISTS idx_contracts_end_date ON contracts(end_date);
      CREATE INDEX IF NOT EXISTS idx_clauses_contract ON clauses(contract_id);
      CREATE INDEX IF NOT EXISTS idx_reminders_contract ON reminders(contract_id);
      CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON reminders(remind_at);
    `,
  },
  {
    id: 2,
    name: "qol_features",
    sql: `
      -- Obligation tracking
      CREATE TABLE IF NOT EXISTS obligations (
        id TEXT PRIMARY KEY,
        clause_id TEXT NOT NULL REFERENCES clauses(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'overdue')),
        assigned_to TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_obligations_clause ON obligations(clause_id);
      CREATE INDEX IF NOT EXISTS idx_obligations_status ON obligations(status);
      CREATE INDEX IF NOT EXISTS idx_obligations_due_date ON obligations(due_date);

      -- Rebuild contracts table to add pending_review status
      CREATE TABLE contracts_new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('nda', 'service', 'employment', 'license', 'other')),
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'pending_signature', 'active', 'expired', 'terminated')),
        counterparty TEXT,
        counterparty_email TEXT,
        start_date TEXT,
        end_date TEXT,
        auto_renew INTEGER NOT NULL DEFAULT 0,
        renewal_period TEXT,
        value REAL,
        currency TEXT NOT NULL DEFAULT 'USD',
        file_path TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO contracts_new SELECT * FROM contracts;
      DROP TABLE contracts;
      ALTER TABLE contracts_new RENAME TO contracts;

      CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
      CREATE INDEX IF NOT EXISTS idx_contracts_type ON contracts(type);
      CREATE INDEX IF NOT EXISTS idx_contracts_counterparty ON contracts(counterparty);
      CREATE INDEX IF NOT EXISTS idx_contracts_end_date ON contracts(end_date);

      -- Contract versions (history)
      CREATE TABLE IF NOT EXISTS contract_versions (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        value REAL,
        metadata_snapshot TEXT NOT NULL DEFAULT '{}',
        changed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_contract_versions_contract ON contract_versions(contract_id);

      -- Signatures
      CREATE TABLE IF NOT EXISTS signatures (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        signer_name TEXT NOT NULL,
        signer_email TEXT,
        signed_at TEXT NOT NULL DEFAULT (datetime('now')),
        method TEXT NOT NULL DEFAULT 'digital' CHECK (method IN ('digital', 'wet', 'docusign'))
      );

      CREATE INDEX IF NOT EXISTS idx_signatures_contract ON signatures(contract_id);

      -- Clause templates (library)
      CREATE TABLE IF NOT EXISTS clause_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        text TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'standard' CHECK (type IN ('standard', 'custom', 'negotiated')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
];
