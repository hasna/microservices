/**
 * Related documents: find semantically similar documents using embedding centroids.
 * Each document's centroid is the average of its chunk embeddings.
 */

import type { Sql } from "postgres";

export interface RelatedDocument {
  document_id: string;
  title: string;
  similarity: number;
  shared_topics: string[];
  chunk_count: number;
}

/**
 * Compute the centroid embedding for a document (average of its chunk embeddings).
 * Returns null if the document has no vector embeddings.
 */
export async function getDocumentCentroid(
  sql: Sql,
  documentId: string,
): Promise<number[] | null> {
  const hasPgvector = await checkPgvector(sql);
  if (!hasPgvector) return null;

  const rows = await sql<Array<{ embedding: string }>>`
    SELECT embedding::text AS embedding
    FROM knowledge.chunks
    WHERE document_id = ${documentId}
      AND embedding IS NOT NULL
  `;

  if (rows.length === 0) return null;

  // Parse each embedding from "[a,b,c,...]" format
  const vectors = rows.map((r) => {
    const inner = r.embedding.replace(/^\[|\]$/g, "");
    return inner.split(",").map(Number);
  });

  const dim = vectors[0]!.length;
  const centroid: number[] = new Array(dim).fill(0);

  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += v[i]!;
    }
  }

  for (let i = 0; i < dim; i++) {
    centroid[i] /= vectors.length;
  }

  // Normalize centroid
  const norm = Math.sqrt(centroid.reduce((sum, val) => sum + val * val, 0));
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      centroid[i] /= norm;
    }
  }

  return centroid;
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
}

/**
 * Find documents related to a given document based on embedding centroid similarity.
 * Returns documents in the same collection, excluding the source document itself.
 */
export async function findRelatedDocuments(
  sql: Sql,
  documentId: string,
  limit = 10,
  minSimilarity = 0.5,
): Promise<RelatedDocument[]> {
  const hasPgvector = await checkPgvector(sql);
  if (!hasPgvector) return [];

  // Get the centroid for the source document
  const centroid = await getDocumentCentroid(sql, documentId);
  if (!centroid) return [];

  // Get the source document's collection
  const [docRow] = await sql<[{ collection_id: string; title: string }]>`
    SELECT collection_id, title FROM knowledge.documents WHERE id = ${documentId}
  `;
  if (!docRow) return [];
  const { collection_id: collectionId } = docRow;

  // Get all other documents with embeddings in the same collection
  const rows = await sql<Array<{
    document_id: string;
    title: string;
    embedding: string;
    chunk_count: number;
  }>>`
    SELECT DISTINCT ON (d.id)
      d.id AS document_id,
      d.title,
      c.embedding::text AS embedding,
      d.chunk_count
    FROM knowledge.documents d
    JOIN knowledge.chunks c ON c.document_id = d.id
    WHERE d.collection_id = ${collectionId}
      AND d.id != ${documentId}
      AND c.embedding IS NOT NULL
    ORDER BY d.id, c.chunk_index
  `;

  // Group embeddings by document and compute centroid similarity
  const docVectors = new Map<string, { title: string; embeddings: number[][]; chunk_count: number }>();

  for (const row of rows) {
    if (!docVectors.has(row.document_id)) {
      docVectors.set(row.document_id, {
        title: row.title,
        embeddings: [],
        chunk_count: row.chunk_count,
      });
    }
    const inner = row.embedding.replace(/^\[|\]$/g, "");
    docVectors.get(row.document_id)!.embeddings.push(
      inner.split(",").map(Number),
    );
  }

  const related: RelatedDocument[] = [];

  for (const [docId, data] of docVectors) {
    if (data.embeddings.length === 0) continue;

    // Compute centroid for this document
    const dim = data.embeddings[0]!.length;
    const cent: number[] = new Array(dim).fill(0);
    for (const v of data.embeddings) {
      for (let i = 0; i < dim; i++) cent[i] += v[i]!;
    }
    for (let i = 0; i < dim; i++) cent[i] /= data.embeddings.length;

    const norm = Math.sqrt(cent.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      for (let i = 0; i < dim; i++) cent[i] /= norm;
    }

    const similarity = cosineSimilarity(centroid, cent);
    if (similarity >= minSimilarity) {
      related.push({
        document_id: docId,
        title: data.title,
        similarity: Math.round(similarity * 1000) / 1000,
        shared_topics: [],
        chunk_count: data.chunk_count,
      });
    }
  }

  return related
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/**
 * Find related documents using raw query text (no document ID needed).
 * Generates an embedding for the query and finds nearest document centroids.
 */
export async function findRelatedByQuery(
  sql: Sql,
  collectionId: string,
  query: string,
  limit = 10,
  minSimilarity = 0.3,
): Promise<RelatedDocument[]> {
  const { generateEmbedding } = await import("./embeddings.js");
  const embedding = await generateEmbedding(query);
  if (!embedding) return [];

  const hasPgvector = await checkPgvector(sql);
  if (!hasPgvector) return [];

  // Normalize query embedding
  const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  const normalized = norm > 0 ? embedding.map((v) => v / norm) : embedding;

  // Get all documents in collection with their centroid embeddings
  const rows = await sql<Array<{
    document_id: string;
    title: string;
    embedding: string;
    chunk_count: number;
  }>>`
    SELECT DISTINCT ON (d.id)
      d.id AS document_id,
      d.title,
      c.embedding::text AS embedding,
      d.chunk_count
    FROM knowledge.documents d
    JOIN knowledge.chunks c ON c.document_id = d.id
    WHERE d.collection_id = ${collectionId}
      AND d.status = 'ready'
      AND c.embedding IS NOT NULL
    ORDER BY d.id, c.chunk_index
  `;

  const docVectors = new Map<string, { title: string; embeddings: number[][]; chunk_count: number }>();

  for (const row of rows) {
    if (!docVectors.has(row.document_id)) {
      docVectors.set(row.document_id, {
        title: row.title,
        embeddings: [],
        chunk_count: row.chunk_count,
      });
    }
    const inner = row.embedding.replace(/^\[|\]$/g, "");
    docVectors.get(row.document_id)!.embeddings.push(
      inner.split(",").map(Number),
    );
  }

  const related: RelatedDocument[] = [];

  for (const [docId, data] of docVectors) {
    if (data.embeddings.length === 0) continue;

    const dim = data.embeddings[0]!.length;
    const cent: number[] = new Array(dim).fill(0);
    for (const v of data.embeddings) {
      for (let i = 0; i < dim; i++) cent[i] += v[i]!;
    }
    for (let i = 0; i < dim; i++) cent[i] /= data.embeddings.length;

    const docNorm = Math.sqrt(cent.reduce((sum, val) => sum + val * val, 0));
    if (docNorm > 0) {
      for (let i = 0; i < dim; i++) cent[i] /= docNorm;
    }

    const similarity = cosineSimilarity(normalized, cent);
    if (similarity >= minSimilarity) {
      related.push({
        document_id: docId,
        title: data.title,
        similarity: Math.round(similarity * 1000) / 1000,
        shared_topics: [],
        chunk_count: data.chunk_count,
      });
    }
  }

  return related
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
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
