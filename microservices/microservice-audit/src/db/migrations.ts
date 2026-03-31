/**
 * PostgreSQL migrations for microservice-audit.
 * All tables live in the `audit` schema.
 * The events table is append-only — no UPDATE or DELETE by convention.
 */

import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS audit`;

  await sql`
    CREATE TABLE IF NOT EXISTS audit._migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await runMigration(sql, "001_events", migration001);
  await runMigration(sql, "002_retention_policies", migration002);
}

async function runMigration(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>
): Promise<void> {
  const [existing] = await sql`SELECT id FROM audit._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx) => {
    await fn(tx);
    await tx`INSERT INTO audit._migrations (name) VALUES (${name})`;
  });
}

async function migration001(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE audit.events (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_id      UUID,
      actor_type    TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'system', 'api_key')),
      action        TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id   TEXT,
      workspace_id  UUID,
      ip            TEXT,
      user_agent    TEXT,
      metadata      JSONB NOT NULL DEFAULT '{}',
      severity      TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical')),
      checksum      TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX ON audit.events (workspace_id)`;
  await sql`CREATE INDEX ON audit.events (actor_id)`;
  await sql`CREATE INDEX ON audit.events (action)`;
  await sql`CREATE INDEX ON audit.events (resource_type, resource_id)`;
  await sql`CREATE INDEX ON audit.events (created_at)`;
  await sql`CREATE INDEX ON audit.events (severity)`;
}

async function migration002(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE audit.retention_policies (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL UNIQUE,
      retain_days  INT NOT NULL DEFAULT 90,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}
