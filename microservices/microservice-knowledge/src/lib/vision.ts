/**
 * Multi-modal vision support: store and retrieve image chunks from documents.
 */

import type { Sql } from "postgres";

export interface VisionChunk {
  id: string;
  document_id: string;
  image_data: Buffer;
  mime_type: string;
  page_number: number | null;
  width: number | null;
  height: number | null;
  extracted_text: string | null;
  created_at: Date;
}

export interface StoreVisionChunkInput {
  documentId: string;
  imageData: Buffer;
  mimeType: string;
  pageNumber?: number | null;
  width?: number | null;
  height?: number | null;
  extractedText?: string | null;
}

/**
 * Store a vision chunk (image) for a document.
 */
export async function storeVisionChunk(
  sql: Sql,
  input: StoreVisionChunkInput,
): Promise<VisionChunk> {
  const [chunk] = await sql<VisionChunk[]>`
    INSERT INTO knowledge.vision_chunks (
      document_id, image_data, mime_type, page_number, width, height, extracted_text
    )
    VALUES (
      ${input.documentId},
      ${input.imageData},
      ${input.mimeType},
      ${input.pageNumber ?? null},
      ${input.width ?? null},
      ${input.height ?? null},
      ${input.extractedText ?? null}
    )
    RETURNING *
  `;
  return chunk!;
}

/**
 * Get all vision chunks for a document.
 */
export async function getVisionChunks(
  sql: Sql,
  documentId: string,
): Promise<VisionChunk[]> {
  return sql<VisionChunk[]>`
    SELECT * FROM knowledge.vision_chunks
    WHERE document_id = ${documentId}
    ORDER BY page_number ASC NULLS LAST, created_at ASC
  `;
}

/**
 * Get a single vision chunk by ID.
 */
export async function getVisionChunkById(
  sql: Sql,
  chunkId: string,
): Promise<VisionChunk | null> {
  const [chunk] = await sql<VisionChunk[]>`
    SELECT * FROM knowledge.vision_chunks WHERE id = ${chunkId}
  `;
  return chunk ?? null;
}

/**
 * Delete all vision chunks for a document.
 */
export async function deleteVisionChunks(
  sql: Sql,
  documentId: string,
): Promise<number> {
  const result = await sql`
    DELETE FROM knowledge.vision_chunks WHERE document_id = ${documentId}
  `;
  return result.count ?? 0;
}
