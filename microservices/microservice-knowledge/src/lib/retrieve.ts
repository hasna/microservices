/**
 * Retrieval: semantic, text, and hybrid search across chunks.
 */

import type { Sql } from "postgres";
import { generateEmbedding } from "./embeddings.js";

export interface RetrieveOptions {
  limit?: number;
  minScore?: number;
  metadataFilter?: Record<string, unknown>;
  mode?: "semantic" | "text" | "hybrid";
}

export interface RetrievedChunk {
  chunk: {
    id: string;
    content: string;
    chunk_index: number;
    token_count: number | null;
    metadata: Record<string, unknown>;
  };
  score: number;
  document: {
    id: string;
    title: string;
    source_url: string | null;
    source_type: string;
  };
}

export async function retrieve(
  sql: Sql,
  collectionId: string,
  query: string,
  opts: RetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  const limit = opts.limit ?? 10;
  const mode = opts.mode ?? "text";
  const hasPgvector = await checkPgvector(sql);

  if ((mode === "semantic" || mode === "hybrid") && hasPgvector) {
    const embedding = await generateEmbedding(query);
    if (embedding) {
      if (mode === "semantic") {
        return semanticSearch(sql, collectionId, embedding, limit, opts.minScore);
      } else {
        // Hybrid: combine semantic + text, deduplicate
        const [semanticResults, textResults] = await Promise.all([
          semanticSearch(sql, collectionId, embedding, limit, opts.minScore),
          textSearch(sql, collectionId, query, limit),
        ]);
        const seen = new Set<string>();
        const combined: RetrievedChunk[] = [];
        for (const r of [...semanticResults, ...textResults]) {
          if (!seen.has(r.chunk.id)) {
            seen.add(r.chunk.id);
            combined.push(r);
          }
          if (combined.length >= limit) break;
        }
        return combined;
      }
    }
  }

  return textSearch(sql, collectionId, query, limit);
}

async function semanticSearch(
  sql: Sql,
  collectionId: string,
  embedding: number[],
  limit: number,
  minScore?: number
): Promise<RetrievedChunk[]> {
  const embeddingStr = `[${embedding.join(",")}]`;
  const rows = await sql<Array<{
    chunk_id: string;
    chunk_content: string;
    chunk_index: number;
    token_count: number | null;
    chunk_metadata: Record<string, unknown>;
    score: number;
    doc_id: string;
    doc_title: string;
    doc_source_url: string | null;
    doc_source_type: string;
  }>>`
    SELECT
      c.id AS chunk_id,
      c.content AS chunk_content,
      c.chunk_index,
      c.token_count,
      c.metadata AS chunk_metadata,
      1 - (c.embedding <=> ${embeddingStr}::vector) AS score,
      d.id AS doc_id,
      d.title AS doc_title,
      d.source_url AS doc_source_url,
      d.source_type AS doc_source_type
    FROM knowledge.chunks c
    JOIN knowledge.documents d ON d.id = c.document_id
    WHERE c.collection_id = ${collectionId}
      AND c.embedding IS NOT NULL
      AND d.status = 'ready'
    ORDER BY c.embedding <=> ${embeddingStr}::vector
    LIMIT ${limit}
  `;

  return rows
    .filter((r) => !minScore || r.score >= minScore)
    .map((r) => ({
      chunk: {
        id: r.chunk_id,
        content: r.chunk_content,
        chunk_index: r.chunk_index,
        token_count: r.token_count,
        metadata: r.chunk_metadata,
      },
      score: r.score,
      document: {
        id: r.doc_id,
        title: r.doc_title,
        source_url: r.doc_source_url,
        source_type: r.doc_source_type,
      },
    }));
}

async function textSearch(
  sql: Sql,
  collectionId: string,
  query: string,
  limit: number
): Promise<RetrievedChunk[]> {
  const rows = await sql<Array<{
    chunk_id: string;
    chunk_content: string;
    chunk_index: number;
    token_count: number | null;
    chunk_metadata: Record<string, unknown>;
    score: number;
    doc_id: string;
    doc_title: string;
    doc_source_url: string | null;
    doc_source_type: string;
  }>>`
    SELECT
      c.id AS chunk_id,
      c.content AS chunk_content,
      c.chunk_index,
      c.token_count,
      c.metadata AS chunk_metadata,
      ts_rank(c.fts_vector, plainto_tsquery('english', ${query})) AS score,
      d.id AS doc_id,
      d.title AS doc_title,
      d.source_url AS doc_source_url,
      d.source_type AS doc_source_type
    FROM knowledge.chunks c
    JOIN knowledge.documents d ON d.id = c.document_id
    WHERE c.collection_id = ${collectionId}
      AND d.status = 'ready'
      AND c.fts_vector @@ plainto_tsquery('english', ${query})
    ORDER BY score DESC, c.created_at DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    chunk: {
      id: r.chunk_id,
      content: r.chunk_content,
      chunk_index: r.chunk_index,
      token_count: r.token_count,
      metadata: r.chunk_metadata,
    },
    score: r.score,
    document: {
      id: r.doc_id,
      title: r.doc_title,
      source_url: r.doc_source_url,
      source_type: r.doc_source_type,
    },
  }));
}

async function checkPgvector(sql: Sql): Promise<boolean> {
  try {
    const [row] = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'knowledge' AND table_name = 'chunks' AND column_name = 'embedding'
    `;
    return !!row;
  } catch {
    return false;
  }
}
