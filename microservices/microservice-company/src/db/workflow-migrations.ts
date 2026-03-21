export interface MigrationEntry {
  id: number;
  name: string;
  sql: string;
}

export const WORKFLOW_MIGRATION: MigrationEntry = {
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
};
