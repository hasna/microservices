import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS agents`;
  await sql`CREATE TABLE IF NOT EXISTS agents._migrations (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await run(sql, "001_agents", m001);
  await run(sql, "002_messages", m002);
  await run(sql, "003_tasks", m003);
}

async function run(sql: Sql, name: string, fn: (sql: Sql) => Promise<void>) {
  const [e] = await sql`SELECT id FROM agents._migrations WHERE name = ${name}`;
  if (e) return;
  await sql.begin(async (tx: any) => {
    await fn(tx as any);
    await (tx as any)`INSERT INTO agents._migrations (name) VALUES (${name})`;
  });
}

async function m001(sql: Sql) {
  await sql`
    CREATE TABLE agents.agents (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id         UUID NOT NULL,
      name                 TEXT NOT NULL,
      description          TEXT,
      model                TEXT,
      version              TEXT DEFAULT '1.0.0',
      status               TEXT DEFAULT 'idle' CHECK (status IN ('active','idle','stopped','error')),
      capabilities         TEXT[] DEFAULT '{}',
      config               JSONB DEFAULT '{}',
      max_concurrent       INT DEFAULT 1,
      current_load         INT DEFAULT 0,
      last_heartbeat_at    TIMESTAMPTZ,
      last_error           TEXT,
      total_tasks_completed INT DEFAULT 0,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, name)
    )`;
  await sql`CREATE INDEX ON agents.agents (workspace_id, status)`;
  await sql`CREATE INDEX ON agents.agents USING GIN (capabilities)`;
  await sql`CREATE INDEX ON agents.agents (last_heartbeat_at)`;
}

async function m002(sql: Sql) {
  await sql`
    CREATE TABLE agents.messages (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id   UUID NOT NULL,
      from_agent_id  UUID REFERENCES agents.agents(id) ON DELETE SET NULL,
      to_agent_id    UUID NOT NULL REFERENCES agents.agents(id) ON DELETE CASCADE,
      type           TEXT NOT NULL,
      payload        JSONB NOT NULL,
      status         TEXT DEFAULT 'pending' CHECK (status IN ('pending','delivered','read')),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON agents.messages (to_agent_id, status, created_at)`;
  await sql`CREATE INDEX ON agents.messages (from_agent_id)`;
}

async function m003(sql: Sql) {
  await sql`
    CREATE TABLE agents.tasks (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id        UUID NOT NULL,
      type                TEXT NOT NULL,
      payload             JSONB DEFAULT '{}',
      required_capability TEXT,
      assigned_to         UUID REFERENCES agents.agents(id),
      status              TEXT DEFAULT 'pending' CHECK (status IN ('pending','assigned','running','completed','failed')),
      result              JSONB,
      error               TEXT,
      priority            INT DEFAULT 0,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at        TIMESTAMPTZ
    )`;
  await sql`CREATE INDEX ON agents.tasks (workspace_id, status)`;
  await sql`CREATE INDEX ON agents.tasks (assigned_to)`;
  await sql`CREATE INDEX ON agents.tasks (required_capability)`;
  await sql`CREATE INDEX ON agents.tasks (priority DESC)`;
}
