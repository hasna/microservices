/**
 * PostgreSQL migrations for microservice-usage.
 * All tables live in the `usage` schema.
 * The events table is append-only — no UPDATE or DELETE by convention.
 */

import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS usage`;

  await sql`
    CREATE TABLE IF NOT EXISTS usage._migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await runMigration(sql, "001_events", migration001);
  await runMigration(sql, "002_quotas", migration002);
  await runMigration(sql, "003_aggregates", migration003);
}

async function runMigration(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>
): Promise<void> {
  const [existing] = await sql`SELECT id FROM usage._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx) => {
    await fn(tx);
    await tx`INSERT INTO usage._migrations (name) VALUES (${name})`;
  });
}

async function migration001(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE usage.events (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      metric       TEXT NOT NULL,
      quantity     NUMERIC NOT NULL,
      unit         TEXT DEFAULT 'count',
      metadata     JSONB DEFAULT '{}',
      recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX ON usage.events (workspace_id, metric, recorded_at)`;
  await sql`CREATE INDEX ON usage.events (workspace_id, recorded_at)`;
}

async function migration002(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE usage.quotas (
      workspace_id UUID NOT NULL,
      metric       TEXT NOT NULL,
      limit_value  NUMERIC NOT NULL,
      period       TEXT NOT NULL DEFAULT 'month' CHECK (period IN ('hour', 'day', 'month', 'total')),
      hard_limit   BOOLEAN DEFAULT false,
      PRIMARY KEY (workspace_id, metric, period)
    )
  `;
}

async function migration003(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE usage.aggregates (
      workspace_id  UUID NOT NULL,
      metric        TEXT NOT NULL,
      period        TEXT NOT NULL,
      period_start  DATE NOT NULL,
      total         NUMERIC NOT NULL DEFAULT 0,
      PRIMARY KEY (workspace_id, metric, period, period_start)
    )
  `;
}
