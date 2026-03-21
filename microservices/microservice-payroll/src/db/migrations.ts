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
      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        type TEXT NOT NULL DEFAULT 'employee' CHECK (type IN ('employee', 'contractor')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'terminated')),
        department TEXT,
        title TEXT,
        pay_rate REAL NOT NULL,
        pay_type TEXT NOT NULL DEFAULT 'salary' CHECK (pay_type IN ('salary', 'hourly')),
        currency TEXT NOT NULL DEFAULT 'USD',
        tax_info TEXT NOT NULL DEFAULT '{}',
        start_date TEXT,
        end_date TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS pay_periods (
        id TEXT PRIMARY KEY,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'completed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS pay_stubs (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        pay_period_id TEXT NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
        gross_pay REAL NOT NULL DEFAULT 0,
        deductions TEXT NOT NULL DEFAULT '{}',
        net_pay REAL NOT NULL DEFAULT 0,
        hours_worked REAL,
        overtime_hours REAL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        pay_stub_id TEXT NOT NULL REFERENCES pay_stubs(id) ON DELETE CASCADE,
        method TEXT NOT NULL DEFAULT 'direct_deposit' CHECK (method IN ('direct_deposit', 'check', 'wire')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
        paid_at TEXT,
        reference TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);
      CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
      CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);
      CREATE INDEX IF NOT EXISTS idx_pay_stubs_employee ON pay_stubs(employee_id);
      CREATE INDEX IF NOT EXISTS idx_pay_stubs_period ON pay_stubs(pay_period_id);
      CREATE INDEX IF NOT EXISTS idx_payments_stub ON payments(pay_stub_id);
      CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
    `,
  },
  {
    id: 2,
    name: "benefits_and_schedule",
    sql: `
      CREATE TABLE IF NOT EXISTS benefits (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('health', 'dental', 'vision', 'retirement', 'hsa', 'other')),
        description TEXT,
        amount REAL NOT NULL,
        frequency TEXT NOT NULL DEFAULT 'per_period' CHECK (frequency IN ('per_period', 'monthly', 'annual')),
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS payroll_schedule (
        id TEXT PRIMARY KEY,
        frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'semimonthly', 'monthly')),
        anchor_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_benefits_employee ON benefits(employee_id);
      CREATE INDEX IF NOT EXISTS idx_benefits_active ON benefits(active);
    `,
  },
];
