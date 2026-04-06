/**
 * Multi-modal enrichment for vision chunks — alt text, captions,
 * color extraction, scene text, and citation type classification.
 */

import type { Sql } from "postgres";

export interface VisionEnrichment {
  altText: string | null;
  caption: string | null;
  dominantColors: string[] | null;
  sceneText: string | null;
  isProcessed: boolean;
  processingVersion: string | null;
}

export type CitationType = "inline" | "footnote" | "paraphrase" | "reference";

export interface CitationWithType {
  id: string;
  documentId: string;
  chunkId: string;
  citedByDocumentId: string;
  citedByChunkId: string;
  quote: string | null;
  context: string | null;
  score: number | null;
  citationType: CitationType;
  sectionAnchor: string | null;
  isVerified: boolean;
  createdAt: Date;
}

/**
 * Enrich a vision chunk with extracted metadata.
 */
export async function enrichVisionChunk(
  sql: Sql,
  chunkId: string,
  enrichment: Partial<VisionEnrichment>,
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (enrichment.altText !== undefined) {
    fields.push(`alt_text = $${idx++}`);
    values.push(enrichment.altText);
  }
  if (enrichment.caption !== undefined) {
    fields.push(`caption = $${idx++}`);
    values.push(enrichment.caption);
  }
  if (enrichment.dominantColors !== undefined) {
    fields.push(`dominant_colors = $${idx++}`);
    values.push(enrichment.dominantColors);
  }
  if (enrichment.sceneText !== undefined) {
    fields.push(`scene_text = $${idx++}`);
    values.push(enrichment.sceneText);
  }
  if (enrichment.isProcessed !== undefined) {
    fields.push(`is_processed = $${idx++}`);
    values.push(enrichment.isProcessed);
  }
  if (enrichment.processingVersion !== undefined) {
    fields.push(`processing_version = $${idx++}`);
    values.push(enrichment.processingVersion);
  }

  if (fields.length === 0) return;

  values.push(chunkId);
  await sql.unsafe(
    `UPDATE knowledge.vision_chunks SET ${fields.join(", ")} WHERE id = $${idx}`,
    values,
  );
}

/**
 * Get enriched vision chunk with all metadata.
 */
export async function getEnrichedVisionChunk(
  sql: Sql,
  chunkId: string,
): Promise<{
  id: string;
  documentId: string;
  altText: string | null;
  caption: string | null;
  dominantColors: string[] | null;
  sceneText: string | null;
  extractedText: string | null;
  isProcessed: boolean;
  processingVersion: string | null;
  mimeType: string;
  pageNumber: number | null;
} | null> {
  const [row] = await sql<any[]>`
    SELECT id, document_id, alt_text, caption, dominant_colors, scene_text,
           extracted_text, is_processed, processing_version, mime_type, page_number
    FROM knowledge.vision_chunks
    WHERE id = ${chunkId}
  `;
  if (!row) return null;
  return {
    id: row.id,
    documentId: row.document_id,
    altText: row.alt_text,
    caption: row.caption,
    dominantColors: row.dominant_colors,
    sceneText: row.scene_text,
    extractedText: row.extracted_text,
    isProcessed: row.is_processed,
    processingVersion: row.processing_version,
    mimeType: row.mime_type,
    pageNumber: row.page_number,
  };
}

/**
 * List unprocessed vision chunks for a workspace (for batch enrichment).
 */
export async function listUnprocessedVisionChunks(
  sql: Sql,
  workspaceId: string,
  limit: number = 50,
): Promise<{ id: string; documentId: string; mimeType: string; pageNumber: number | null }[]> {
  return sql<any[]>`
    SELECT v.id, v.document_id, v.mime_type, v.page_number
    FROM knowledge.vision_chunks v
    JOIN knowledge.documents d ON v.document_id = d.id
    WHERE d.workspace_id = ${workspaceId}
      AND v.is_processed = false
    ORDER BY v.created_at
    LIMIT ${limit}
  `;
}

/**
 * Classify a citation type based on content pattern.
 */
export async function classifyCitationType(
  sql: Sql,
  citationId: string,
  forceType?: CitationType,
): Promise<CitationType> {
  if (forceType) {
    await sql`UPDATE knowledge.citations SET citation_type = ${forceType}, is_verified = true WHERE id = ${citationId}`;
    return forceType;
  }

  const [citation] = await sql<any[]>`
    SELECT c.*, ch.content as chunk_content
    FROM knowledge.citations c
    JOIN knowledge.chunks ch ON c.chunk_id = ch.id
    WHERE c.id = ${citationId}
  `;

  if (!citation) return "reference";

  const content = citation.chunk_content ?? "";
  const quote = citation.quote ?? "";

  let inferredType: CitationType = "reference";

  // Pattern-based classification
  if (quote.match(/^\s*"?\([^)]+\)"?\s*$/)) {
    inferredType = "footnote";
  } else if (content.includes("as described") || content.includes("according to")) {
    inferredType = "paraphrase";
  } else if (content.match(/\[\d+\]/)) {
    inferredType = "inline";
  }

  await sql`UPDATE knowledge.citations SET citation_type = ${inferredType}, is_verified = true WHERE id = ${citationId}`;
  return inferredType;
}

/**
 * Set a section anchor on a citation for navigation.
 */
export async function setSectionAnchor(
  sql: Sql,
  citationId: string,
  anchor: string,
): Promise<void> {
  await sql`UPDATE knowledge.citations SET section_anchor = ${anchor} WHERE id = ${citationId}`;
}

/**
 * Get citations with their types for a document.
 */
export async function getCitationsByType(
  sql: Sql,
  documentId: string,
  citationType?: CitationType,
): Promise<CitationWithType[]> {
  const query = citationType
    ? sql<any[]>`
        SELECT * FROM knowledge.citations
        WHERE document_id = ${documentId} AND citation_type = ${citationType}
        ORDER BY created_at`
    : sql<any[]>`
        SELECT * FROM knowledge.citations
        WHERE document_id = ${documentId}
        ORDER BY created_at`;

  return query.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    chunkId: row.chunk_id,
    citedByDocumentId: row.cited_by_document_id,
    citedByChunkId: row.cited_by_chunk_id,
    quote: row.quote,
    context: row.context,
    score: row.score,
    citationType: row.citation_type as CitationType,
    sectionAnchor: row.section_anchor,
    isVerified: row.is_verified,
    createdAt: row.created_at,
  }));
}

/**
 * Verify or retract a citation.
 */
export async function setCitationVerifiedStatus(
  sql: Sql,
  citationId: string,
  verified: boolean,
  notes?: string,
): Promise<void> {
  await sql`
    UPDATE knowledge.citations
    SET is_verified = ${verified}
    WHERE id = ${citationId}
  `;
  if (notes) {
    await sql.unsafe(
      `UPDATE knowledge.citation_provenance
       SET verification_status = ${verified ? 'verified' : 'retracted'},
           verification_notes = $2,
           updated_at = NOW()
       WHERE citation_id = $1`,
      [citationId, notes],
    );
  }
}