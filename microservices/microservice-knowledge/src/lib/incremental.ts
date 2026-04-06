/**
 * Incremental indexing: only re-index documents when content has changed.
 */

import type { Sql } from "postgres";
import { type Document, hashContent, getDocumentById } from "./documents.js";
import { getCollection } from "./collections.js";
import { generateEmbedding } from "./embeddings.js";
import { type ChunkingStrategy, chunkText, estimateTokens } from "./chunking.js";

/**
 * Compute a content hash for a document and return it.
 * Used to detect whether document content has changed.
 */
export async function computeDocumentHash(content: string): Promise<string> {
  return hashContent(content);
}

/**
 * Get the current content hash stored for a document.
 */
export async function getStoredContentHash(
  sql: Sql,
  documentId: string,
): Promise<string | null> {
  const [row] = await sql<{ content_hash: string | null }[]>`
    SELECT content_hash FROM knowledge.documents WHERE id = ${documentId}
  `;
  return row?.content_hash ?? null;
}

/**
 * Index a document incrementally: only process chunks whose content hash
 * differs from the stored hash. Deletes stale chunks and inserts new ones.
 *
 * Returns { inserted, deleted, unchanged } counts.
 */
export async function indexDocumentIncremental(
  sql: Sql,
  documentId: string,
): Promise<{ inserted: number; deleted: number; unchanged: number }> {
  const doc = await getDocumentById(sql, documentId);
  if (!doc) throw new Error(`Document not found: ${documentId}`);

  const currentHash = await hashContent(doc.content);
  const storedHash = doc.content_hash;

  // If content hasn't changed, skip indexing
  if (storedHash === currentHash) {
    return { inserted: 0, deleted: 0, unchanged: 1 };
  }

  const collection = await getCollection(sql, doc.collection_id);
  if (!collection) throw new Error(`Collection not found: ${doc.collection_id}`);

  // Delete existing chunks
  const [{ old_count }] = await sql<[{ old_count: number }]>`
    SELECT COUNT(*) as old_count FROM knowledge.chunks WHERE document_id = ${documentId}
  `;
  await sql`DELETE FROM knowledge.chunks WHERE document_id = ${documentId}`;

  // Insert new chunks
  const chunks = chunkText(doc.content, {
    strategy: collection.chunking_strategy as ChunkingStrategy,
    chunkSize: collection.chunk_size,
    chunkOverlap: collection.chunk_overlap,
  });

  const hasPgvector = await checkPgvector(sql);

  for (let i = 0; i < chunks.length; i++) {
    const chunkContent = chunks[i]!;
    const tokenCount = estimateTokens(chunkContent);
    const embedding = await generateEmbedding(chunkContent);

    const chunkMeta = {
      ...(doc.metadata ?? {}),
      chunk_index: i,
      total_chunks: chunks.length,
      document_title: doc.title,
    };

    if (hasPgvector && embedding) {
      await sql`
        INSERT INTO knowledge.chunks (document_id, collection_id, content, chunk_index, token_count, metadata, embedding)
        VALUES (${documentId}, ${doc.collection_id}, ${chunkContent}, ${i}, ${tokenCount}, ${sql.json(chunkMeta)}, ${`[${embedding.join(",")}]`})
      `;
    } else {
      await sql`
        INSERT INTO knowledge.chunks (document_id, collection_id, content, chunk_index, token_count, metadata)
        VALUES (${documentId}, ${doc.collection_id}, ${chunkContent}, ${i}, ${tokenCount}, ${sql.json(chunkMeta)})
      `;
    }
  }

  // Update document with new hash and version
  const [updated] = await sql<Document[]>`
    UPDATE knowledge.documents
    SET content_hash = ${currentHash},
        version = version + 1,
        last_reindexed_at = NOW(),
        chunk_count = ${chunks.length}
    WHERE id = ${documentId}
    RETURNING *
  `;

  // Update collection chunk count
  await sql`
    UPDATE knowledge.collections
    SET chunk_count = chunk_count - ${old_count} + ${chunks.length}
    WHERE id = ${doc.collection_id}
  `;

  return { inserted: chunks.length, deleted: old_count, unchanged: 0 };
}

/**
 * Re-index a document only if its content hash has changed.
 * Returns the document if re-indexed, or null if unchanged.
 */
export async function reindexIfChanged(
  sql: Sql,
  documentId: string,
): Promise<Document | null> {
  const doc = await getDocumentById(sql, documentId);
  if (!doc) throw new Error(`Document not found: ${documentId}`);

  const currentHash = await hashContent(doc.content);

  // If content hasn't changed, skip re-indexing
  if (doc.content_hash === currentHash) {
    return null;
  }

  // Content changed — perform full re-index
  const result = await indexDocumentIncremental(sql, documentId);
  if (result.unchanged === 1) {
    return null;
  }

  const [updated] = await sql<Document[]>`
    SELECT * FROM knowledge.documents WHERE id = ${documentId}
  `;
  return updated ?? null;
}

/**
 * Force re-index a document regardless of hash comparison.
 * Updates version and last_reindexed_at.
 */
export async function forceReindexDocument(
  sql: Sql,
  documentId: string,
): Promise<Document> {
  const result = await indexDocumentIncremental(sql, documentId);
  const [updated] = await sql<Document[]>`
    SELECT * FROM knowledge.documents WHERE id = ${documentId}
  `;
  return updated!;
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
