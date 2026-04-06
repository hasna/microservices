/**
 * Document ingestion pipeline: hash, chunk, embed, store.
 */

import type { Sql } from "postgres";
import {
  type ChunkingStrategy,
  chunkText,
  estimateTokens,
} from "./chunking.js";
import { getCollection } from "./collections.js";
import { type Document, hashContent } from "./documents.js";
import { generateEmbedding } from "./embeddings.js";

export interface IngestInput {
  title: string;
  content: string;
  sourceType?: "text" | "url" | "file" | "image" | "audio" | "video";
  sourceUrl?: string;
  metadata?: any;
  citationId?: string;
  sourceSection?: string;
  pageNumber?: number;
  mimeType?: string;
}

export async function ingestDocument(
  sql: Sql,
  collectionId: string,
  input: IngestInput,
  opts: { upsert?: boolean } = {},
): Promise<Document> {
  const collection = await getCollection(sql, collectionId);
  if (!collection) throw new Error(`Collection not found: ${collectionId}`);

  // Hash content for dedup
  const contentHash = await hashContent(input.content);

  // Check for duplicate — if upsert is enabled, reindex existing doc instead
  const [existing] = await sql<{ id: string }[]>`
    SELECT id FROM knowledge.documents
    WHERE collection_id = ${collectionId} AND content_hash = ${contentHash}
  `;
  if (existing) {
    if (opts.upsert) {
      return reindexDocument(sql, existing.id, input);
    }
    throw new Error(
      `Duplicate document: content already exists as ${existing.id}. Use upsert=true to replace.`,
    );
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
    await insertChunks(sql, doc!.id, collectionId, input, collection);
    // Update document status and chunk count
    const [updated] = await sql<Document[]>`
      UPDATE knowledge.documents
      SET status = 'ready', chunk_count = (
        SELECT COUNT(*) FROM knowledge.chunks WHERE document_id = ${doc!.id}
      ), last_reindexed_at = NOW()
      WHERE id = ${doc!.id}
      RETURNING *
    `;
    // Update collection counts
    await sql`
      UPDATE knowledge.collections
      SET document_count = document_count + 1,
          chunk_count = chunk_count + (
            SELECT COUNT(*) FROM knowledge.chunks WHERE document_id = ${doc!.id}
          )
      WHERE id = ${collectionId}
    `;
    return updated!;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await sql`
      UPDATE knowledge.documents
      SET status = 'error', error = ${errorMsg}
      WHERE id = ${doc!.id}
    `;
    throw err;
  }
}

/**
 * Re-index a document: delete existing chunks and re-embed with new content.
 * Updates version and last_reindexed_at.
 */
export async function reindexDocument(
  sql: Sql,
  documentId: string,
  input?: IngestInput,
): Promise<Document> {
  const [doc] = await sql<Document[]>`
    SELECT * FROM knowledge.documents WHERE id = ${documentId}
  `;
  if (!doc) throw new Error(`Document not found: ${documentId}`);

  const title = input?.title ?? doc.title;
  const content = input?.content ?? doc.content;
  const sourceType = input?.sourceType ?? doc.source_type;
  const sourceUrl = input?.sourceUrl ?? doc.source_url;
  const metadata = input?.metadata ?? doc.metadata;

  // Get old chunk count for collection update
  const [{ old_chunk_count }] = await sql<[{ old_chunk_count: number }]>`
    SELECT COUNT(*) as old_chunk_count FROM knowledge.chunks WHERE document_id = ${documentId}
  `;

  // Delete existing chunks
  await sql`DELETE FROM knowledge.chunks WHERE document_id = ${documentId}`;

  // Update document
  const [updated] = await sql<Document[]>`
    UPDATE knowledge.documents
    SET title = ${title},
        source_type = ${sourceType},
        source_url = ${sourceUrl},
        content = ${content},
        content_hash = ${await hashContent(content)},
        metadata = ${sql.json(metadata)},
        status = 'processing',
        version = version + 1,
        last_reindexed_at = NOW()
    WHERE id = ${documentId}
    RETURNING *
  `;

  const collection = await getCollection(sql, doc.collection_id);
  if (!collection) throw new Error(`Collection not found: ${doc.collection_id}`);

  const ingestInput: IngestInput = {
    title,
    content,
    sourceType,
    sourceUrl,
    metadata,
    citationId: input?.citationId,
    sourceSection: input?.sourceSection,
    pageNumber: input?.pageNumber,
    mimeType: input?.mimeType,
  };

  await insertChunks(sql, documentId, doc.collection_id, ingestInput, collection);

  const [final] = await sql<Document[]>`
    UPDATE knowledge.documents
    SET status = 'ready', chunk_count = (
      SELECT COUNT(*) FROM knowledge.chunks WHERE document_id = ${documentId}
    )
    WHERE id = ${documentId}
    RETURNING *
  `;

  // Update collection chunk count
  const newChunkCount = final!.chunk_count;
  await sql`
    UPDATE knowledge.collections
    SET chunk_count = chunk_count - ${old_chunk_count} + ${newChunkCount}
    WHERE id = ${doc.collection_id}
  `;

  return final!;
}

async function insertChunks(
  sql: Sql,
  documentId: string,
  collectionId: string,
  input: IngestInput,
  collection: any,
): Promise<void> {
  const hasPgvector = await checkPgvector(sql);
  const chunks = chunkText(input.content, {
    strategy: collection.chunking_strategy as ChunkingStrategy,
    chunkSize: collection.chunk_size,
    chunkOverlap: collection.chunk_overlap,
  });

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
        INSERT INTO knowledge.chunks (document_id, collection_id, content, chunk_index, token_count, metadata, embedding, citation_id, source_section, page_number, mime_type)
        VALUES (
          ${documentId},
          ${collectionId},
          ${chunkContent},
          ${i},
          ${tokenCount},
          ${sql.json(chunkMeta)},
          ${`[${embedding.join(",")}]`},
          ${input.citationId ?? null},
          ${input.sourceSection ?? null},
          ${input.pageNumber ?? null},
          ${input.mimeType ?? null}
        )
      `;
    } else {
      await sql`
        INSERT INTO knowledge.chunks (document_id, collection_id, content, chunk_index, token_count, metadata, citation_id, source_section, page_number, mime_type)
        VALUES (
          ${documentId},
          ${collectionId},
          ${chunkContent},
          ${i},
          ${tokenCount},
          ${sql.json(chunkMeta)},
          ${input.citationId ?? null},
          ${input.sourceSection ?? null},
          ${input.pageNumber ?? null},
          ${input.mimeType ?? null}
        )
      `;
    }
  }
}

/**
 * Queue a document for background re-indexing.
 */
export async function queueReindex(
  sql: Sql,
  documentId: string,
): Promise<void> {
  await sql`
    INSERT INTO knowledge.reindex_queue (document_id, status)
    VALUES (${documentId}, 'pending')
    ON CONFLICT DO NOTHING
  `;
}

/**
 * Process next pending reindex job.
 */
export async function processReindexQueue(
  sql: Sql,
  maxJobs = 10,
): Promise<number> {
  const rows = await sql<{ id: string; document_id: string }[]>`
    SELECT id, document_id FROM knowledge.reindex_queue
    WHERE status = 'pending'
    ORDER BY queued_at ASC
    LIMIT ${maxJobs}
  `;

  for (const row of rows) {
    try {
      await sql`UPDATE knowledge.reindex_queue SET status = 'processing' WHERE id = ${row.id}`;
      await reindexDocument(sql, row.document_id);
      await sql`UPDATE knowledge.reindex_queue SET status = 'done', processed_at = NOW() WHERE id = ${row.id}`;
    } catch (err) {
      await sql`UPDATE knowledge.reindex_queue SET status = 'failed', error = ${err instanceof Error ? err.message : String(err)} WHERE id = ${row.id}`;
    }
  }

  return rows.length;
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
