/**
 * PostgreSQL migrations for microservice-guardrails.
 * All tables live in the `guardrails` schema.
 */

import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS guardrails`;

  await sql`
    CREATE TABLE IF NOT EXISTS guardrails._migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await runMigration(sql, "001_policies", migration001);
  await runMigration(sql, "002_violations", migration002);
  await runMigration(sql, "003_allowlists", migration003);
}

async function runMigration(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>,
): Promise<void> {
  const [existing] =
    await sql`SELECT id FROM guardrails._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx: any) => {
    await fn(tx as any);
    await (tx as any)`INSERT INTO guardrails._migrations (name) VALUES (${name})`;
  });
}

async function migration001(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE guardrails.policies (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      name         TEXT NOT NULL,
      rules        JSONB NOT NULL DEFAULT '[]',
      active       BOOLEAN DEFAULT true,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, name)
    )
  `;
}

async function migration002(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE guardrails.violations (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id    UUID,
      type            TEXT NOT NULL,
      direction       TEXT NOT NULL CHECK (direction IN ('input', 'output')),
      content_snippet TEXT,
      details         JSONB DEFAULT '{}',
      severity        TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX ON guardrails.violations (workspace_id, created_at)`;
  await sql`CREATE INDEX ON guardrails.violations (type)`;
  await sql`CREATE INDEX ON guardrails.violations (severity)`;
}

async function migration003(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE guardrails.allowlists (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      type         TEXT NOT NULL,
      value        TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, type, value)
    )
  `;
}
