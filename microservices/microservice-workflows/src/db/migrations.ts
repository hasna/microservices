import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS workflows`;
  await sql`CREATE TABLE IF NOT EXISTS workflows._migrations (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await run(sql, "001_definitions", m001);
  await run(sql, "002_executions", m002);
  await run(sql, "003_nodes", m003);
  await run(sql, "004_step_events", m004);
}

async function run(sql: Sql, name: string, fn: (sql: Sql) => Promise<void>) {
  const [e] = await sql`SELECT id FROM workflows._migrations WHERE name = ${name}`;
  if (e) return;
  await sql.begin(async (tx: any) => {
    await fn(tx as any);
    await (tx as any)`INSERT INTO workflows._migrations (name) VALUES (${name})`;
  });
}

async function m001(sql: Sql) {
  // Workflow definitions — DAG templates
  await sql`
    CREATE TABLE workflows.workflows (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id    UUID NOT NULL,
      name            TEXT NOT NULL,
      description     TEXT,
      definition      JSONB NOT NULL, -- { nodes: [{id, type, config}], edges: [{from, to}] }
      version         INT DEFAULT 1,
      is_latest       BOOLEAN DEFAULT true,
      created_by      UUID,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, name, version)
    )`;
  await sql`CREATE INDEX ON workflows.workflows (workspace_id, name, is_latest)`;
}

async function m002(sql: Sql) {
  // Workflow executions — instances of a workflow run
  await sql`
    CREATE TABLE workflows.executions (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id      UUID NOT NULL,
      workflow_id       UUID NOT NULL REFERENCES workflows.workflows(id),
      workflow_version  INT NOT NULL,
      status            TEXT DEFAULT 'pending' CHECK (status IN ('pending','running','waiting','completed','failed','cancelled')),
      trigger_type      TEXT DEFAULT 'manual', -- manual, webhook, schedule, event
      trigger_payload   JSONB DEFAULT '{}',
      context           JSONB DEFAULT '{}', -- top-level workflow context passed through nodes
      result            JSONB,
      error             TEXT,
      started_at        TIMESTAMPTZ,
      completed_at      TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON workflows.executions (workspace_id, status)`;
  await sql`CREATE INDEX ON workflows.executions (workflow_id)`;
}

async function m003(sql: Sql) {
  // Node execution states — each node in the DAG has a state per execution
  await sql`
    CREATE TABLE workflows.node_executions (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      execution_id      UUID NOT NULL REFERENCES workflows.executions(id) ON DELETE CASCADE,
      node_id           TEXT NOT NULL, -- matches definition node id
      status            TEXT DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','skipped','waiting')),
      input             JSONB DEFAULT '{}',
      output            JSONB,
      error             TEXT,
      attempt           INT DEFAULT 0,
      max_attempts      INT DEFAULT 3,
      started_at        TIMESTAMPTZ,
      completed_at      TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON workflows.node_executions (execution_id, node_id)`;
  await sql`CREATE INDEX ON workflows.node_executions (execution_id, status)`;
}

async function m004(sql: Sql) {
  // Step events — fan-out/fan-in tracking for parallel branches
  await sql`
    CREATE TABLE workflows.step_events (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      execution_id      UUID NOT NULL REFERENCES workflows.executions(id) ON DELETE CASCADE,
      node_id           TEXT NOT NULL,
      event_type        TEXT NOT NULL, -- branch_started, branch_completed, branch_failed
      branch_id         TEXT,
      payload           JSONB DEFAULT '{}',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON workflows.step_events (execution_id, node_id)`;
}
