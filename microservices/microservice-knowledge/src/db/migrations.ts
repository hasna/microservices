/**
 * PostgreSQL migrations for microservice-knowledge.
 * All tables live in the `knowledge` schema.
 */

import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS knowledge`;

  await sql`
    CREATE TABLE IF NOT EXISTS knowledge._migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await run(sql, "001_collections_documents_chunks", async (sql) => {
    // Try to enable pgvector, fall back gracefully
    try { await sql`CREATE EXTENSION IF NOT EXISTS vector`; } catch {}

    await sql`CREATE TABLE knowledge.collections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      chunk_size INT DEFAULT 1000,
      chunk_overlap INT DEFAULT 200,
      chunking_strategy TEXT DEFAULT 'recursive' CHECK (chunking_strategy IN ('fixed','paragraph','sentence','recursive')),
      embedding_model TEXT DEFAULT 'text-embedding-3-small',
      document_count INT DEFAULT 0,
      chunk_count INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (workspace_id, name)
    )`;

    await sql`CREATE TABLE knowledge.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      collection_id UUID NOT NULL REFERENCES knowledge.collections(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      source_type TEXT DEFAULT 'text' CHECK (source_type IN ('text','url','file')),
      source_url TEXT,
      content TEXT NOT NULL,
      content_hash TEXT,
      metadata JSONB DEFAULT '{}',
      chunk_count INT DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','error')),
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    await sql`CREATE INDEX ON knowledge.documents (collection_id)`;
    await sql`CREATE INDEX ON knowledge.documents (status)`;
    await sql`CREATE INDEX ON knowledge.documents (content_hash)`;

    await sql`CREATE TABLE knowledge.chunks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
      collection_id UUID NOT NULL,
      content TEXT NOT NULL,
      chunk_index INT NOT NULL,
      token_count INT,
      metadata JSONB DEFAULT '{}',
      fts_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    await sql`CREATE INDEX ON knowledge.chunks (document_id)`;
    await sql`CREATE INDEX ON knowledge.chunks (collection_id)`;
    await sql`CREATE INDEX ON knowledge.chunks USING gin(fts_vector)`;

    // Add vector column only if pgvector is available
    try {
      await sql`ALTER TABLE knowledge.chunks ADD COLUMN embedding vector(1536)`;
      await sql`CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding ON knowledge.chunks USING ivfflat (embedding vector_cosine_ops)`;
    } catch {}
  });
}

async function run(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>
): Promise<void> {
  const [existing] = await sql`SELECT id FROM knowledge._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx) => {
    await fn(tx);
    await tx`INSERT INTO knowledge._migrations (name) VALUES (${name})`;
  });
}
