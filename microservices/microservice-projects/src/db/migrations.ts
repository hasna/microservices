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
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        client TEXT,
        status TEXT NOT NULL DEFAULT 'planning' CHECK(status IN ('planning','active','on_hold','completed','cancelled')),
        budget REAL,
        spent REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        start_date TEXT,
        end_date TEXT,
        owner TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS milestones (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','missed')),
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS deliverables (
        id TEXT PRIMARY KEY,
        milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','review','completed')),
        assignee TEXT,
        due_date TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
      CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client);
      CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner);
      CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);
      CREATE INDEX IF NOT EXISTS idx_milestones_status ON milestones(status);
      CREATE INDEX IF NOT EXISTS idx_milestones_due_date ON milestones(due_date);
      CREATE INDEX IF NOT EXISTS idx_deliverables_milestone ON deliverables(milestone_id);
      CREATE INDEX IF NOT EXISTS idx_deliverables_status ON deliverables(status);
      CREATE INDEX IF NOT EXISTS idx_deliverables_assignee ON deliverables(assignee);
    `,
  },
];
