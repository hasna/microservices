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
    try {
      await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    } catch {}

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
      source_type TEXT DEFAULT 'text' CHECK (source_type IN ('text','url','file','image','audio','video')),
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
      citation_id TEXT,
      source_section TEXT,
      page_number INT,
      mime_type TEXT,
      fts_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    await sql`CREATE INDEX ON knowledge.chunks (document_id)`;
    await sql`CREATE INDEX ON knowledge.chunks (collection_id)`;
    await sql`CREATE INDEX ON knowledge.chunks USING gin(fts_vector)`;
    await sql`CREATE INDEX ON knowledge.chunks (citation_id) WHERE citation_id IS NOT NULL`;

    // Add vector column only if pgvector is available
    try {
      await sql`ALTER TABLE knowledge.chunks ADD COLUMN embedding vector(1536)`;
      await sql`CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding ON knowledge.chunks USING ivfflat (embedding vector_cosine_ops)`;
    } catch {}
  });

  await run(sql, "002_citations_incremental", async (sql) => {
    // Citation tracking: link chunks back to their source document/section
    await sql`ALTER TABLE knowledge.chunks ADD COLUMN IF NOT EXISTS citation_id TEXT`;
    await sql`ALTER TABLE knowledge.chunks ADD COLUMN IF NOT EXISTS source_section TEXT`;
    await sql`ALTER TABLE knowledge.chunks ADD COLUMN IF NOT EXISTS page_number INT`;
    await sql`ALTER TABLE knowledge.chunks ADD COLUMN IF NOT EXISTS mime_type TEXT`;

    // Document version tracking for incremental re-indexing
    await sql`ALTER TABLE knowledge.documents ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1`;
    await sql`ALTER TABLE knowledge.documents ADD COLUMN IF NOT EXISTS last_reindexed_at TIMESTAMPTZ`;

    // Incremental index queue
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge.reindex_queue (
        id SERIAL PRIMARY KEY,
        document_id UUID NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
        error TEXT,
        queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ
      )
    `;
    await sql`CREATE INDEX ON knowledge.reindex_queue (document_id)`;
    await sql`CREATE INDEX ON knowledge.reindex_queue (status) WHERE status = 'pending'`;
  });

  await run(sql, "003_vision_citations_chunking", async (sql) => {
    // Vision chunks for multi-modal documents
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge.vision_chunks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id UUID NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
        image_data BYTEA NOT NULL,
        mime_type TEXT NOT NULL,
        page_number INT,
        width INT,
        height INT,
        extracted_text TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX ON knowledge.vision_chunks (document_id)`;
    await sql`CREATE INDEX ON knowledge.vision_chunks (page_number) WHERE page_number IS NOT NULL`;

    // Citations table for document citation tracking
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge.citations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id UUID NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
        chunk_id UUID NOT NULL REFERENCES knowledge.chunks(id) ON DELETE CASCADE,
        cited_by_document_id UUID NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
        cited_by_chunk_id UUID NOT NULL REFERENCES knowledge.chunks(id) ON DELETE CASCADE,
        quote TEXT,
        context TEXT,
        score FLOAT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX ON knowledge.citations (document_id)`;
    await sql`CREATE INDEX ON knowledge.citations (chunk_id)`;
    await sql`CREATE INDEX ON knowledge.citations (cited_by_document_id)`;
    await sql`CREATE INDEX ON knowledge.citations (cited_by_chunk_id)`;
    await sql`CREATE INDEX ON knowledge.citations (score) WHERE score IS NOT NULL`;

    // Chunking strategy column on documents
    await sql`ALTER TABLE knowledge.documents ADD COLUMN IF NOT EXISTS chunking_strategy TEXT DEFAULT 'recursive' CHECK (chunking_strategy IN ('fixed','paragraph','sentence','recursive'))`;
  });

  await run(sql, "004_versioning_bm25_cross_collection", async (sql) => {
    // Document version history
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge.document_versions (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id      UUID NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
        version_number   INT NOT NULL,
        content          TEXT NOT NULL,
        content_hash     TEXT NOT NULL,
        metadata_snapshot JSONB NOT NULL DEFAULT '{}',
        chunk_count      INT NOT NULL DEFAULT 0,
        reason           TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (document_id, version_number)
      )
    `;
    await sql`CREATE INDEX ON knowledge.document_versions (document_id)`;
    await sql`CREATE INDEX ON knowledge.document_versions (document_id, version_number DESC)`;

    // BM25 index on full-text search
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge.bm25_index (
        chunk_id         UUID PRIMARY KEY REFERENCES knowledge.chunks(id) ON DELETE CASCADE,
        collection_id    UUID NOT NULL,
        token_count      INT NOT NULL DEFAULT 0,
        term_count       INT NOT NULL DEFAULT 0,
        avg_term_freq    NUMERIC(10,6) NOT NULL DEFAULT 0,
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX ON knowledge.bm25_index (collection_id)`;

    // Cross-collection search tracking
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge.cross_collection_searches (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id     UUID NOT NULL,
        query            TEXT NOT NULL,
        collections_searched TEXT[] NOT NULL,
        results_count   INT NOT NULL DEFAULT 0,
        search_latency_ms INT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX ON knowledge.cross_collection_searches (workspace_id)`;
  });

  await run(sql, "005_citation_graph_hybrid_retrieval", async (sql) => {
    // Citation edges for graph traversal (directional: from source to cited document)
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge.citation_edges (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_document_id   UUID NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
        source_chunk_id      UUID NOT NULL REFERENCES knowledge.chunks(id) ON DELETE CASCADE,
        cited_document_id    UUID NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
        cited_chunk_id       UUID NOT NULL REFERENCES knowledge.chunks(id) ON DELETE CASCADE,
        score                FLOAT,
        is_direct            BOOLEAN NOT NULL DEFAULT true,
        depth                INT NOT NULL DEFAULT 1,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (source_document_id, cited_document_id, source_chunk_id, cited_chunk_id)
      )
    `;
    await sql`CREATE INDEX ON knowledge.citation_edges (source_document_id)`;
    await sql`CREATE INDEX ON knowledge.citation_edges (cited_document_id)`;
    await sql`CREATE INDEX ON knowledge.citation_edges (is_direct) WHERE is_direct = true`;

    // Hybrid retrieval cache (semantic + BM25 blended scores)
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge.hybrid_retrieval_cache (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        collection_id    UUID NOT NULL,
        query_hash       TEXT NOT NULL,
        chunk_id         UUID NOT NULL REFERENCES knowledge.chunks(id) ON DELETE CASCADE,
        semantic_score   FLOAT,
        bm25_score       FLOAT,
        hybrid_score     FLOAT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (collection_id, query_hash, chunk_id)
      )
    `;
    await sql`CREATE INDEX ON knowledge.hybrid_retrieval_cache (collection_id)`;
    await sql`CREATE INDEX ON knowledge.hybrid_retrieval_cache (query_hash)`;
  });

  await run(sql, "006_access_log_permissions", async (sql) => {
    // Document access log for audit trails and popularity metrics
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge.document_access_log (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id     UUID NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
        chunk_id        UUID REFERENCES knowledge.chunks(id) ON DELETE SET NULL,
        accessed_by     UUID,
        access_type     TEXT NOT NULL DEFAULT 'read'
          CHECK (access_type IN ('read', 'search', 'retrieve', 'embed')),
        ip_address      TEXT,
        user_agent      TEXT,
        response_time_ms REAL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX ON knowledge.document_access_log (document_id)`;
    await sql`CREATE INDEX ON knowledge.document_access_log (chunk_id) WHERE chunk_id IS NOT NULL`;
    await sql`CREATE INDEX ON knowledge.document_access_log (created_at DESC)`;
    await sql`CREATE INDEX ON knowledge.document_access_log (access_type)`;

    // Collection permissions (cross-workspace sharing)
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge.collection_shares (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        collection_id   UUID NOT NULL REFERENCES knowledge.collections(id) ON DELETE CASCADE,
        workspace_id    UUID NOT NULL,
        permission      TEXT NOT NULL DEFAULT 'read'
          CHECK (permission IN ('read', 'write', 'admin')),
        shared_by       UUID,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (collection_id, workspace_id)
      )
    `;
    await sql`CREATE INDEX ON knowledge.collection_shares (collection_id)`;
    await sql`CREATE INDEX ON knowledge.collection_shares (workspace_id)`;
  });

  await run(sql, "007_indexing_jobs_citation_provenance", async (sql) => {
    // Background indexing job queue
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge.indexing_jobs (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id     UUID NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
        workspace_id    UUID NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
        priority        TEXT NOT NULL DEFAULT 'normal'
          CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
        attempts        INT NOT NULL DEFAULT 0,
        max_attempts    INT NOT NULL DEFAULT 3,
        error           TEXT,
        queued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at      TIMESTAMPTZ,
        completed_at    TIMESTAMPTZ
      )
    `;
    await sql`CREATE INDEX ON knowledge.indexing_jobs (workspace_id)`;
    await sql`CREATE INDEX ON knowledge.indexing_jobs (status, priority) WHERE status = 'pending'`;
    await sql`CREATE INDEX ON knowledge.indexing_jobs (document_id)`;

    // Citation provenance tracking (extends the citations table)
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge.citation_provenance (
        citation_id         UUID PRIMARY KEY REFERENCES knowledge.citations(id) ON DELETE CASCADE,
        source_chunk_id     UUID NOT NULL REFERENCES knowledge.chunks(id) ON DELETE CASCADE,
        target_chunk_id     UUID NOT NULL REFERENCES knowledge.chunks(id) ON DELETE CASCADE,
        confidence          TEXT NOT NULL DEFAULT 'unverified'
          CHECK (confidence IN ('high', 'medium', 'low', 'unverified')),
        verification_status TEXT NOT NULL DEFAULT 'unverified'
          CHECK (verification_status IN ('verified', 'disputed', 'unverified', 'retracted')),
        verification_notes  TEXT,
        chain_depth         INT NOT NULL DEFAULT 1,
        is_circular         BOOLEAN NOT NULL DEFAULT FALSE,
        trust_score         INT NOT NULL DEFAULT 50 CHECK (trust_score >= 0 AND trust_score <= 100),
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX ON knowledge.citation_provenance (source_chunk_id)`;
    await sql`CREATE INDEX ON knowledge.citation_provenance (target_chunk_id)`;
    await sql`CREATE INDEX ON knowledge.citation_provenance (verification_status)`;
    await sql`CREATE INDEX ON knowledge.citation_provenance (trust_score DESC)`;
  });

  await run(sql, "009_search_analytics", async (sql) => {
    // Search analytics: track queries, result counts, and citation click-throughs
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge.search_analytics_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        collection_id UUID NOT NULL REFERENCES knowledge.collections(id) ON DELETE CASCADE,
        workspace_id UUID NOT NULL,
        query_text TEXT NOT NULL,
        query_hash TEXT NOT NULL,
        result_count INT NOT NULL DEFAULT 0,
        mode TEXT NOT NULL DEFAULT 'text' CHECK (mode IN ('semantic','text','hybrid')),
        response_time_ms INT,
        cited_document_ids UUID[],
        clicked_document_ids UUID[],
        accessed_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX ON knowledge.search_analytics_log (collection_id, created_at DESC)`;
    await sql`CREATE INDEX ON knowledge.search_analytics_log (workspace_id, created_at DESC)`;
    await sql`CREATE INDEX ON knowledge.search_analytics_log (query_hash)`;

    // Document priority: boost certain documents in retrieval results
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge.document_priority (
        document_id UUID PRIMARY KEY REFERENCES knowledge.documents(id) ON DELETE CASCADE,
        priority_score FLOAT NOT NULL DEFAULT 0.0,
        reason TEXT,
        set_by TEXT,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX ON knowledge.document_priority (priority_score DESC)`;
    await sql`CREATE INDEX ON knowledge.document_priority (expires_at) WHERE expires_at IS NOT NULL`;
  });

  await run(sql, "008_incremental_checkpoints_multimodal_citation_types", async (sql) => {
    // Incremental index checkpoints — track per-document indexed versions
    // to enable chunk-level delta updates instead of full re-index
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge.index_checkpoints (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id UUID NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
        version INT NOT NULL DEFAULT 1,
        content_hash TEXT NOT NULL,
        chunk_count INT NOT NULL DEFAULT 0,
        total_tokens INT NOT NULL DEFAULT 0,
        indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (document_id, version)
      )
    `;
    await sql`CREATE INDEX ON knowledge.index_checkpoints (document_id, version DESC)`;
    await sql`CREATE INDEX ON knowledge.index_checkpoints (content_hash)`;

    // Delta chunks: only changed portions since last checkpoint
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge.delta_chunks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        checkpoint_id UUID NOT NULL REFERENCES knowledge.index_checkpoints(id) ON DELETE CASCADE,
        chunk_id UUID REFERENCES knowledge.chunks(id) ON DELETE CASCADE,
        delta_type TEXT NOT NULL CHECK (delta_type IN ('insert', 'update', 'delete')),
        chunk_sequence INT NOT NULL,
        old_content_hash TEXT,
        new_content_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX ON knowledge.delta_chunks (checkpoint_id)`;

    // Multi-modal enrichment: extend vision_chunks with extracted metadata
    await sql`ALTER TABLE knowledge.vision_chunks ADD COLUMN IF NOT EXISTS alt_text TEXT`;
    await sql`ALTER TABLE knowledge.vision_chunks ADD COLUMN IF NOT EXISTS caption TEXT`;
    await sql`ALTER TABLE knowledge.vision_chunks ADD COLUMN IF NOT EXISTS dominant_colors TEXT[]`;
    await sql`ALTER TABLE knowledge.vision_chunks ADD COLUMN IF NOT EXISTS scene_text TEXT`;
    await sql`ALTER TABLE knowledge.vision_chunks ADD COLUMN IF NOT EXISTS is_processed BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE knowledge.vision_chunks ADD COLUMN IF NOT EXISTS processing_version TEXT`;
    await sql`CREATE INDEX ON knowledge.vision_chunks (is_processed) WHERE is_processed = false`;

    // Citation type classification + section anchors for navigation
    await sql`ALTER TABLE knowledge.citations ADD COLUMN IF NOT EXISTS citation_type TEXT NOT NULL DEFAULT 'reference' CHECK (citation_type IN ('inline', 'footnote', 'paraphrase', 'reference'))`;
    await sql`ALTER TABLE knowledge.citations ADD COLUMN IF NOT EXISTS section_anchor TEXT`;
    await sql`ALTER TABLE knowledge.citations ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false`;
    await sql`CREATE INDEX ON knowledge.citations (citation_type)`;
    await sql`CREATE INDEX ON knowledge.citations (section_anchor) WHERE section_anchor IS NOT NULL`;
  });
}

async function run(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>,
): Promise<void> {
  const [existing] =
    await sql`SELECT id FROM knowledge._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx: any) => {
    await fn(tx as any);
    await (tx as any)`INSERT INTO knowledge._migrations (name) VALUES (${name})`;
  });
}
