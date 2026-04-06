/**
 * Citation tracking: link chunks and documents through citation relationships.
 */

import type { Sql } from "postgres";

export interface Citation {
  id: string;
  document_id: string;
  chunk_id: string;
  cited_by_document_id: string;
  cited_by_chunk_id: string;
  quote: string | null;
  context: string | null;
  score: number | null;
  created_at: Date;
}

export interface AddCitationInput {
  documentId: string;
  chunkId: string;
  citedByDocumentId: string;
  citedByChunkId: string;
  quote?: string | null;
  context?: string | null;
  score?: number | null;
}

/**
 * Add a citation relationship between two chunks/documents.
 */
export async function addCitation(
  sql: Sql,
  input: AddCitationInput,
): Promise<Citation> {
  const [citation] = await sql<Citation[]>`
    INSERT INTO knowledge.citations (
      document_id, chunk_id, cited_by_document_id, cited_by_chunk_id,
      quote, context, score
    )
    VALUES (
      ${input.documentId},
      ${input.chunkId},
      ${input.citedByDocumentId},
      ${input.citedByChunkId},
      ${input.quote ?? null},
      ${input.context ?? null},
      ${input.score ?? null}
    )
    RETURNING *
  `;
  return citation!;
}

/**
 * Get all citations for a specific chunk.
 */
export async function getCitationsForChunk(
  sql: Sql,
  chunkId: string,
): Promise<Citation[]> {
  return sql<Citation[]>`
    SELECT * FROM knowledge.citations
    WHERE chunk_id = ${chunkId}
    ORDER BY score DESC NULLS LAST, created_at DESC
  `;
}

/**
 * Get all citations made by a specific chunk.
 */
export async function getCitationsMadeByChunk(
  sql: Sql,
  chunkId: string,
): Promise<Citation[]> {
  return sql<Citation[]>`
    SELECT * FROM knowledge.citations
    WHERE cited_by_chunk_id = ${chunkId}
    ORDER BY score DESC NULLS LAST, created_at DESC
  `;
}

/**
 * Find all documents that cite a given document.
 */
export async function findCitingDocuments(
  sql: Sql,
  documentId: string,
  limit = 10,
): Promise<Array<{
  citing_document_id: string;
  citing_document_title: string;
  citing_chunk_id: string;
  citing_chunk_content: string;
  quote: string | null;
  context: string | null;
  score: number | null;
}>> {
  return sql<
    Array<{
      citing_document_id: string;
      citing_document_title: string;
      citing_chunk_id: string;
      citing_chunk_content: string;
      quote: string | null;
      context: string | null;
      score: number | null;
    }>
  >`
    SELECT DISTINCT ON (c.citing_document_id)
      c.cited_by_document_id AS citing_document_id,
      d.title AS citing_document_title,
      c.cited_by_chunk_id AS citing_chunk_id,
      ch.content AS citing_chunk_content,
      c.quote,
      c.context,
      c.score
    FROM knowledge.citations c
    JOIN knowledge.documents d ON d.id = c.cited_by_document_id
    JOIN knowledge.chunks ch ON ch.id = c.cited_by_chunk_id
    WHERE c.document_id = ${documentId}
    ORDER BY c.cited_by_document_id, c.score DESC NULLS LAST
    LIMIT ${limit}
  `;
}

/**
 * Delete all citations involving a document (either as source or citing).
 */
export async function deleteCitationsForDocument(
  sql: Sql,
  documentId: string,
): Promise<number> {
  const result = await sql`
    DELETE FROM knowledge.citations
    WHERE document_id = ${documentId} OR cited_by_document_id = ${documentId}
  `;
  return result.count ?? 0;
}

/**
 * Delete a specific citation.
 */
export async function deleteCitation(
  sql: Sql,
  citationId: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM knowledge.citations WHERE id = ${citationId}
  `;
  return (result.count ?? 0) > 0;
}
