import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS flags`;
  await sql`CREATE TABLE IF NOT EXISTS flags._migrations (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await run(sql, "001_flags_rules", m001);
  await run(sql, "002_experiments_overrides", m002);
  await run(sql, "003_flag_history", async (sql) => {
    await sql`
      CREATE TABLE flags.flag_history (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        flag_id    UUID NOT NULL REFERENCES flags.flags(id) ON DELETE CASCADE,
        changed_by TEXT,
        field      TEXT NOT NULL,
        old_value  TEXT,
        new_value  TEXT,
        changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX ON flags.flag_history (flag_id, changed_at DESC)`;
  });
}

async function run(sql: Sql, name: string, fn: (sql: Sql) => Promise<void>) {
  const [e] = await sql`SELECT id FROM flags._migrations WHERE name = ${name}`;
  if (e) return;
  await sql.begin(async tx => { await fn(tx); await tx`INSERT INTO flags._migrations (name) VALUES (${name})`; });
}

async function m001(sql: Sql) {
  await sql`
    CREATE TABLE flags.flags (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key          TEXT NOT NULL UNIQUE,
      name         TEXT NOT NULL,
      description  TEXT,
      type         TEXT NOT NULL DEFAULT 'boolean' CHECK (type IN ('boolean','string','number','json')),
      default_value TEXT NOT NULL DEFAULT 'false',
      enabled      BOOLEAN NOT NULL DEFAULT true,
      workspace_id UUID,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON flags.flags (key)`;
  await sql`CREATE INDEX ON flags.flags (workspace_id)`;

  await sql`
    CREATE TABLE flags.rules (
      id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      flag_id  UUID NOT NULL REFERENCES flags.flags(id) ON DELETE CASCADE,
      name     TEXT,
      type     TEXT NOT NULL CHECK (type IN ('percentage','user_list','attribute','plan')),
      config   JSONB NOT NULL DEFAULT '{}',
      value    TEXT NOT NULL,
      priority INT NOT NULL DEFAULT 0,
      enabled  BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON flags.rules (flag_id, priority DESC)`;
}

async function m002(sql: Sql) {
  await sql`
    CREATE TABLE flags.overrides (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      flag_id      UUID NOT NULL REFERENCES flags.flags(id) ON DELETE CASCADE,
      target_type  TEXT NOT NULL CHECK (target_type IN ('user','workspace')),
      target_id    TEXT NOT NULL,
      value        TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (flag_id, target_type, target_id)
    )`;

  await sql`
    CREATE TABLE flags.experiments (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name         TEXT NOT NULL UNIQUE,
      description  TEXT,
      flag_id      UUID REFERENCES flags.flags(id) ON DELETE SET NULL,
      variants     JSONB NOT NULL DEFAULT '[]',
      traffic_pct  INT NOT NULL DEFAULT 100 CHECK (traffic_pct BETWEEN 0 AND 100),
      status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','paused','completed')),
      started_at   TIMESTAMPTZ,
      ended_at     TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE flags.assignments (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      experiment_id UUID NOT NULL REFERENCES flags.experiments(id) ON DELETE CASCADE,
      user_id       TEXT NOT NULL,
      variant       TEXT NOT NULL,
      assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (experiment_id, user_id)
    )`;
  await sql`CREATE INDEX ON flags.assignments (experiment_id, variant)`;
}
