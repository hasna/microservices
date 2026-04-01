/**
 * PostgreSQL migrations for microservice-memory.
 * All tables live in the `memory` schema.
 */

import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS memory`;

  await sql`
    CREATE TABLE IF NOT EXISTS memory._migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await run(sql, "001_collections_memories", async (sql) => {
    // Try to enable pgvector, fall back gracefully
    try {
      await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    } catch {}

    await sql`CREATE TABLE memory.collections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      user_id UUID,
      name TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (workspace_id, name)
    )`;

    await sql`CREATE TABLE memory.memories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      user_id UUID,
      collection_id UUID REFERENCES memory.collections(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      summary TEXT,
      importance REAL DEFAULT 0.5,
      metadata JSONB DEFAULT '{}',
      embedding_text TEXT,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    // Add vector column only if pgvector is available
    try {
      await sql`ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS embedding vector(1536)`;
      await sql`CREATE INDEX IF NOT EXISTS memory_memories_embedding ON memory.memories USING ivfflat (embedding vector_cosine_ops)`;
    } catch {}

    // Always create full-text search index
    await sql`CREATE INDEX IF NOT EXISTS memory_memories_fts ON memory.memories USING gin(to_tsvector('english', content))`;
    await sql`CREATE INDEX ON memory.memories (workspace_id, user_id, created_at DESC)`;
  });
}

async function run(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>,
): Promise<void> {
  const [existing] =
    await sql`SELECT id FROM memory._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx: any) => {
    await fn(tx as any);
    await (tx as any)`INSERT INTO memory._migrations (name) VALUES (${name})`;
  });
}
