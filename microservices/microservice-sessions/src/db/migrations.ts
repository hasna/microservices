/**
 * PostgreSQL migrations for microservice-sessions.
 * All tables live in the `sessions` schema.
 */

import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS sessions`;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions._migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await runMigration(sql, "001_conversations_messages", migration001);
}

async function runMigration(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>
): Promise<void> {
  const [existing] = await sql`SELECT id FROM sessions._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx) => {
    await fn(tx);
    await tx`INSERT INTO sessions._migrations (name) VALUES (${name})`;
  });
}

async function migration001(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE sessions.conversations (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id  UUID NOT NULL,
      user_id       UUID NOT NULL,
      title         TEXT,
      model         TEXT,
      system_prompt TEXT,
      metadata      JSONB NOT NULL DEFAULT '{}',
      is_archived   BOOLEAN NOT NULL DEFAULT false,
      is_pinned     BOOLEAN NOT NULL DEFAULT false,
      total_tokens  INT NOT NULL DEFAULT 0,
      message_count INT NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX ON sessions.conversations (workspace_id, user_id)`;
  await sql`CREATE INDEX ON sessions.conversations (is_archived)`;
  await sql`CREATE INDEX ON sessions.conversations (created_at DESC)`;

  await sql`
    CREATE TABLE sessions.messages (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES sessions.conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
      content         TEXT NOT NULL,
      name            TEXT,
      tool_calls      JSONB,
      tokens          INT NOT NULL DEFAULT 0,
      latency_ms      INT,
      model           TEXT,
      metadata        JSONB NOT NULL DEFAULT '{}',
      is_pinned       BOOLEAN NOT NULL DEFAULT false,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX ON sessions.messages (conversation_id, created_at)`;
  await sql`CREATE INDEX ON sessions.messages (role)`;
  await sql`CREATE INDEX ON sessions.messages USING gin(to_tsvector('english', content))`;
}
