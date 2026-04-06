/**
 * Chunking strategy management: set and re-chunk documents with different strategies.
 */

import type { Sql } from "postgres";
import { type ChunkingStrategy } from "./chunking.js";
import { getCollection } from "./collections.js";
import { getDocumentById } from "./documents.js";
import { generateEmbedding } from "./embeddings.js";
import { chunkText, estimateTokens } from "./chunking.js";

/**
 * Update the chunking strategy for a document.
 * Note: This only updates the metadata; use rechunk_document to apply a new strategy.
 */
export async function setChunkingStrategy(
  sql: Sql,
  documentId: string,
  strategy: ChunkingStrategy,
): Promise<{ document_id: string; chunking_strategy: ChunkingStrategy }> {
  const validStrategies: ChunkingStrategy[] = ["fixed", "paragraph", "sentence", "recursive"];
  if (!validStrategies.includes(strategy)) {
    throw new Error(`Invalid chunking strategy: ${strategy}. Must be one of: ${validStrategies.join(", ")}`);
  }

  const [doc] = await sql<[{ id: string; chunking_strategy: ChunkingStrategy }[]]>`
    UPDATE knowledge.documents
    SET metadata = jsonb_set(metadata, '{chunking_strategy}', ${sql.json(strategy)})
    WHERE id = ${documentId}
    RETURNING id, metadata
  `;

  if (!doc) throw new Error(`Document not found: ${documentId}`);

  // Return the strategy stored in metadata
  const stored = doc.metadata?.chunking_strategy ?? strategy;

  return { document_id: doc.id, chunking_strategy: stored };
}

/**
 * Re-chunk a document using a new strategy. Deletes old chunks and creates new ones.
 * Updates the document's chunking_strategy metadata and resets chunk_count.
 */
export async function rechunkDocument(
  sql: Sql,
  documentId: string,
  strategy?: ChunkingStrategy,
): Promise<{
  document_id: string;
  old_chunk_count: number;
  new_chunk_count: number;
  chunking_strategy: ChunkingStrategy;
}> {
  const doc = await getDocumentById(sql, documentId);
  if (!doc) throw new Error(`Document not found: ${documentId}`);

  const collection = await getCollection(sql, doc.collection_id);
  if (!collection) throw new Error(`Collection not found: ${doc.collection_id}`);

  // Use provided strategy or the one stored in document metadata, or fall back to collection
  const effectiveStrategy = strategy ?? doc.metadata?.chunking_strategy ?? collection.chunking_strategy as ChunkingStrategy;

  // Get old chunk count
  const [{ old_count }] = await sql<[{ old_count: number }]>`
    SELECT COUNT(*) as old_count FROM knowledge.chunks WHERE document_id = ${documentId}
  `;

  // Delete existing chunks
  await sql`DELETE FROM knowledge.chunks WHERE document_id = ${documentId}`;

  // Generate new chunks
  const chunks = chunkText(doc.content, {
    strategy: effectiveStrategy,
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
      chunking_strategy: effectiveStrategy,
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

  // Update document
  const updatedMetadata = {
    ...(doc.metadata ?? {}),
    chunking_strategy: effectiveStrategy,
  };

  await sql`
    UPDATE knowledge.documents
    SET metadata = ${sql.json(updatedMetadata)},
        chunk_count = ${chunks.length},
        version = version + 1,
        last_reindexed_at = NOW()
    WHERE id = ${documentId}
  `;

  // Update collection chunk count
  await sql`
    UPDATE knowledge.collections
    SET chunk_count = chunk_count - ${old_count} + ${chunks.length}
    WHERE id = ${doc.collection_id}
  `;

  return {
    document_id: documentId,
    old_chunk_count: old_count,
    new_chunk_count: chunks.length,
    chunking_strategy: effectiveStrategy,
  };
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
