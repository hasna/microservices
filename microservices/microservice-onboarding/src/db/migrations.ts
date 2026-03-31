/**
 * PostgreSQL migrations for microservice-onboarding.
 * All tables live in the `onboarding` schema.
 */

import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS onboarding`;

  await sql`
    CREATE TABLE IF NOT EXISTS onboarding._migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await runMigration(sql, "001_flows_progress", migration001);
}

async function runMigration(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>
): Promise<void> {
  const [existing] = await sql`SELECT id FROM onboarding._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx) => {
    await fn(tx);
    await tx`INSERT INTO onboarding._migrations (name) VALUES (${name})`;
  });
}

async function migration001(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE onboarding.flows (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL UNIQUE,
      description TEXT,
      steps       JSONB NOT NULL DEFAULT '[]',
      active      BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE onboarding.progress (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id    UUID,
      user_id         UUID NOT NULL,
      flow_id         UUID NOT NULL REFERENCES onboarding.flows(id) ON DELETE CASCADE,
      completed_steps TEXT[] NOT NULL DEFAULT '{}',
      started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at    TIMESTAMPTZ,
      UNIQUE(user_id, flow_id)
    )
  `;

  await sql`CREATE INDEX ON onboarding.progress (user_id)`;
  await sql`CREATE INDEX ON onboarding.progress (workspace_id)`;
  await sql`CREATE INDEX ON onboarding.progress (flow_id)`;
}
