/**
 * PostgreSQL migrations for microservice-waitlist.
 * All tables live in the `waitlist` schema.
 */

import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS waitlist`;

  await sql`
    CREATE TABLE IF NOT EXISTS waitlist._migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await runMigration(sql, "001_campaigns", migration001);
  await runMigration(sql, "002_entries", migration002);
}

async function runMigration(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>
): Promise<void> {
  const [existing] = await sql`SELECT id FROM waitlist._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx) => {
    await fn(tx);
    await tx`INSERT INTO waitlist._migrations (name) VALUES (${name})`;
  });
}

async function migration001(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE waitlist.campaigns (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL UNIQUE,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX ON waitlist.campaigns (status)`;
  await sql`CREATE INDEX ON waitlist.campaigns (created_at)`;
}

async function migration002(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE waitlist.entries (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id    UUID NOT NULL REFERENCES waitlist.campaigns(id) ON DELETE CASCADE,
      email          TEXT NOT NULL,
      name           TEXT,
      referral_code  TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
      referred_by    UUID REFERENCES waitlist.entries(id),
      referral_count INT NOT NULL DEFAULT 0,
      priority_score NUMERIC NOT NULL DEFAULT 0,
      status         TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'invited', 'joined', 'removed')),
      position       INT,
      metadata       JSONB NOT NULL DEFAULT '{}',
      invited_at     TIMESTAMPTZ,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(campaign_id, email)
    )
  `;

  await sql`CREATE INDEX ON waitlist.entries (campaign_id, status)`;
  await sql`CREATE INDEX ON waitlist.entries (referral_code)`;
  await sql`CREATE INDEX ON waitlist.entries (priority_score DESC)`;
  await sql`CREATE INDEX ON waitlist.entries (created_at)`;
}
