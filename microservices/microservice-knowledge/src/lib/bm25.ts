import type { Sql } from "postgres";

/**
 * BM25 ranking: Okapi BM25 algorithm for text-only ranking.
 * Alternative/complement to vector similarity search.
 * Uses PostgreSQL's built-in TSVECTOR for efficient full-text search scoring.
 */

export interface BM25Options {
  k1?: number;  // Term frequency saturation (default 1.5)
  b?: number;   // Document length normalization (default 0.75)
}

/** Default BM25 parameters */
export const DEFAULT_BM25_OPTIONS: Required<BM25Options> = {
  k1: 1.5,
  b: 0.75,
};

export interface BM25Chunk {
  id: string;
  content: string;
  chunk_index: number;
  token_count: number | null;
  metadata: any;
  document_id: string;
  document_title: string;
  bm25_score: number;
}

/**
 * Calculate BM25 score for a query against chunks in a collection.
 * Uses PostgreSQL ts_rank_cd (cover density ranking) as an approximation
 * of BM25 when the pg_vector extension is not available, or as a
 * complementary signal alongside vector similarity.
 */
export async function bm25Search(
  sql: Sql,
  collectionId: string,
  query: string,
  limit = 10,
  opts: BM25Options = {},
): Promise<BM25Chunk[]> {
  const { k1, b } = { ...DEFAULT_BM25_OPTIONS, ...opts };

  // Convert query to tsquery
  const tsquery = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `${term}:*`)
    .join(" & ");

  if (!tsquery) {
    return [];
  }

  // Use ts_rank_cd for cover-density ranking (BM25 approximation in PostgreSQL)
  const rows = await sql<Array<{
    id: string;
    content: string;
    chunk_index: number;
    token_count: number | null;
    metadata: any;
    document_id: string;
    document_title: string;
    bm25_score: number;
  }>>`
    SELECT
      c.id,
      c.content,
      c.chunk_index,
      c.token_count,
      c.metadata,
      c.document_id,
      d.title AS document_title,
      ts_rank_cd(
        setweight(to_tsvector('english', c.content), 'A') ||
        setweight(to_tsvector('english', d.title), 'B'),
        to_tsquery('english', ${tsquery}),
        ${b}
      ) AS bm25_score
    FROM knowledge.chunks c
    JOIN knowledge.documents d ON d.id = c.document_id
    WHERE c.collection_id = ${collectionId}
      AND d.status = 'ready'
      AND to_tsvector('english', c.content) @@ to_tsquery('english', ${tsquery})
    ORDER BY bm25_score DESC
    LIMIT ${limit}
  `;

  return rows;
}

/**
 * Hybrid search: combine BM25 and semantic (vector) scores.
 * Uses Reciprocal Rank Fusion (RRF) to merge ranked lists.
 *
 * RRF score = sum(1 / (k + rank)), where k=60 is a constant.
 */
export async function hybridSearch(
  sql: Sql,
  collectionId: string,
  query: string,
  limit = 10,
  semanticWeight = 0.5,
  bm25Weight = 0.5,
): Promise<Array<{
  chunk: BM25Chunk[0];
  score: number;
  semantic_score?: number;
  bm25_score?: number;
}>> {
  const { k1, b } = DEFAULT_BM25_OPTIONS;
  const k = 60; // RRF constant

  // Get BM25 scores
  const bm25Results = await bm25Search(sql, collectionId, query, limit * 2, { k1, b });
  const bm25Map = new Map(bm25Results.map((r, i) => [r.id, { ...r, rank: i + 1 }]));

  // Get semantic scores if pgvector is available
  const hasPgvector = await checkPgvector(sql);
  let semanticMap = new Map<string, { chunk: any; score: number; rank: number }>();

  if (hasPgvector) {
    const { generateEmbedding } = await import("./embeddings.js");
    const embedding = await generateEmbedding(query);
    if (embedding) {
      const embeddingStr = `[${embedding.join(",")}]`;
      const semanticRows = await sql<Array<any>>`
        SELECT
          c.id,
          c.content,
          c.chunk_index,
          c.token_count,
          c.metadata,
          c.document_id,
          d.title AS document_title,
          1 - (c.embedding <=> ${embeddingStr}::vector) AS score
        FROM knowledge.chunks c
        JOIN knowledge.documents d ON d.id = c.document_id
        WHERE c.collection_id = ${collectionId}
          AND d.status = 'ready'
          AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> ${embeddingStr}::vector
        LIMIT ${limit * 2}
      `;
      semanticMap = new Map(
        semanticRows.map((r, i) => [r.id, { chunk: r, score: r.score, rank: i + 1 }])
      );
    }
  }

  // Get all unique chunk IDs
  const allIds = [...new Set([...bm25Map.keys(), ...semanticMap.keys()])];

  // Calculate RRF scores
  const fused: Array<{
    chunk: any;
    score: number;
    semantic_score?: number;
    bm25_score?: number;
  }> = [];

  for (const id of allIds) {
    const bm25Entry = bm25Map.get(id);
    const semanticEntry = semanticMap.get(id);

    const rrfSem = semanticEntry ? 1 / (k + semanticEntry.rank) : 0;
    const rrfBm25 = bm25Entry ? 1 / (k + bm25Entry.rank) : 0;

    const fusedScore = semanticWeight * rrfSem + bm25Weight * rrfBm25;

    if (fusedScore > 0) {
      fused.push({
        chunk: semanticEntry?.chunk ?? bm25Entry!,
        score: fusedScore,
        semantic_score: semanticEntry?.score,
        bm25_score: bm25Entry?.bm25_score,
      });
    }
  }

  // Sort by fused score descending
  fused.sort((a, b) => b.score - a.score);

  return fused.slice(0, limit);
}

async function checkPgvector(sql: any): Promise<boolean> {
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
