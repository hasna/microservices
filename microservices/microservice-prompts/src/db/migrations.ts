import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS prompts`;
  await sql`CREATE TABLE IF NOT EXISTS prompts._migrations (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await run(sql, "001_prompts_versions", m001);
  await run(sql, "002_overrides", m002);
  await run(sql, "003_experiments_assignments", m003);
}

async function run(sql: Sql, name: string, fn: (sql: Sql) => Promise<void>) {
  const [e] =
    await sql`SELECT id FROM prompts._migrations WHERE name = ${name}`;
  if (e) return;
  await sql.begin(async (tx: any) => {
    await fn(tx as any);
    await (tx as any)`INSERT INTO prompts._migrations (name) VALUES (${name})`;
  });
}

async function m001(sql: Sql) {
  await sql`
    CREATE TABLE prompts.prompts (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id       UUID NOT NULL,
      name               TEXT NOT NULL,
      description        TEXT,
      current_version_id UUID,
      tags               TEXT[] DEFAULT '{}',
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, name)
    )`;
  await sql`CREATE INDEX ON prompts.prompts (workspace_id)`;
  await sql`CREATE INDEX ON prompts.prompts USING gin (tags)`;

  await sql`
    CREATE TABLE prompts.versions (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      prompt_id      UUID NOT NULL REFERENCES prompts.prompts(id) ON DELETE CASCADE,
      version_number INT NOT NULL,
      content        TEXT NOT NULL,
      variables      TEXT[] DEFAULT '{}',
      model          TEXT,
      created_by     TEXT,
      change_note    TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(prompt_id, version_number)
    )`;
  await sql`CREATE INDEX ON prompts.versions (prompt_id, version_number DESC)`;
}

async function m002(sql: Sql) {
  await sql`
    CREATE TABLE prompts.overrides (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      prompt_id  UUID NOT NULL REFERENCES prompts.prompts(id) ON DELETE CASCADE,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('workspace','user','agent')),
      scope_id   TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(prompt_id, scope_type, scope_id)
    )`;
}

async function m003(sql: Sql) {
  await sql`
    CREATE TABLE prompts.experiments (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      prompt_id   UUID NOT NULL REFERENCES prompts.prompts(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','running','completed')),
      variants    JSONB NOT NULL DEFAULT '[]',
      traffic_pct INT NOT NULL DEFAULT 100,
      started_at  TIMESTAMPTZ,
      ended_at    TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE prompts.assignments (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      experiment_id UUID NOT NULL REFERENCES prompts.experiments(id) ON DELETE CASCADE,
      user_id       TEXT NOT NULL,
      variant_name  TEXT NOT NULL,
      assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(experiment_id, user_id)
    )`;
}
