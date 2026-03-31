/**
 * PostgreSQL migrations for microservice-NAME.
 *
 * Convention:
 *   - All tables live in the `name` schema (e.g. `name.records`)
 *   - Migrations are numbered sequentially and never modified after release
 *   - Run via: microservice-NAME migrate
 */

import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  // Create schema
  await sql`CREATE SCHEMA IF NOT EXISTS name`;

  // Migrations table (tracks applied migrations)
  await sql`
    CREATE TABLE IF NOT EXISTS name._migrations (
      id    SERIAL PRIMARY KEY,
      name  TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await runMigration(sql, "001_initial", migration001);
}

async function runMigration(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>
): Promise<void> {
  const [existing] = await sql`
    SELECT id FROM name._migrations WHERE name = ${name}
  `;
  if (existing) return;

  await sql.begin(async (tx) => {
    await fn(tx);
    await tx`INSERT INTO name._migrations (name) VALUES (${name})`;
  });
}

async function migration001(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE name.records (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      -- ADD YOUR COLUMNS HERE
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}
