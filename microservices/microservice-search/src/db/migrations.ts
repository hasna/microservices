/**
 * PostgreSQL migrations for microservice-search.
 * All tables live in the `search` schema.
 */

import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS search`;

  await sql`
    CREATE TABLE IF NOT EXISTS search._migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await runMigration(sql, "001_documents", migration001);
  await runMigration(sql, "002_vector_embedding", migration002);
}

async function runMigration(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>,
): Promise<void> {
  const [existing] =
    await sql`SELECT id FROM search._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx: any) => {
    await fn(tx as any);
    await (tx as any)`INSERT INTO search._migrations (name) VALUES (${name})`;
  });
}

async function migration001(sql: Sql): Promise<void> {
  // Try to enable pgvector extension (optional — may not be installed)
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  } catch {}

  await sql`
    CREATE TABLE search.documents (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      collection   TEXT NOT NULL,
      workspace_id UUID,
      doc_id       TEXT NOT NULL,
      content      TEXT NOT NULL,
      metadata     JSONB DEFAULT '{}',
      fts_vector   TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (collection, doc_id)
    )
  `;

  await sql`CREATE INDEX ON search.documents USING gin(fts_vector)`;
  await sql`CREATE INDEX ON search.documents (collection, workspace_id)`;
}

async function migration002(sql: Sql): Promise<void> {
  // pgvector for semantic search — optional, silently skip if not available
  try {
    await sql`ALTER TABLE search.documents ADD COLUMN IF NOT EXISTS embedding vector(1536)`;
    await sql`
      CREATE INDEX IF NOT EXISTS search_docs_embedding
        ON search.documents
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 10)
    `;
  } catch {}
}
