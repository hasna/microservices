/**
 * PostgreSQL migrations for microservice-llm.
 * All tables live in the `llm` schema.
 */

import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS llm`;

  await sql`
    CREATE TABLE IF NOT EXISTS llm._migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await runMigration(sql, "001_requests_rate_limits", migration001);
}

async function runMigration(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>
): Promise<void> {
  const [existing] = await sql`SELECT id FROM llm._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx) => {
    await fn(tx);
    await tx`INSERT INTO llm._migrations (name) VALUES (${name})`;
  });
}

async function migration001(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE llm.requests (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id     UUID NOT NULL,
      model            TEXT NOT NULL,
      provider         TEXT NOT NULL,
      prompt_tokens    INT NOT NULL DEFAULT 0,
      completion_tokens INT NOT NULL DEFAULT 0,
      total_tokens     INT NOT NULL DEFAULT 0,
      cost_usd         NUMERIC(10,6) NOT NULL DEFAULT 0,
      latency_ms       INT NOT NULL DEFAULT 0,
      cached           BOOLEAN NOT NULL DEFAULT FALSE,
      error            TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX ON llm.requests (workspace_id)`;
  await sql`CREATE INDEX ON llm.requests (created_at)`;
  await sql`CREATE INDEX ON llm.requests (provider)`;
  await sql`CREATE INDEX ON llm.requests (workspace_id, created_at)`;

  await sql`
    CREATE TABLE llm.rate_limits (
      workspace_id        UUID NOT NULL,
      provider            TEXT NOT NULL,
      requests_per_minute INT NOT NULL DEFAULT 60,
      tokens_per_minute   INT NOT NULL DEFAULT 100000,
      PRIMARY KEY (workspace_id, provider)
    )
  `;
}
