import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS teams`;
  await sql`CREATE TABLE IF NOT EXISTS teams._migrations (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await run(sql, "001_workspaces_members", m001);
  await run(sql, "002_invites_roles", m002);
}

async function run(sql: Sql, name: string, fn: (sql: Sql) => Promise<void>) {
  const [e] = await sql`SELECT id FROM teams._migrations WHERE name = ${name}`;
  if (e) return;
  await sql.begin(async (tx: any) => {
    await fn(tx as any);
    await (tx as any)`INSERT INTO teams._migrations (name) VALUES (${name})`;
  });
}

async function m001(sql: Sql) {
  await sql`
    CREATE TABLE teams.workspaces (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL,
      slug        TEXT NOT NULL UNIQUE,
      owner_id    UUID NOT NULL,
      metadata    JSONB NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON teams.workspaces (owner_id)`;
  await sql`CREATE INDEX ON teams.workspaces (slug)`;

  await sql`
    CREATE TABLE teams.members (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES teams.workspaces(id) ON DELETE CASCADE,
      user_id      UUID NOT NULL,
      role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','viewer')),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, user_id)
    )`;
  await sql`CREATE INDEX ON teams.members (workspace_id)`;
  await sql`CREATE INDEX ON teams.members (user_id)`;
}

async function m002(sql: Sql) {
  await sql`
    CREATE TABLE teams.invites (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES teams.workspaces(id) ON DELETE CASCADE,
      email        TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member','viewer')),
      token        TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
      invited_by   UUID NOT NULL,
      accepted_at  TIMESTAMPTZ,
      expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, email)
    )`;
  await sql`CREATE INDEX ON teams.invites (token)`;
  await sql`CREATE INDEX ON teams.invites (workspace_id)`;
}
