import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS jobs`;
  await sql`CREATE TABLE IF NOT EXISTS jobs._migrations (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await run(sql, "001_jobs_queues", m001);
  await run(sql, "002_schedules_deadletter", m002);
}

async function run(sql: Sql, name: string, fn: (sql: Sql) => Promise<void>) {
  const [e] = await sql`SELECT id FROM jobs._migrations WHERE name = ${name}`;
  if (e) return;
  await sql.begin(async tx => { await fn(tx); await tx`INSERT INTO jobs._migrations (name) VALUES (${name})`; });
}

async function m001(sql: Sql) {
  await sql`
    CREATE TABLE jobs.jobs (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      queue         TEXT NOT NULL DEFAULT 'default',
      type          TEXT NOT NULL,
      payload       JSONB NOT NULL DEFAULT '{}',
      status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
      priority      INT NOT NULL DEFAULT 0,
      attempts      INT NOT NULL DEFAULT 0,
      max_attempts  INT NOT NULL DEFAULT 3,
      run_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at    TIMESTAMPTZ,
      completed_at  TIMESTAMPTZ,
      failed_at     TIMESTAMPTZ,
      error         TEXT,
      result        JSONB,
      worker_id     TEXT,
      workspace_id  UUID,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON jobs.jobs (queue, status, priority DESC, run_at) WHERE status = 'pending'`;
  await sql`CREATE INDEX ON jobs.jobs (status, created_at)`;
  await sql`CREATE INDEX ON jobs.jobs (workspace_id, created_at)`;
  await sql`CREATE INDEX ON jobs.jobs (type, status)`;
}

async function m002(sql: Sql) {
  await sql`
    CREATE TABLE jobs.schedules (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL UNIQUE,
      cron        TEXT NOT NULL,
      queue       TEXT NOT NULL DEFAULT 'default',
      type        TEXT NOT NULL,
      payload     JSONB NOT NULL DEFAULT '{}',
      enabled     BOOLEAN NOT NULL DEFAULT true,
      last_run_at TIMESTAMPTZ,
      next_run_at TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE jobs.dead_letter (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id      UUID NOT NULL,
      queue       TEXT NOT NULL,
      type        TEXT NOT NULL,
      payload     JSONB NOT NULL,
      error       TEXT,
      attempts    INT NOT NULL,
      failed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON jobs.dead_letter (queue, failed_at)`;
}
