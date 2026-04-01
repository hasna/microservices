/**
 * Collection statistics.
 */

import type { Sql } from "postgres";

export interface CollectionStats {
  collection_id: string;
  document_count: number;
  chunk_count: number;
  avg_chunks_per_doc: number;
  total_tokens: number;
}

export async function getCollectionStats(
  sql: Sql,
  collectionId: string,
): Promise<CollectionStats> {
  const [counts] = await sql<
    Array<{ document_count: number; chunk_count: number }>
  >`
    SELECT document_count, chunk_count
    FROM knowledge.collections
    WHERE id = ${collectionId}
  `;

  if (!counts) throw new Error(`Collection not found: ${collectionId}`);

  const [tokenRow] = await sql<Array<{ total_tokens: string }>>`
    SELECT COALESCE(SUM(token_count), 0) AS total_tokens
    FROM knowledge.chunks
    WHERE collection_id = ${collectionId}
  `;

  const docCount = counts.document_count;
  const chunkCount = counts.chunk_count;

  return {
    collection_id: collectionId,
    document_count: docCount,
    chunk_count: chunkCount,
    avg_chunks_per_doc:
      docCount > 0 ? Math.round((chunkCount / docCount) * 100) / 100 : 0,
    total_tokens: Number(tokenRow?.total_tokens ?? 0),
  };
}
