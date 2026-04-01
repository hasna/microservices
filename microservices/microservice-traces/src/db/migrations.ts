/**
 * PostgreSQL migrations for microservice-traces.
 * All tables live in the `traces` schema.
 */

import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS traces`;

  await sql`
    CREATE TABLE IF NOT EXISTS traces._migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await runMigration(sql, "001_traces", migration001);
  await runMigration(sql, "002_spans", migration002);
}

async function runMigration(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>,
): Promise<void> {
  const [existing] =
    await sql`SELECT id FROM traces._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx: any) => {
    await fn(tx as any);
    await (tx as any)`INSERT INTO traces._migrations (name) VALUES (${name})`;
  });
}

async function migration001(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE traces.traces (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id     UUID NOT NULL,
      name             TEXT NOT NULL,
      status           TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'error')),
      input            JSONB,
      output           JSONB,
      error            TEXT,
      total_tokens     INT DEFAULT 0,
      total_cost_usd   NUMERIC(10,6) DEFAULT 0,
      total_duration_ms INT,
      span_count       INT DEFAULT 0,
      metadata         JSONB DEFAULT '{}',
      started_at       TIMESTAMPTZ DEFAULT NOW(),
      ended_at         TIMESTAMPTZ
    )
  `;

  await sql`CREATE INDEX ON traces.traces (workspace_id, started_at DESC)`;
  await sql`CREATE INDEX ON traces.traces (status)`;
}

async function migration002(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE traces.spans (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trace_id        UUID NOT NULL REFERENCES traces.traces(id) ON DELETE CASCADE,
      parent_span_id  UUID REFERENCES traces.spans(id),
      name            TEXT NOT NULL,
      type            TEXT NOT NULL CHECK (type IN ('llm', 'tool', 'retrieval', 'guardrail', 'embedding', 'custom')),
      status          TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'error')),
      input           JSONB,
      output          JSONB,
      error           TEXT,
      model           TEXT,
      tokens_in       INT,
      tokens_out      INT,
      cost_usd        NUMERIC(10,6),
      duration_ms     INT,
      metadata        JSONB DEFAULT '{}',
      started_at      TIMESTAMPTZ DEFAULT NOW(),
      ended_at        TIMESTAMPTZ
    )
  `;

  await sql`CREATE INDEX ON traces.spans (trace_id, started_at)`;
  await sql`CREATE INDEX ON traces.spans (parent_span_id)`;
  await sql`CREATE INDEX ON traces.spans (type)`;
  await sql`CREATE INDEX ON traces.spans (status)`;
}
