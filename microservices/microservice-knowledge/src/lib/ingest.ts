/**
 * Document ingestion pipeline: hash, chunk, embed, store.
 */

import type { Sql } from "postgres";
import { chunkText, estimateTokens, type ChunkingStrategy } from "./chunking.js";
import { generateEmbedding } from "./embeddings.js";
import { hashContent, type Document } from "./documents.js";
import { getCollection } from "./collections.js";

export interface IngestInput {
  title: string;
  content: string;
  sourceType?: "text" | "url" | "file";
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
}

export async function ingestDocument(
  sql: Sql,
  collectionId: string,
  input: IngestInput
): Promise<Document> {
  const collection = await getCollection(sql, collectionId);
  if (!collection) throw new Error(`Collection not found: ${collectionId}`);

  // Hash content for dedup
  const contentHash = await hashContent(input.content);

  // Check for duplicate
  const [existing] = await sql<{ id: string }[]>`
    SELECT id FROM knowledge.documents
    WHERE collection_id = ${collectionId} AND content_hash = ${contentHash}
  `;
  if (existing) {
    throw new Error(`Duplicate document: content already exists as ${existing.id}`);
  }

  // Insert document as processing
  const [doc] = await sql<Document[]>`
    INSERT INTO knowledge.documents (collection_id, title, source_type, source_url, content, content_hash, metadata, status)
    VALUES (
      ${collectionId},
      ${input.title},
      ${input.sourceType ?? "text"},
      ${input.sourceUrl ?? null},
      ${input.content},
      ${contentHash},
      ${sql.json(input.metadata ?? {})},
      'processing'
    )
    RETURNING *
  `;

  try {
    // Chunk the content
    const chunks = chunkText(input.content, {
      strategy: collection.chunking_strategy as ChunkingStrategy,
      chunkSize: collection.chunk_size,
      chunkOverlap: collection.chunk_overlap,
    });

    // Check if pgvector embedding column exists
    const hasPgvector = await checkPgvector(sql);

    // Insert chunks with optional embeddings
    for (let i = 0; i < chunks.length; i++) {
      const chunkContent = chunks[i]!;
      const tokenCount = estimateTokens(chunkContent);
      const embedding = await generateEmbedding(chunkContent);

      const chunkMeta = {
        ...(input.metadata ?? {}),
        chunk_index: i,
        total_chunks: chunks.length,
        document_title: input.title,
      };

      if (hasPgvector && embedding) {
        await sql`
          INSERT INTO knowledge.chunks (document_id, collection_id, content, chunk_index, token_count, metadata, embedding)
          VALUES (
            ${doc!.id},
            ${collectionId},
            ${chunkContent},
            ${i},
            ${tokenCount},
            ${sql.json(chunkMeta)},
            ${`[${embedding.join(",")}]`}
          )
        `;
      } else {
        await sql`
          INSERT INTO knowledge.chunks (document_id, collection_id, content, chunk_index, token_count, metadata)
          VALUES (
            ${doc!.id},
            ${collectionId},
            ${chunkContent},
            ${i},
            ${tokenCount},
            ${sql.json(chunkMeta)}
          )
        `;
      }
    }

    // Update document status and chunk count
    const [updated] = await sql<Document[]>`
      UPDATE knowledge.documents
      SET status = 'ready', chunk_count = ${chunks.length}
      WHERE id = ${doc!.id}
      RETURNING *
    `;

    // Update collection counts
    await sql`
      UPDATE knowledge.collections
      SET document_count = document_count + 1,
          chunk_count = chunk_count + ${chunks.length}
      WHERE id = ${collectionId}
    `;

    return updated!;
  } catch (err) {
    // Mark document as errored
    const errorMsg = err instanceof Error ? err.message : String(err);
    await sql`
      UPDATE knowledge.documents
      SET status = 'error', error = ${errorMsg}
      WHERE id = ${doc!.id}
    `;
    throw err;
  }
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
