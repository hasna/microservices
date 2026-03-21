export interface MigrationEntry {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: MigrationEntry[] = [
  {
    id: 1,
    name: "core_organization",
    sql: `
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        legal_name TEXT,
        tax_id TEXT,
        address TEXT NOT NULL DEFAULT '{}',
        phone TEXT,
        email TEXT,
        website TEXT,
        industry TEXT,
        currency TEXT NOT NULL DEFAULT 'USD',
        fiscal_year_start TEXT NOT NULL DEFAULT '01-01',
        timezone TEXT NOT NULL DEFAULT 'UTC',
        branding TEXT NOT NULL DEFAULT '{}',
        settings TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        parent_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
        department TEXT,
        cost_center TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        email TEXT,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'manager', 'member', 'viewer')),
        title TEXT,
        permissions TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_teams_org ON teams(org_id);
      CREATE INDEX IF NOT EXISTS idx_teams_parent ON teams(parent_id);
      CREATE INDEX IF NOT EXISTS idx_members_org ON members(org_id);
      CREATE INDEX IF NOT EXISTS idx_members_team ON members(team_id);
      CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);
      CREATE INDEX IF NOT EXISTS idx_members_role ON members(role);
    `,
  },
  {
    id: 2,
    name: "unified_entities",
    sql: `
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        company TEXT,
        address TEXT NOT NULL DEFAULT '{}',
        source TEXT,
        source_ids TEXT NOT NULL DEFAULT '{}',
        tags TEXT NOT NULL DEFAULT '[]',
        lifetime_value REAL NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS vendors (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        company TEXT,
        category TEXT CHECK (category IN ('supplier', 'contractor', 'partner', 'agency')),
        payment_terms TEXT,
        address TEXT NOT NULL DEFAULT '{}',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_customers_org ON customers(org_id);
      CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
      CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
      CREATE INDEX IF NOT EXISTS idx_vendors_org ON vendors(org_id);
      CREATE INDEX IF NOT EXISTS idx_vendors_category ON vendors(category);
      CREATE INDEX IF NOT EXISTS idx_vendors_name ON vendors(name);
    `,
  },
  {
    id: 3,
    name: "workflow_engine",
    sql: `
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        name TEXT NOT NULL,
        trigger_event TEXT NOT NULL,
        steps TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at TEXT,
        run_count INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        trigger_data TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        steps_completed INTEGER NOT NULL DEFAULT 0,
        steps_total INTEGER,
        results TEXT NOT NULL DEFAULT '[]',
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_workflows_trigger ON workflows(trigger_event);
      CREATE INDEX IF NOT EXISTS idx_workflows_org ON workflows(org_id);
      CREATE INDEX IF NOT EXISTS idx_workflows_enabled ON workflows(enabled);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
    `,
  },
  {
    id: 4,
    name: "financial_periods",
    sql: `
      CREATE TABLE IF NOT EXISTS financial_periods (
        id TEXT PRIMARY KEY,
        org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('month', 'quarter', 'year')),
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closing', 'closed')),
        revenue REAL NOT NULL DEFAULT 0,
        expenses REAL NOT NULL DEFAULT 0,
        net_income REAL NOT NULL DEFAULT 0,
        breakdown TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        closed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS budgets (
        id TEXT PRIMARY KEY,
        org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        department TEXT NOT NULL,
        monthly_amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_financial_periods_org ON financial_periods(org_id);
      CREATE INDEX IF NOT EXISTS idx_financial_periods_type ON financial_periods(type);
      CREATE INDEX IF NOT EXISTS idx_financial_periods_status ON financial_periods(status);
      CREATE INDEX IF NOT EXISTS idx_budgets_org ON budgets(org_id);
      CREATE INDEX IF NOT EXISTS idx_budgets_department ON budgets(department);
    `,
  },
  {
    id: 5,
    name: "audit_and_settings",
    sql: `
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        actor TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('create','update','delete','execute','login','approve')),
        service TEXT,
        entity_type TEXT,
        entity_id TEXT,
        details TEXT DEFAULT '{}',
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor);
      CREATE INDEX IF NOT EXISTS idx_audit_service ON audit_log(service);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

      CREATE TABLE IF NOT EXISTS company_settings (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        category TEXT,
        UNIQUE(org_id, key)
      );

      CREATE INDEX IF NOT EXISTS idx_settings_category ON company_settings(category);
    `,
  },
];
