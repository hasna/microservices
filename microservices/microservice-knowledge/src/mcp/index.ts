#!/usr/bin/env bun
/**
 * MCP server for microservice-knowledge.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { createCollection, listCollections, getCollection, deleteCollection } from "../lib/collections.js";
import { deleteDocument, listDocuments, getDocument, getDocumentById, getDocumentByHash, hashContent, updateDocumentMetadata } from "../lib/documents.js";
import { chunkText, estimateTokens } from "../lib/chunking.js";
import { ingestDocument, queueReindex } from "../lib/ingest.js";
import {
  computeDocumentHash,
  getStoredContentHash,
  indexDocumentIncremental,
  reindexIfChanged,
  forceReindexDocument,
} from "../lib/incremental.js";
import { retrieve } from "../lib/retrieve.js";
import { getCollectionStats } from "../lib/stats.js";
import {
  storeVisionChunk,
  getVisionChunks,
  getVisionChunkById,
  deleteVisionChunks,
} from "../lib/vision.js";
import {
  addCitation,
  getCitationsForChunk,
  getCitationsMadeByChunk,
  findCitingDocuments,
  deleteCitation,
  deleteCitationsForDocument,
} from "../lib/citations.js";
import {
  setChunkingStrategy,
  rechunkDocument,
} from "../lib/chunkingStrategies.js";
import {
  crossCollectionRetrieve,
  workspaceRetrieve,
} from "../lib/crossCollection.js";
import {
  bm25Search,
  hybridSearch,
} from "../lib/bm25.js";
import {
  compareVersions,
  createDocumentVersion,
  getDocumentVersion,
  listDocumentVersions,
  pruneOldVersions,
  restoreDocumentVersion,
} from "../lib/versioning.js";
import {
  logDocumentAccess,
  getPopularDocuments,
  getDocumentAccessFrequency,
  getHotChunks,
  touchDocument,
} from "../lib/document-access.js";
import {
  graphWalk,
  computeCollectionImportance,
  getCitingDocuments,
  getCitedDocuments,
} from "../lib/knowledge-graph.js";
import {
  shareCollection,
  revokeCollectionShare,
  listCollectionShares,
  listWorkspaceCollections,
  checkCollectionPermission,
  getCollectionAccessList,
} from "../lib/collection-permissions.js";
import {
  queueIndexingJob,
  dequeueIndexingJob,
  getIndexingJob,
  listIndexingJobs,
  processIndexingQueue,
  getIndexingQueueStats,
  cancelIndexingJob,
  completeIndexingJob,
  failIndexingJob,
  processIndexingJob,
} from "../lib/indexing-jobs.js";
import {
  setCitationProvenance,
  getCitationProvenance,
  verifyCitation,
  getProvenanceChain,
  detectCircularCitations,
  getCollectionProvenanceStats,
  listCitationsByTrust,
  retractCitation,
} from "../lib/citation-provenance.js";
import {
  processDocument,
  detectFormat,
  detectFormatFromFilename,
  extractFromHtml,
  extractFromMarkdown,
  extractFromPlainText,
  type DocumentFormat,
} from "../lib/document-processors.js";
import {
  createIndexCheckpoint,
  getLatestCheckpoint,
  computeDelta,
  listCheckpoints,
  pruneOldCheckpoints,
  getDeltaChunks,
} from "../lib/index-checkpoints.js";
import {
  enrichVisionChunk,
  getEnrichedVisionChunk,
  listUnprocessedVisionChunks,
  classifyCitationType,
  setSectionAnchor,
  getCitationsByType,
  setCitationVerifiedStatus,
} from "../lib/multimodal-enrichment.js";
import {
  logSearchQuery,
  recordSearchClicks,
  getSearchAnalytics,
  getTopQueries,
  getNoResultQueries,
} from "../lib/search-analytics.js";
import {
  findRelatedDocuments,
  findRelatedByQuery,
  getDocumentCentroid,
} from "../lib/related-docs.js";
import {
  setDocumentPriority,
  getDocumentPriority,
  getCollectionPriorities,
  clearDocumentPriority,
  pruneExpiredPriorities,
  boostScores,
} from "../lib/doc-priority.js";
import {
  detectEntityConflicts,
  scanWorkspaceConflicts,
  getConflictStats,
} from "../lib/index.js";
import {
  classifyQueryIntent,
  recordQueryIntent,
  getIntentDistribution,
  getLowConfidenceQueries,
} from "../lib/query-intent.js";

const server = new McpServer({
  name: "microservice-knowledge",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

server.tool(
  "knowledge_create_collection",
  "Create a new knowledge collection for storing and retrieving documents",
  {
    workspace_id: z.string().describe("Workspace ID"),
    name: z.string().describe("Collection name"),
    description: z.string().optional().describe("Collection description"),
    chunk_size: z.number().optional().default(1000).describe("Characters per chunk"),
    chunk_overlap: z.number().optional().default(200).describe("Overlap between chunks"),
    chunking_strategy: z.enum(["fixed", "paragraph", "sentence", "recursive"]).optional().default("recursive").describe("Chunking strategy"),
    embedding_model: z.string().optional().default("text-embedding-3-small").describe("Embedding model"),
  },
  async ({ workspace_id, name, chunk_size, chunk_overlap, chunking_strategy, embedding_model, ...rest }) =>
    text(
      await createCollection(sql, {
        workspaceId: workspace_id,
        name,
        chunkSize: chunk_size,
        chunkOverlap: chunk_overlap,
        chunkingStrategy: chunking_strategy,
        embeddingModel: embedding_model,
        ...rest,
      }),
    ),
);

server.tool(
  "knowledge_ingest",
  "Ingest a document into a collection: chunk, embed, and index for retrieval",
  {
    collection_id: z.string().describe("Collection ID"),
    title: z.string().describe("Document title"),
    content: z.string().describe("Document content"),
    source_type: z.enum(["text", "url", "file"]).optional().default("text").describe("Source type"),
    source_url: z.string().optional().describe("Source URL if applicable"),
    metadata: z.record(z.any()).optional().describe("Additional metadata"),
  },
  async ({ collection_id, title, content, source_type, source_url, metadata }) =>
    text(
      await ingestDocument(sql, collection_id, {
        title,
        content,
        sourceType: source_type,
        sourceUrl: source_url,
        metadata,
      }),
    ),
);

server.tool(
  "knowledge_retrieve",
  "Retrieve relevant chunks from a collection using semantic, text, or hybrid search",
  {
    collection_id: z.string().describe("Collection ID"),
    query: z.string().describe("Search query"),
    mode: z.enum(["semantic", "text", "hybrid"]).optional().default("text").describe("Search mode"),
    limit: z.number().optional().default(10).describe("Max results"),
    min_score: z.number().optional().describe("Minimum relevance score"),
  },
  async ({ collection_id, query, ...opts }) =>
    text(await retrieve(sql, collection_id, query, opts)),
);

server.tool(
  "knowledge_list_collections",
  "List all knowledge collections in a workspace",
  { workspace_id: z.string().describe("Workspace ID") },
  async ({ workspace_id }) => text(await listCollections(sql, workspace_id)),
);

server.tool(
  "knowledge_list_documents",
  "List all documents in a collection",
  { collection_id: z.string().describe("Collection ID") },
  async ({ collection_id }) => text(await listDocuments(sql, collection_id)),
);

server.tool(
  "knowledge_delete_document",
  "Delete a document and its chunks from a collection",
  { id: z.string().describe("Document ID") },
  async ({ id }) => text({ deleted: await deleteDocument(sql, id) }),
);

server.tool(
  "knowledge_get_stats",
  "Get statistics for a collection (doc count, chunk count, avg chunks, total tokens)",
  { collection_id: z.string().describe("Collection ID") },
  async ({ collection_id }) => text(await getCollectionStats(sql, collection_id)),
);

server.tool(
  "knowledge_reindex",
  "Re-chunk and re-embed all documents in a collection",
  { collection_id: z.string().describe("Collection ID") },
  async ({ collection_id }) => {
    const { getCollection } = await import("../lib/collections.js");
    const { chunkText, estimateTokens } = await import("../lib/chunking.js");
    const { generateEmbedding } = await import("../lib/embeddings.js");

    const collection = await getCollection(sql, collection_id);
    if (!collection) throw new Error(`Collection not found: ${collection_id}`);

    await sql`DELETE FROM knowledge.chunks WHERE collection_id = ${collection_id}`;
    await sql`UPDATE knowledge.collections SET chunk_count = 0 WHERE id = ${collection_id}`;

    const docs = await listDocuments(sql, collection_id);
    let totalChunks = 0;

    for (const doc of docs) {
      try {
        await sql`UPDATE knowledge.documents SET status = 'pending', chunk_count = 0, error = NULL WHERE id = ${doc.id}`;

        const chunks = chunkText(doc.content, {
          strategy: collection.chunking_strategy,
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
              VALUES (${doc.id}, ${collection_id}, ${chunkContent}, ${i}, ${tokenCount}, ${sql.json(chunkMeta)}, ${`[${embedding.join(",")}]`})
            `;
          } else {
            await sql`
              INSERT INTO knowledge.chunks (document_id, collection_id, content, chunk_index, token_count, metadata)
              VALUES (${doc.id}, ${collection_id}, ${chunkContent}, ${i}, ${tokenCount}, ${sql.json(chunkMeta)})
            `;
          }
        }

        await sql`UPDATE knowledge.documents SET status = 'ready', chunk_count = ${chunks.length} WHERE id = ${doc.id}`;
        totalChunks += chunks.length;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await sql`UPDATE knowledge.documents SET status = 'error', error = ${errorMsg} WHERE id = ${doc.id}`;
      }
    }

    await sql`UPDATE knowledge.collections SET chunk_count = ${totalChunks} WHERE id = ${collection_id}`;
    return text({ ok: true, documents: docs.length, chunks: totalChunks });
  },
);

// ---------------------------------------------------------------------------
// Incremental indexing tools
// ---------------------------------------------------------------------------

server.tool(
  "knowledge_reindex_document",
  "Re-index a document only if its content has changed (compares content hash). Returns null if unchanged.",
  {
    document_id: z.string().describe("Document ID to re-index"),
    force: z.boolean().optional().default(false).describe("Force re-index even if content hash matches"),
  },
  async ({ document_id, force }) => {
    if (force) {
      const { forceReindexDocument } = await import("../lib/incremental.js");
      return text(await forceReindexDocument(sql, document_id));
    }
    const result = await reindexIfChanged(sql, document_id);
    return text({ reindexed: result !== null, document: result });
  },
);

server.tool(
  "knowledge_get_document_hash",
  "Get the current content hash and stored hash for a document to check if it has changed",
  { document_id: z.string().describe("Document ID") },
  async ({ document_id }) => {
    const [doc] = await sql`
      SELECT id, content, content_hash FROM knowledge.documents WHERE id = ${document_id}
    `;
    if (!doc) return text({ error: "Document not found" });
    const currentHash = await computeDocumentHash(doc.content);
    return text({
      document_id: doc.id,
      current_hash: currentHash,
      stored_hash: doc.content_hash,
      changed: currentHash !== doc.content_hash,
    });
  },
);

// ---------------------------------------------------------------------------
// Vision (multi-modal) tools
// ---------------------------------------------------------------------------

server.tool(
  "knowledge_store_vision_chunk",
  "Store an image/vision chunk for a document",
  {
    document_id: z.string().describe("Document ID"),
    image_data: z.string().describe("Base64-encoded image data"),
    mime_type: z.string().describe("MIME type (e.g., image/png, image/jpeg)"),
    page_number: z.number().optional().describe("Page number if applicable"),
    width: z.number().optional().describe("Image width in pixels"),
    height: z.number().optional().describe("Image height in pixels"),
    extracted_text: z.string().optional().describe("Extracted text from the image (OCR)"),
  },
  async ({ document_id, image_data, mime_type, page_number, width, height, extracted_text }) => {
    const buffer = Buffer.from(image_data, "base64");
    const chunk = await storeVisionChunk(sql, {
      documentId: document_id,
      imageData: buffer,
      mimeType: mime_type,
      pageNumber: page_number,
      width: width,
      height: height,
      extractedText: extracted_text,
    });
    return text({
      id: chunk.id,
      document_id: chunk.document_id,
      mime_type: chunk.mime_type,
      page_number: chunk.page_number,
      width: chunk.width,
      height: chunk.height,
      has_extracted_text: chunk.extracted_text !== null,
      created_at: chunk.created_at,
    });
  },
);

server.tool(
  "knowledge_get_vision_chunks",
  "Get all vision chunks (images) for a document",
  { document_id: z.string().describe("Document ID") },
  async ({ document_id }) => {
    const chunks = await getVisionChunks(sql, document_id);
    return text(chunks.map((c) => ({
      id: c.id,
      document_id: c.document_id,
      mime_type: c.mime_type,
      page_number: c.page_number,
      width: c.width,
      height: c.height,
      has_extracted_text: c.extracted_text !== null,
      created_at: c.created_at,
    })));
  },
);

// ---------------------------------------------------------------------------
// Citation tracking tools
// ---------------------------------------------------------------------------

server.tool(
  "knowledge_add_citation",
  "Add a citation relationship between two chunks",
  {
    document_id: z.string().describe("Source document ID (the document being cited)"),
    chunk_id: z.string().describe("Source chunk ID"),
    cited_by_document_id: z.string().describe("Document ID that is doing the citing"),
    cited_by_chunk_id: z.string().describe("Chunk ID that is doing the citing"),
    quote: z.string().optional().describe("Quoted text"),
    context: z.string().optional().describe("Surrounding context"),
    score: z.number().optional().describe("Citation score/relevance"),
  },
  async ({ document_id, chunk_id, cited_by_document_id, cited_by_chunk_id, quote, context, score }) =>
    text(
      await addCitation(sql, {
        documentId: document_id,
        chunkId: chunk_id,
        citedByDocumentId: cited_by_document_id,
        citedByChunkId: cited_by_chunk_id,
        quote,
        context,
        score,
      }),
    ),
);

server.tool(
  "knowledge_get_chunk_citations",
  "Get all citations for a specific chunk",
  { chunk_id: z.string().describe("Chunk ID") },
  async ({ chunk_id }) => text(await getCitationsForChunk(sql, chunk_id)),
);

server.tool(
  "knowledge_find_citing_documents",
  "Find all documents that cite a given document",
  {
    document_id: z.string().describe("Document ID being cited"),
    limit: z.number().optional().default(10).describe("Max results"),
  },
  async ({ document_id, limit }) => text(await findCitingDocuments(sql, document_id, limit)),
);

// ---------------------------------------------------------------------------
// Chunking strategy tools
// ---------------------------------------------------------------------------

server.tool(
  "knowledge_set_chunking_strategy",
  "Set the chunking strategy for a document (metadata only; use rechunk to apply)",
  {
    document_id: z.string().describe("Document ID"),
    strategy: z.enum(["fixed", "paragraph", "sentence", "recursive"]).describe("Chunking strategy"),
  },
  async ({ document_id, strategy }) =>
    text(await setChunkingStrategy(sql, document_id, strategy)),
);

server.tool(
  "knowledge_rechunk_document",
  "Re-chunk a document with a new strategy, deleting old chunks and creating new ones",
  {
    document_id: z.string().describe("Document ID"),
    strategy: z.enum(["fixed", "paragraph", "sentence", "recursive"]).optional().describe("Chunking strategy (uses document metadata if not provided)"),
  },
  async ({ document_id, strategy }) =>
    text(await rechunkDocument(sql, document_id, strategy)),
);

// ── Feature 1: Cross-collection retrieval ─────────────────────────────────────

server.tool(
  "knowledge_cross_collection_retrieve",
  "Search across multiple collections simultaneously and merge results by score",
  {
    collection_ids: z.array(z.string()).describe("Collection IDs to search"),
    query: z.string().describe("Search query"),
    mode: z.enum(["semantic", "text", "hybrid"]).optional().default("text").describe("Search mode"),
    limit: z.number().optional().default(20).describe("Max total results"),
    per_collection_limit: z.number().optional().default(10).describe("Max results per collection"),
  },
  async ({ collection_ids, query, mode, limit, per_collection_limit }) =>
    text(await crossCollectionRetrieve(sql, collection_ids, query, {
      mode,
      limit,
      perCollectionLimit: per_collection_limit,
    })),
);

server.tool(
  "knowledge_workspace_retrieve",
  "Search across all collections in a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    query: z.string().describe("Search query"),
    mode: z.enum(["semantic", "text", "hybrid"]).optional().default("text").describe("Search mode"),
    limit: z.number().optional().default(20).describe("Max total results"),
  },
  async ({ workspace_id, query, mode, limit }) =>
    text(await workspaceRetrieve(sql, workspace_id, query, { mode, limit })),
);

// ── Feature 2: BM25 ranking ─────────────────────────────────────────────────

server.tool(
  "knowledge_bm25_search",
  "Search using BM25 full-text ranking (alternative to vector search)",
  {
    collection_id: z.string().describe("Collection ID"),
    query: z.string().describe("Search query"),
    limit: z.number().optional().default(10).describe("Max results"),
    k1: z.number().optional().describe("BM25 k1 term frequency saturation parameter"),
    b: z.number().optional().describe("BM25 b document length normalization parameter"),
  },
  async ({ collection_id, query, limit, k1, b }) =>
    text(await bm25Search(sql, collection_id, query, limit, { k1, b })),
);

server.tool(
  "knowledge_hybrid_search",
  "Hybrid search combining BM25 and semantic (vector) rankings using Reciprocal Rank Fusion",
  {
    collection_id: z.string().describe("Collection ID"),
    query: z.string().describe("Search query"),
    limit: z.number().optional().default(10).describe("Max results"),
    semantic_weight: z.number().optional().default(0.5).describe("Weight for semantic scores (0-1)"),
    bm25_weight: z.number().optional().default(0.5).describe("Weight for BM25 scores (0-1)"),
  },
  async ({ collection_id, query, limit, semantic_weight, bm25_weight }) =>
    text(await hybridSearch(sql, collection_id, query, limit, semantic_weight, bm25_weight)),
);

// ── Feature 3: Document versioning ────────────────────────────────────────────

server.tool(
  "knowledge_create_version",
  "Snapshot the current state of a document as a new version",
  {
    document_id: z.string().describe("Document ID"),
    reason: z.string().optional().describe("Reason for creating version"),
  },
  async ({ document_id, reason }) => {
    const [doc] = await sql`SELECT * FROM knowledge.documents WHERE id = ${document_id}`;
    if (!doc) return text({ error: "Document not found" });
    const { hashContent } = await import("../lib/documents.js");
    const hash = await hashContent(doc.content);
    return text(await createDocumentVersion(sql, {
      documentId: document_id,
      content: doc.content,
      contentHash: hash,
      metadataSnapshot: doc.metadata ?? {},
      chunkCount: doc.chunk_count,
      reason,
    }));
  },
);

server.tool(
  "knowledge_list_versions",
  "List all versions of a document, newest first",
  {
    document_id: z.string().describe("Document ID"),
    limit: z.number().optional().default(20).describe("Max results"),
    offset: z.number().optional().default(0).describe("Offset"),
  },
  async ({ document_id, limit, offset }) =>
    text(await listDocumentVersions(sql, document_id, { limit, offset })),
);

server.tool(
  "knowledge_get_version",
  "Get a specific version of a document",
  { document_id: z.string(), version_number: z.number().int().min(1) },
  async ({ document_id, version_number }) =>
    text(await getDocumentVersion(sql, document_id, version_number)),
);

server.tool(
  "knowledge_restore_version",
  "Restore a document to a previous version (creates backup of current state first)",
  { document_id: z.string(), version_number: z.number().int().min(1) },
  async ({ document_id, version_number }) => {
    const result = await restoreDocumentVersion(sql, document_id, version_number);
    return text(result);
  },
);

server.tool(
  "knowledge_compare_versions",
  "Compare two versions of a document, showing word-level diff",
  {
    document_id: z.string(),
    version_a: z.number().int().min(1).describe("Older version number"),
    version_b: z.number().int().min(1).describe("Newer version number"),
  },
  async ({ document_id, version_a, version_b }) =>
    text(await compareVersions(sql, document_id, version_a, version_b)),
);

server.tool(
  "knowledge_prune_versions",
  "Delete old versions, keeping only the most recent N",
  {
    document_id: z.string(),
    keep_last: z.number().int().min(1).optional().default(10),
  },
  async ({ document_id, keep_last }) =>
    text({ deleted: await pruneOldVersions(sql, document_id, keep_last) }),
);

// ---------------------------------------------------------------------------

// Hybrid Retrieval tools (semantic + BM25 + cross-encoder reranking)
server.tool(
  "knowledge_hybrid_retrieve_reranked",
  "Retrieve chunks using hybrid semantic+BM25 scoring with optional cross-encoder re-ranking",
  {
    collection_id: z.string().describe("Collection ID"),
    query: z.string().describe("Search query"),
    limit: z.number().optional().default(10).describe("Max results"),
    semantic_weight: z.number().optional().default(0.5).describe("Weight for semantic scores (0-1)"),
    bm25_weight: z.number().optional().default(0.5).describe("Weight for BM25 scores (0-1)"),
    use_cross_encoder: z.boolean().optional().default(false).describe("Whether to apply cross-encoder re-ranking"),
  },
  async ({ collection_id, query, limit, semantic_weight, bm25_weight, use_cross_encoder }) => {
    const { hybridRetrieveReranked } = await import("../lib/hybrid-retrieve.js");
    return text(await hybridRetrieveReranked(sql, collection_id, query, {
      limit: limit ?? 10,
      semanticWeight: semantic_weight ?? 0.5,
      bm25Weight: bm25_weight ?? 0.5,
      useCrossEncoder: use_cross_encoder ?? false,
    }));
  },
);

// Citation Graph tools
server.tool(
  "knowledge_get_outgoing_citations",
  "Get documents that a document cites (what it references)",
  {
    document_id: z.string().describe("Source document ID"),
    limit: z.number().optional().default(20),
  },
  async ({ document_id, limit }) => {
    const { getOutgoingCitations } = await import("../lib/citation-graph.js");
    return text(await getOutgoingCitations(sql, document_id, limit ?? 20));
  },
);

server.tool(
  "knowledge_delta_report",
  "Get a delta report of what changed between the last checkpoint and current index state for a document",
  {
    document_id: z.string().uuid(),
    new_content_hash: z.string(),
    new_chunk_count: z.number().int().nonnegative(),
    new_total_tokens: z.number().int().nonnegative(),
  },
  async ({ document_id, new_content_hash, new_chunk_count, new_total_tokens }) => {
    const result = await computeDelta(sql, document_id, new_content_hash, new_chunk_count, new_total_tokens);
    return text(JSON.stringify(result));
  },
);

server.tool(
  "knowledge_get_incoming_citations",
  "Get documents that cite a given document (who references it)",
  {
    document_id: z.string().describe("Target document ID"),
    limit: z.number().optional().default(20),
  },
  async ({ document_id, limit }) => {
    const { getIncomingCitations } = await import("../lib/citation-graph.js");
    return text(await getIncomingCitations(sql, document_id, limit ?? 20));
  },
);

server.tool(
  "knowledge_find_root_sources",
  "Find the root source documents in a citation chain (documents with no incoming citations)",
  {
    workspace_id: z.string().describe("Workspace ID"),
    max_depth: z.number().optional().default(5).describe("Max traversal depth"),
  },
  async ({ workspace_id, max_depth }) => {
    const { findRootSourceDocuments } = await import("../lib/citation-graph.js");
    return text(await findRootSourceDocuments(sql, workspace_id, max_depth ?? 5));
  },
);

server.tool(
  "knowledge_find_citation_path",
  "Find the citation path between two documents (if one cites the other directly or transitively)",
  {
    source_document_id: z.string().describe("Starting document"),
    target_document_id: z.string().describe("Target document"),
    max_depth: z.number().optional().default(5),
  },
  async ({ source_document_id, target_document_id, max_depth }) => {
    const { findCitationPath } = await import("../lib/citation-graph.js");
    return text(await findCitationPath(sql, source_document_id, target_document_id, max_depth ?? 5));
  },
);

server.tool(
  "knowledge_compute_impact_scores",
  "Compute impact scores for all documents in a citation graph (direct + transitive citations weighted)",
  {
    workspace_id: z.string().describe("Workspace ID"),
    min_impact: z.number().optional().default(1).describe("Minimum impact score to return"),
  },
  async ({ workspace_id, min_impact }) => {
    const { computeImpactScores } = await import("../lib/citation-graph.js");
    return text(await computeImpactScores(sql, workspace_id, min_impact ?? 1));
  },
);

server.tool(
  "knowledge_find_all_citing_documents",
  "Find all documents that cite a given document directly or transitively (BFS citation traversal)",
  {
    document_id: z.string().describe("Document ID to find citers for"),
    max_depth: z.number().optional().default(5).describe("Maximum traversal depth"),
  },
  async ({ document_id, max_depth }) => {
    const { findAllCitingDocuments } = await import("../lib/citation-graph.js");
    return text(await findAllCitingDocuments(sql, document_id, max_depth ?? 5));
  },
);

server.tool(
  "knowledge_update_document_metadata",
  "Update the metadata fields on a document",
  {
    document_id: z.string().describe("Document ID to update"),
    metadata: z.record(z.any()).describe("Metadata key-value pairs to set (merged with existing)"),
  },
  async ({ document_id, metadata }) =>
    text(await updateDocumentMetadata(sql, document_id, metadata)),
);

server.tool(
  "knowledge_queue_reindex",
  "Queue a document for background re-indexing (chunking + embedding)",
  {
    document_id: z.string().describe("Document ID to reindex"),
  },
  async ({ document_id }) => {
    await queueReindex(sql, document_id);
    return text({ queued: true, document_id });
  },
);

server.tool(
  "knowledge_log_document_access",
  "Log an access event for a document (read, search, retrieve, or embed)",
  {
    workspace_id: z.string().describe("Workspace ID"),
    document_id: z.string().describe("Document ID"),
    collection_id: z.string().describe("Collection ID"),
    chunk_id: z.string().optional().describe("Chunk ID if accessing a specific chunk"),
    access_type: z.enum(["read", "search", "retrieve", "embed"]).describe("Type of access"),
    user_id: z.string().optional().describe("User performing the access"),
  },
  async ({ workspace_id, document_id, collection_id, chunk_id, access_type, user_id }) =>
    text(await logDocumentAccess(sql, { workspaceId: workspace_id, documentId: document_id, collectionId: collection_id, chunkId: chunk_id ?? null, accessType: access_type, userId: user_id ?? null })),
);

server.tool(
  "knowledge_get_popular_documents",
  "Get most frequently accessed documents in a workspace over a time window",
  {
    workspace_id: z.string().describe("Workspace ID"),
    collection_id: z.string().optional().describe("Filter by collection"),
    time_window_hours: z.number().optional().default(168).describe("Time window in hours (default 168 = 1 week)"),
    limit: z.number().optional().default(20).describe("Max results"),
  },
  async ({ workspace_id, collection_id, time_window_hours, limit }) =>
    text(await getPopularDocuments(sql, workspace_id, collection_id ?? null, time_window_hours ?? 168, limit ?? 20)),
);

server.tool(
  "knowledge_get_access_frequency",
  "Get per-document access frequency metrics",
  {
    workspace_id: z.string().describe("Workspace ID"),
    document_id: z.string().describe("Document ID"),
  },
  async ({ workspace_id, document_id }) =>
    text(await getDocumentAccessFrequency(sql, workspace_id, document_id)),
);

server.tool(
  "knowledge_get_hot_chunks",
  "Get most frequently accessed chunks in a collection",
  {
    collection_id: z.string().describe("Collection ID"),
    time_window_hours: z.number().optional().default(168).describe("Time window in hours"),
    limit: z.number().optional().default(20).describe("Max results"),
  },
  async ({ collection_id, time_window_hours, limit }) =>
    text(await getHotChunks(sql, collection_id, time_window_hours ?? 168, limit ?? 20)),
);

server.tool(
  "knowledge_graph_walk",
  "Traverse the citation graph starting from a document up to maxDepth hops",
  {
    start_document_id: z.string().describe("Starting document ID"),
    max_depth: z.number().optional().default(3).describe("Max traversal depth"),
    limit: z.number().optional().default(100).describe("Max nodes to return"),
  },
  async ({ start_document_id, max_depth, limit }) =>
    text(await graphWalk(sql, start_document_id, max_depth ?? 3, limit ?? 100)),
);

server.tool(
  "knowledge_compute_collection_importance",
  "Compute importance scores for all documents in a collection based on citation centrality",
  {
    collection_id: z.string().describe("Collection ID"),
  },
  async ({ collection_id }) =>
    text(await computeCollectionImportance(sql, collection_id)),
);

server.tool(
  "knowledge_share_collection",
  "Share a collection with another workspace with read, write, or admin permission",
  {
    collection_id: z.string().describe("Collection ID"),
    target_workspace_id: z.string().describe("Workspace to share with"),
    permission: z.enum(["read", "write", "admin"]).describe("Permission level"),
    granted_by: z.string().describe("User granting the share"),
  },
  async ({ collection_id, target_workspace_id, permission, granted_by }) =>
    text(await shareCollection(sql, { collectionId: collection_id, targetWorkspaceId: target_workspace_id, permission, grantedBy: granted_by })),
);

server.tool(
  "knowledge_revoke_collection_share",
  "Revoke a collection share from another workspace",
  {
    collection_id: z.string().describe("Collection ID"),
    target_workspace_id: z.string().describe("Workspace to revoke share from"),
  },
  async ({ collection_id, target_workspace_id }) =>
    text(await revokeCollectionShare(sql, collection_id, target_workspace_id)),
);

server.tool(
  "knowledge_list_collection_shares",
  "List all workspaces a collection is shared with",
  {
    collection_id: z.string().describe("Collection ID"),
  },
  async ({ collection_id }) =>
    text(await listCollectionShares(sql, collection_id)),
);

server.tool(
  "knowledge_list_workspace_collections",
  "List all collections a workspace has access to (own + shared)",
  {
    workspace_id: z.string().describe("Workspace ID"),
  },
  async ({ workspace_id }) =>
    text(await listWorkspaceCollections(sql, workspace_id)),
);

server.tool(
  "knowledge_check_collection_permission",
  "Check a workspace's permission level on a collection",
  {
    workspace_id: z.string().describe("Workspace ID"),
    collection_id: z.string().describe("Collection ID"),
  },
  async ({ workspace_id, collection_id }) =>
    text(await checkCollectionPermission(sql, workspace_id, collection_id)),
);

server.tool(
  "knowledge_get_collection_access_list",
  "Get all access grants for a collection (who has what permission)",
  {
    collection_id: z.string().describe("Collection ID"),
  },
  async ({ collection_id }) =>
    text(await getCollectionAccessList(sql, collection_id)),
);

// --- Indexing job queue tools ---

server.tool(
  "knowledge_queue_indexing_job",
  "Queue a document for background indexing",
  {
    document_id: z.string().describe("Document ID"),
    workspace_id: z.string().describe("Workspace ID"),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional().default("normal").describe("Job priority"),
    max_attempts: z.number().optional().default(3).describe("Max retry attempts"),
  },
  async ({ document_id, workspace_id, priority, max_attempts }) =>
    text(await queueIndexingJob(sql, document_id, workspace_id, { priority, maxAttempts: max_attempts })),
);

server.tool(
  "knowledge_list_indexing_jobs",
  "List indexing jobs for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    status: z.enum(["pending", "processing", "completed", "failed", "cancelled"]).optional().describe("Filter by status"),
    limit: z.number().optional().default(50).describe("Max results"),
    offset: z.number().optional().default(0).describe("Offset"),
  },
  async ({ workspace_id, status, limit, offset }) =>
    text(await listIndexingJobs(sql, workspace_id, { status, limit, offset })),
);

server.tool(
  "knowledge_get_indexing_job",
  "Get a specific indexing job by ID",
  {
    job_id: z.string().describe("Job ID"),
  },
  async ({ job_id }) => text(await getIndexingJob(sql, job_id)),
);

server.tool(
  "knowledge_cancel_indexing_job",
  "Cancel a pending or failed indexing job",
  {
    job_id: z.string().describe("Job ID"),
  },
  async ({ job_id }) => text(await cancelIndexingJob(sql, job_id)),
);

server.tool(
  "knowledge_process_indexing_queue",
  "Process N pending indexing jobs from the queue (for background workers)",
  {
    count: z.number().optional().default(5).describe("Number of jobs to process"),
  },
  async ({ count }) => {
    const processed = await processIndexingQueue(sql, count);
    return text({ processed });
  },
);

server.tool(
  "knowledge_indexing_queue_stats",
  "Get indexing queue statistics for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
  },
  async ({ workspace_id }) => text(await getIndexingQueueStats(sql, workspace_id)),
);

// --- Citation provenance tools ---

server.tool(
  "knowledge_set_citation_provenance",
  "Set or update provenance tracking for a citation",
  {
    citation_id: z.string().describe("Citation ID"),
    confidence: z.enum(["high", "medium", "low", "unverified"]).optional().default("unverified").describe("Confidence level"),
    verification_status: z.enum(["verified", "disputed", "unverified", "retracted"]).optional().default("unverified").describe("Verification status"),
    verification_notes: z.string().optional().describe("Notes about verification"),
    trust_score: z.number().optional().default(50).describe("Trust score 0-100"),
  },
  async ({ citation_id, confidence, verification_status, verification_notes, trust_score }) =>
    text(await setCitationProvenance(sql, citation_id, {
      confidence,
      verificationStatus: verification_status,
      verificationNotes: verification_notes,
      trustScore: trust_score,
    })),
);

server.tool(
  "knowledge_get_citation_provenance",
  "Get provenance information for a citation",
  {
    citation_id: z.string().describe("Citation ID"),
  },
  async ({ citation_id }) => text(await getCitationProvenance(sql, citation_id)),
);

server.tool(
  "knowledge_verify_citation",
  "Verify a citation against its source content",
  {
    citation_id: z.string().describe("Citation ID"),
    notes: z.string().optional().describe("Verification notes"),
  },
  async ({ citation_id, notes }) => text(await verifyCitation(sql, citation_id, notes)),
);

server.tool(
  "knowledge_get_provenance_chain",
  "Get the citation path from source to target",
  {
    citation_id: z.string().describe("Citation ID"),
  },
  async ({ citation_id }) => text(await getProvenanceChain(sql, citation_id)),
);

server.tool(
  "knowledge_collection_provenance_stats",
  "Get aggregate citation provenance stats for a collection",
  {
    collection_id: z.string().describe("Collection ID"),
  },
  async ({ collection_id }) =>
    text(await getCollectionProvenanceStats(sql, collection_id)),
);

server.tool(
  "knowledge_list_citations_by_trust",
  "List citations filtered by minimum trust score",
  {
    workspace_id: z.string().describe("Workspace ID"),
    min_trust: z.number().optional().default(0).describe("Minimum trust score (0-100)"),
    limit: z.number().optional().default(50).describe("Max results"),
  },
  async ({ workspace_id, min_trust, limit }) =>
    text(await listCitationsByTrust(sql, workspace_id, min_trust, limit)),
);

server.tool(
  "knowledge_retract_citation",
  "Retract a citation with a reason",
  {
    citation_id: z.string().describe("Citation ID"),
    reason: z.string().describe("Reason for retraction"),
  },
  async ({ citation_id, reason }) => text(await retractCitation(sql, citation_id, reason)),
);

// --- Document processing tools ---

server.tool(
  "knowledge_detect_document_format",
  "Detect the format of document content",
  {
    content: z.string().optional().describe("Document content as string"),
    filename: z.string().optional().describe("Filename to detect format from extension"),
    mime_type: z.string().optional().describe("MIME type hint"),
  },
  async ({ content, filename, mime_type }) => {
    const format = filename
      ? detectFormatFromFilename(filename)
      : content
        ? detectFormat(content, mime_type)
        : "unknown";
    return text({ format, filename, mime_type });
  },
);

server.tool(
  "knowledge_process_document",
  "Process raw document content and extract structured text and metadata",
  {
    content: z.string().describe("Document content as string"),
    filename: z.string().optional().describe("Filename for format detection"),
    mime_type: z.string().optional().describe("MIME type hint"),
  },
  async ({ content, filename, mime_type }) =>
    text(processDocument(content, filename, mime_type)),
);

// ─── Incremental Indexing ───────────────────────────────────────────────────

server.tool(
  "knowledge_reindex_if_changed",
  "Re-index a document only if its content has changed since last index (hash check)",
  {
    document_id: z.string().describe("Document ID to check and potentially reindex"),
  },
  async ({ document_id }) => {
    const result = await reindexIfChanged(sql, document_id);
    return text({ reindexed: result !== null, document: result });
  },
);

server.tool(
  "knowledge_force_reindex_document",
  "Force re-index a document regardless of content hash, updating version and last_reindexed_at",
  {
    document_id: z.string().describe("Document ID to force reindex"),
  },
  async ({ document_id }) => text(await forceReindexDocument(sql, document_id)),
);

server.tool(
  "knowledge_index_document_incremental",
  "Index a document incrementally: only process chunks whose content hash differs from stored hash. Deletes stale chunks and inserts new ones. Returns inserted, deleted, and unchanged counts",
  {
    document_id: z.string().uuid().describe("Document ID to incrementally index"),
  },
  async ({ document_id }) => text(await indexDocumentIncremental(sql, document_id)),
);

server.tool(
  "knowledge_compute_document_hash",
  "Compute a content hash for a string (useful for change detection before reindexing)",
  {
    content: z.string().describe("Document content to hash"),
  },
  async ({ content }) => text({ hash: await computeDocumentHash(content) }),
);

// ─── Document Versioning ─────────────────────────────────────────────────────

server.tool(
  "knowledge_list_document_versions",
  "List all historical versions of a document, newest first",
  {
    document_id: z.string().uuid().describe("Document ID"),
    limit: z.number().optional().default(20).describe("Max versions to return"),
    offset: z.number().optional().default(0).describe("Offset for pagination"),
  },
  async ({ document_id, limit, offset }) =>
    text(await listDocumentVersions(sql, document_id, { limit, offset })),
);

server.tool(
  "knowledge_create_document_version",
  "Snapshot the current state of a document as a new version (call before updating)",
  {
    document_id: z.string().uuid().describe("Document ID"),
    content: z.string().describe("Content to snapshot"),
    content_hash: z.string().describe("Content hash"),
    metadata_snapshot: z.record(z.any()).optional().describe("Metadata snapshot"),
    chunk_count: z.number().int().nonnegative().describe("Current chunk count"),
    reason: z.string().optional().describe("Reason for creating this version"),
  },
  async ({ document_id, content, content_hash, metadata_snapshot, chunk_count, reason }) =>
    text(await createDocumentVersion(sql, { documentId: document_id, content, contentHash: content_hash, metadataSnapshot: metadata_snapshot ?? {}, chunkCount: chunk_count, reason })),
);

// ─── Citation Management ─────────────────────────────────────────────────────

server.tool(
  "knowledge_delete_citations_for_document",
  "Delete all citations involving a document (either as source or citing document)",
  {
    document_id: z.string().uuid().describe("Document ID"),
  },
  async ({ document_id }) => text({ deleted: await deleteCitationsForDocument(sql, document_id) }),
);

// ─── Document Access Analytics ───────────────────────────────────────────────

server.tool(
  "knowledge_get_document_access_frequency",
  "Get hourly access count for a document over a time window (for decay ranking)",
  {
    document_id: z.string().uuid().describe("Document ID"),
    window_hours: z.number().optional().default(168).describe("Time window in hours (default 168 = 1 week)"),
  },
  async ({ document_id, window_hours }) =>
    text(await getDocumentAccessFrequency(sql, document_id, window_hours)),
);

// ─── Citation Verification ────────────────────────────────────────────────────

server.tool(
  "knowledge_set_citation_verified_status",
  "Mark a citation as verified or retracted, optionally with notes",
  {
    citation_id: z.string().uuid().describe("Citation ID"),
    verified: z.boolean().describe("Whether the citation is verified"),
    notes: z.string().optional().describe("Optional verification notes"),
  },
  async ({ citation_id, verified, notes }) => {
    await setCitationVerifiedStatus(sql, citation_id, verified, notes);
    return text({ success: true });
  },
);

// ─── Index Checkpoints ────────────────────────────────────────────────────────

server.tool(
  "knowledge_create_index_checkpoint",
  "Create a checkpoint for a document's current index state",
  {
    document_id: z.string().uuid(),
    content_hash: z.string(),
    chunk_count: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  },
  async ({ document_id, content_hash, chunk_count, total_tokens }) => {
    const result = await createIndexCheckpoint(sql, document_id, content_hash, chunk_count, total_tokens);
    return text(JSON.stringify(result));
  },
);

server.tool(
  "knowledge_get_checkpoint",
  "Get the latest index checkpoint for a document",
  {
    document_id: z.string().uuid(),
  },
  async ({ document_id }) => {
    const result = await getLatestCheckpoint(sql, document_id);
    return text(JSON.stringify(result));
  },
);

server.tool(
  "knowledge_compute_delta",
  "Compute delta chunks since the last checkpoint",
  {
    document_id: z.string().uuid(),
    new_content_hash: z.string(),
    new_chunk_count: z.number().int().nonnegative(),
    new_total_tokens: z.number().int().nonnegative(),
  },
  async ({ document_id, new_content_hash, new_chunk_count, new_total_tokens }) => {
    const result = await computeDelta(sql, document_id, new_content_hash, new_chunk_count, new_total_tokens);
    return text(JSON.stringify(result));
  },
);

server.tool(
  "knowledge_list_checkpoints",
  "List all checkpoints for a document",
  {
    document_id: z.string().uuid(),
  },
  async ({ document_id }) => {
    const result = await listCheckpoints(sql, document_id);
    return text(JSON.stringify(result));
  },
);

server.tool(
  "knowledge_prune_checkpoints",
  "Prune old checkpoints, keeping only the most recent N versions",
  {
    document_id: z.string().uuid(),
    keep_versions: z.number().int().positive().default(3),
  },
  async ({ document_id, keep_versions }) => {
    const result = await pruneOldCheckpoints(sql, document_id, keep_versions);
    return text(JSON.stringify({ deleted: result }));
  },
);

// ─── Multi-Modal Enrichment ────────────────────────────────────────────────────

server.tool(
  "knowledge_enrich_vision_chunk",
  "Enrich a vision chunk with extracted attributes",
  {
    chunk_id: z.string().uuid(),
    alt_text: z.string().optional(),
    caption: z.string().optional(),
    dominant_colors: z.array(z.string()).optional(),
    scene_text: z.string().optional(),
    is_processed: z.boolean().default(true),
    processing_version: z.number().int().nonnegative().default(1),
  },
  async ({ chunk_id, alt_text, caption, dominant_colors, scene_text, is_processed, processing_version }) => {
    await enrichVisionChunk(sql, chunk_id, { alt_text, caption, dominant_colors, scene_text, is_processed, processing_version });
    return text(JSON.stringify({ chunk_id, enriched: true }));
  },
);

server.tool(
  "knowledge_list_unprocessed_vision",
  "List vision chunks that haven't been enriched yet",
  {
    workspace_id: z.string().uuid(),
    limit: z.number().int().positive().max(200).default(50),
  },
  async ({ workspace_id, limit }) => {
    const result = await listUnprocessedVisionChunks(sql, workspace_id, limit);
    return text(JSON.stringify(result));
  },
);

server.tool(
  "knowledge_classify_citation_type",
  "Classify or update a citation's type",
  {
    citation_id: z.string().uuid(),
    force_type: z.enum(["inline", "footnote", "paraphrase", "reference"]).optional(),
  },
  async ({ citation_id, force_type }) => {
    const result = await classifyCitationType(sql, citation_id, force_type);
    return text(JSON.stringify(result));
  },
);

server.tool(
  "knowledge_set_section_anchor",
  "Set the section anchor for a citation",
  {
    citation_id: z.string().uuid(),
    anchor: z.string(),
  },
  async ({ citation_id, anchor }) => {
    await setSectionAnchor(sql, citation_id, anchor);
    return text(JSON.stringify({ citation_id, anchor }));
  },
);

server.tool(
  "knowledge_get_citations_by_type",
  "Get citations filtered by type for a document",
  {
    document_id: z.string().uuid(),
    citation_type: z.enum(["inline", "footnote", "paraphrase", "reference"]).optional(),
  },
  async ({ document_id, citation_type }) => {
    const result = await getCitationsByType(sql, document_id, citation_type);
    return text(JSON.stringify(result));
  },
);

server.tool(
  "knowledge_verify_citation",
  "Mark a citation as verified or disputed",
  {
    citation_id: z.string().uuid(),
    verified: z.boolean(),
    notes: z.string().optional(),
  },
  async ({ citation_id, verified, notes }) => {
    await setCitationVerifiedStatus(sql, citation_id, verified, notes);
    return text(JSON.stringify({ citation_id, verified }));
  },
);

// Search analytics tools
server.tool(
  "knowledge_log_search",
  "Log a search query and its result count for analytics",
  {
    collection_id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    query_text: z.string(),
    result_count: z.number().int().min(0),
    mode: z.enum(["semantic", "text", "hybrid"]).optional().default("text"),
    response_time_ms: z.number().int().optional(),
    cited_document_ids: z.array(z.string().uuid()).optional(),
    accessed_by: z.string().optional(),
  },
  async ({ collection_id, workspace_id, query_text, result_count, mode, response_time_ms, cited_document_ids, accessed_by }) =>
    text(await logSearchQuery(sql, {
      collectionId: collection_id,
      workspaceId: workspace_id,
      queryText: query_text,
      resultCount: result_count,
      mode,
      responseTimeMs: response_time_ms,
      citedDocumentIds: cited_document_ids,
      accessedBy: accessed_by,
    })),
);

server.tool(
  "knowledge_get_search_analytics",
  "Get search analytics summary for a workspace (queries, avg results, zero-result rate)",
  {
    workspace_id: z.string().uuid(),
    from_hours: z.number().int().positive().optional().default(24),
  },
  async ({ workspace_id, from_hours }) =>
    text(await getSearchAnalytics(sql, workspace_id, from_hours)),
);

server.tool(
  "knowledge_get_top_queries",
  "Get the most frequent search queries in a workspace",
  {
    workspace_id: z.string().uuid(),
    limit: z.number().int().positive().max(100).optional().default(20),
    from_hours: z.number().int().positive().optional().default(168),
  },
  async ({ workspace_id, limit, from_hours }) =>
    text(await getTopQueries(sql, workspace_id, limit, from_hours)),
);

server.tool(
  "knowledge_get_no_result_queries",
  "Get queries that returned zero results — signals content gaps to fill",
  {
    workspace_id: z.string().uuid(),
    limit: z.number().int().positive().max(100).optional().default(50),
    from_hours: z.number().int().positive().optional().default(168),
  },
  async ({ workspace_id, limit, from_hours }) =>
    text(await getNoResultQueries(sql, workspace_id, limit, from_hours)),
);

// Related documents tools
server.tool(
  "knowledge_find_related_documents",
  "Find semantically similar documents based on embedding centroid similarity",
  {
    document_id: z.string().uuid(),
    limit: z.number().int().positive().max(50).optional().default(10),
    min_similarity: z.number().min(0).max(1).optional().default(0.5),
  },
  async ({ document_id, limit, min_similarity }) =>
    text(await findRelatedDocuments(sql, document_id, limit, min_similarity)),
);

server.tool(
  "knowledge_find_related_by_query",
  "Find documents related to a query topic (no document ID needed)",
  {
    collection_id: z.string().uuid(),
    query: z.string(),
    limit: z.number().int().positive().max(50).optional().default(10),
    min_similarity: z.number().min(0).max(1).optional().default(0.3),
  },
  async ({ collection_id, query, limit, min_similarity }) =>
    text(await findRelatedByQuery(sql, collection_id, query, limit, min_similarity)),
);

// Document priority tools
server.tool(
  "knowledge_set_document_priority",
  "Set or update a document's priority score for retrieval boosting",
  {
    document_id: z.string().uuid(),
    priority_score: z.number(),
    reason: z.string().optional(),
    set_by: z.string().optional(),
    expires_at: z.string().datetime().optional(),
  },
  async ({ document_id, priority_score, reason, set_by, expires_at }) =>
    text(await setDocumentPriority(sql, {
      documentId: document_id,
      priorityScore: priority_score,
      reason,
      setBy: set_by,
      expiresAt: expires_at ? new Date(expires_at) : null,
    })),
);

server.tool(
  "knowledge_get_document_priority",
  "Get the priority score for a document",
  { document_id: z.string().uuid() },
  async ({ document_id }) =>
    text(await getDocumentPriority(sql, document_id)),
);

server.tool(
  "knowledge_get_collection_priorities",
  "Get all active document priorities for a collection",
  { collection_id: z.string().uuid() },
  async ({ collection_id }) =>
    text(await getCollectionPriorities(sql, collection_id)),
);

server.tool(
  "knowledge_clear_document_priority",
  "Remove the priority boost from a document",
  { document_id: z.string().uuid() },
  async ({ document_id }) =>
    text({ cleared: await clearDocumentPriority(sql, document_id) }),
);

// Citation circularity detection
server.tool(
  "knowledge_detect_circular_citations",
  "Detect circular citation chains in a collection (document A cites B which cites A)",
  {
    collection_id: z.string().uuid(),
    depth: z.number().int().positive().max(10).optional().default(3),
  },
  async ({ collection_id, depth }) =>
    text(await detectCircularCitations(sql, collection_id, depth)),
);

// Search click recording
server.tool(
  "knowledge_record_search_clicks",
  "Record which documents a user clicked on from search results",
  {
    workspace_id: z.string().uuid(),
    query_id: z.string().uuid().optional(),
    document_ids: z.array(z.string().uuid()),
    clicked_by: z.string().optional(),
  },
  async ({ workspace_id, query_id, document_ids, clicked_by }) => {
    await recordSearchClicks(sql, {
      workspaceId: workspace_id,
      queryId: query_id,
      documentIds: document_ids,
      clickedBy: clicked_by,
    });
    return text({ ok: true, clicked: document_ids.length });
  },
);

// Index checkpoint management
server.tool(
  "knowledge_create_index_checkpoint",
  "Create an index checkpoint for a collection (snapshot for incremental indexing)",
  {
    collection_id: z.string().uuid(),
    metadata: z.record(z.unknown()).optional(),
  },
  async ({ collection_id, metadata }) =>
    text(await createIndexCheckpoint(sql, collection_id, metadata)),
);

server.tool(
  "knowledge_get_latest_checkpoint",
  "Get the most recent checkpoint for a collection",
  { collection_id: z.string().uuid() },
  async ({ collection_id }) =>
    text(await getLatestCheckpoint(sql, collection_id)),
);

server.tool(
  "knowledge_compute_delta",
  "Compute the delta (changed chunks) between current index and a checkpoint",
  {
    collection_id: z.string().uuid(),
    checkpoint_id: z.string().uuid(),
  },
  async ({ collection_id, checkpoint_id }) =>
    text(await computeDelta(sql, collection_id, checkpoint_id)),
);

server.tool(
  "knowledge_list_checkpoints",
  "List all checkpoints for a collection",
  {
    collection_id: z.string().uuid(),
    limit: z.number().int().positive().max(100).optional().default(20),
  },
  async ({ collection_id, limit }) =>
    text(await listCheckpoints(sql, collection_id, limit)),
);

server.tool(
  "knowledge_prune_old_checkpoints",
  "Delete checkpoints older than a given cutoff date",
  {
    collection_id: z.string().uuid(),
    older_than: z.string().datetime(),
  },
  async ({ collection_id, older_than }) => {
    const pruned = await pruneOldCheckpoints(sql, collection_id, new Date(older_than));
    return text({ pruned });
  },
);

server.tool(
  "knowledge_get_delta_chunks",
  "Get the delta chunks for a checkpoint",
  {
    checkpoint_id: z.string().uuid(),
    limit: z.number().int().positive().max(1000).optional().default(100),
    offset: z.number().int().min(0).optional().default(0),
  },
  async ({ checkpoint_id, limit, offset }) =>
    text(await getDeltaChunks(sql, checkpoint_id, limit, offset)),
);

// --- Collection management tools ---

server.tool(
  "knowledge_get_collection",
  "Get a collection by ID with full metadata",
  { collection_id: z.string().describe("Collection ID") },
  async ({ collection_id }) => {
    const collection = await getCollection(sql, collection_id);
    return text(collection ?? { error: "Collection not found" });
  },
);

server.tool(
  "knowledge_delete_collection",
  "Delete a collection and all its documents, chunks, and citations",
  { collection_id: z.string().describe("Collection ID") },
  async ({ collection_id }) => {
    const deleted = await deleteCollection(sql, collection_id);
    return text({ deleted });
  },
);

// --- Document management tools ---

server.tool(
  "knowledge_get_document",
  "Get a document by ID with metadata and content hash",
  { document_id: z.string().describe("Document ID") },
  async ({ document_id }) => {
    const doc = await getDocument(sql, document_id);
    return text(doc ?? { error: "Document not found" });
  },
);

server.tool(
  "knowledge_get_document_by_id",
  "Get a document by its UUID",
  { id: z.string().describe("Document UUID") },
  async ({ id }) => {
    const doc = await getDocumentById(sql, id);
    return text(doc ?? { error: "Document not found" });
  },
);

server.tool(
  "knowledge_hash_content",
  "Compute the content hash of a string (for change detection)",
  { content: z.string().describe("Content to hash") },
  async ({ content }) => {
    const hash = await hashContent(content);
    return text({ hash, length: content.length });
  },
);

// --- Chunk utilities ---

server.tool(
  "knowledge_estimate_tokens",
  "Estimate the token count for a text string",
  { text: z.string().describe("Text to count tokens for") },
  async ({ text }) => {
    const tokens = estimateTokens(text);
    return text({ estimate: tokens, characters: text.length });
  },
);

server.tool(
  "knowledge_chunk_text",
  "Split text into chunks using a specified strategy",
  {
    text: z.string().describe("Text to chunk"),
    strategy: z.enum(["fixed", "paragraph", "sentence", "recursive"]).optional().default("recursive"),
    chunk_size: z.number().optional().default(1000).describe("Target chunk size in characters"),
    chunk_overlap: z.number().optional().default(200).describe("Overlap between chunks"),
  },
  async ({ text, strategy, chunk_size, chunk_overlap }) => {
    const chunks = chunkText(text, {
      strategy,
      chunkSize: chunk_size,
      chunkOverlap: chunk_overlap,
    });
    return text({ chunks, count: chunks.length });
  },
);

// --- Vision chunk tools ---

server.tool(
  "knowledge_get_vision_chunk",
  "Get a specific vision chunk by ID",
  { chunk_id: z.string().describe("Vision chunk ID") },
  async ({ chunk_id }) => {
    const chunk = await getVisionChunkById(sql, chunk_id);
    return text(chunk ?? { error: "Vision chunk not found" });
  },
);

server.tool(
  "knowledge_delete_vision_chunks",
  "Delete all vision chunks for a document",
  { document_id: z.string().describe("Document ID") },
  async ({ document_id }) => {
    const deleted = await deleteVisionChunks(sql, document_id);
    return text({ deleted });
  },
);

// --- Citation tools ---

server.tool(
  "knowledge_get_citations_made_by_chunk",
  "Get all citations made by a specific chunk (outgoing citations)",
  { chunk_id: z.string().describe("Chunk ID doing the citing") },
  async ({ chunk_id }) => {
    const citations = await getCitationsMadeByChunk(sql, chunk_id);
    return text(citations);
  },
);

server.tool(
  "knowledge_delete_citation",
  "Delete a citation by ID",
  { citation_id: z.string().describe("Citation ID to delete") },
  async ({ citation_id }) => {
    await deleteCitation(sql, citation_id);
    return text({ deleted: true });
  },
);

// --- Knowledge graph traversal ---

server.tool(
  "knowledge_get_citing_documents",
  "Get all documents that cite a given document (incoming citations)",
  {
    document_id: z.string().describe("Document being cited"),
    limit: z.number().optional().default(20),
  },
  async ({ document_id, limit }) => {
    const docs = await getCitingDocuments(sql, document_id, limit ?? 20);
    return text(docs);
  },
);

server.tool(
  "knowledge_get_cited_documents",
  "Get all documents cited by a given document (outgoing citations)",
  {
    document_id: z.string().describe("Document doing the citing"),
    limit: z.number().optional().default(20),
  },
  async ({ document_id, limit }) => {
    const docs = await getCitedDocuments(sql, document_id, limit ?? 20);
    return text(docs);
  },
);

// --- Document access tracking ---

server.tool(
  "knowledge_touch_document",
  "Mark a document as recently accessed (updates last_accessed timestamp)",
  {
    document_id: z.string().describe("Document ID"),
    user_id: z.string().optional().describe("User ID who accessed it"),
  },
  async ({ document_id, user_id }) => {
    await touchDocument(sql, document_id, user_id);
    return text({ ok: true });
  },
);

// --- Indexing job queue tools ---

server.tool(
  "knowledge_dequeue_indexing_job",
  "Atomically dequeue the next pending indexing job (for background workers)",
  { workspace_id: z.string().describe("Workspace ID") },
  async ({ workspace_id }) => {
    const job = await dequeueIndexingJob(sql, workspace_id);
    return text(job ?? { queued: false });
  },
);

server.tool(
  "knowledge_complete_indexing_job",
  "Mark an indexing job as successfully completed",
  {
    job_id: z.string().describe("Job ID"),
    result: z.record(z.any()).optional().describe("Result metadata"),
  },
  async ({ job_id, result }) => {
    await completeIndexingJob(sql, job_id, result);
    return text({ completed: true });
  },
);

server.tool(
  "knowledge_fail_indexing_job",
  "Mark an indexing job as failed with an error message",
  {
    job_id: z.string().describe("Job ID"),
    error: z.string().describe("Error message"),
  },
  async ({ job_id, error }) => {
    await failIndexingJob(sql, job_id, error);
    return text({ failed: true });
  },
);

server.tool(
  "knowledge_process_indexing_job",
  "Process a single indexing job (fetch, chunk, embed, store) — for background workers",
  {
    job_id: z.string().describe("Job ID"),
    collection_id: z.string().describe("Collection ID"),
  },
  async ({ job_id, collection_id }) => {
    const result = await processIndexingJob(sql, job_id, collection_id);
    return text(result);
  },
);

// --- Document extraction tools ---

server.tool(
  "knowledge_extract_from_html",
  "Extract clean text from HTML content",
  { html: z.string().describe("HTML content") },
  async ({ html }) => {
    const result = await extractFromHtml(html);
    return text({ text: result.text, metadata: result.metadata });
  },
);

server.tool(
  "knowledge_extract_from_markdown",
  "Extract text from Markdown content (strips formatting)",
  { markdown: z.string().describe("Markdown content") },
  async ({ markdown }) => {
    const result = await extractFromMarkdown(markdown);
    return text({ text: result.text, metadata: result.metadata });
  },
);

server.tool(
  "knowledge_extract_from_plain_text",
  "Process plain text content (applies basic normalization)",
  { text: z.string().describe("Plain text content") },
  async ({ text }) => {
    const result = await extractFromPlainText(text);
    return text({ text: result.text, metadata: result.metadata });
  },
);

// --- Multimodal enrichment tools ---

server.tool(
  "knowledge_get_enriched_vision_chunk",
  "Get an enriched vision chunk with all extracted attributes",
  { chunk_id: z.string().describe("Vision chunk ID") },
  async ({ chunk_id }) => {
    const chunk = await getEnrichedVisionChunk(sql, chunk_id);
    return text(chunk ?? { error: "Vision chunk not found" });
  },
);

// --- Related documents tools ---

server.tool(
  "knowledge_get_document_centroid",
  "Get the embedding centroid for a document (average of all chunk embeddings)",
  { document_id: z.string().describe("Document ID") },
  async ({ document_id }) => {
    const centroid = await getDocumentCentroid(sql, document_id);
    return text(centroid ?? { error: "Document not found or no embeddings" });
  },
);

// --- Document priority tools ---

server.tool(
  "knowledge_prune_old_checkpoints",
  "Delete checkpoints older than a given cutoff date",
  {
    collection_id: z.string().uuid(),
    older_than: z.string().datetime().describe("ISO timestamp — delete checkpoints older than this"),
  },
  async ({ collection_id, older_than }) => {
    const result = await pruneOldCheckpoints(sql, collection_id, new Date(older_than));
    return text({ pruned: result });
  },
);

server.tool(
  "knowledge_get_delta_chunks",
  "Get the delta chunks for a checkpoint (chunks that changed since checkpoint)",
  {
    checkpoint_id: z.string().uuid(),
    limit: z.number().int().positive().max(1000).optional().default(100),
    offset: z.number().int().min(0).optional().default(0),
  },
  async ({ checkpoint_id, limit, offset }) =>
    text(await getDeltaChunks(sql, checkpoint_id, limit, offset)),
);

server.tool(
  "knowledge_get_document_centroid",
  "Get the embedding centroid (average of all chunk embeddings) for a document — used for related document finding",
  { document_id: z.string().describe("Document ID") },
  async ({ document_id }) => {
    const centroid = await getDocumentCentroid(sql, document_id);
    return text(centroid ?? { error: "Document not found or no embeddings stored" });
  },
);

server.tool(
  "knowledge_prune_expired_priorities",
  "Remove expired document priority boosts from the database",
  { collection_id: z.string().describe("Collection ID") },
  async ({ collection_id }) => {
    const pruned = await pruneExpiredPriorities(sql, collection_id);
    return text({ pruned });
  },
);

server.tool(
  "knowledge_boost_scores",
  "Apply priority boost scores to retrieval results (post-retrieval re-ranking)",
  {
    results: z.array(z.object({
      document_id: z.string(),
      score: z.number(),
    })).describe("Retrieval results with scores"),
    collection_id: z.string().describe("Collection ID"),
  },
  async ({ results, collection_id }) => {
    const boosted = await boostScores(sql, results as any, collection_id);
    return text(boosted);
  },
);

// ---------------------------------------------------------------------------
// Incremental indexing
// ---------------------------------------------------------------------------

server.tool(
  "knowledge_get_document_by_hash",
  "Look up a document by its content hash within a collection",
  {
    collection_id: z.string().describe("Collection ID"),
    content_hash: z.string().describe("Content hash to look up"),
  },
  async ({ collection_id, content_hash }) => {
    const doc = await getDocumentByHash(sql, collection_id, content_hash);
    if (!doc) return text({ found: false });
    return text({ found: true, document: doc });
  },
);

server.tool(
  "knowledge_get_stored_content_hash",
  "Get the stored content hash for a document — useful for change detection without fetching full content",
  {
    document_id: z.string().describe("Document UUID"),
  },
  async ({ document_id }) => {
    const hash = await getStoredContentHash(sql, document_id);
    if (hash === null) return text({ found: false, document_id });
    return text({ found: true, document_id, content_hash: hash });
  },
);

server.tool(
  "knowledge_reindex_document",
  "Force reindex a document: compute hash, skip if unchanged, or re-chunk and re-embed",
  {
    document_id: z.string().describe("Document ID to reindex"),
    force: z.boolean().optional().default(false).describe("Force reindex even if hash unchanged"),
  },
  async ({ document_id, force }) => {
    const result = await indexDocumentIncremental(sql, document_id, { force });
    return text(result);
  },
);

// --- Multi-format document processing ---

server.tool(
  "knowledge_detect_format",
  "Detect document format (pdf, docx, html, markdown, plaintext) from content bytes and/or mime type",
  {
    content: z.string().optional().describe("Document content as string"),
    mime_type: z.string().optional().describe("MIME type of the document"),
  },
  async ({ content, mime_type }) => {
    const { detectFormat } = await import("../lib/document-processors.js");
    const format = detectFormat(content ?? "", mime_type);
    return text({ format, supported: format !== "unknown" });
  },
);

server.tool(
  "knowledge_extract_from_html",
  "Extract structured text from HTML content, preserving headings, paragraphs, lists, tables, and code blocks",
  {
    html: z.string().describe("HTML content to extract from"),
    preserve_structure: z.boolean().optional().default(true),
  },
  async ({ html, preserve_structure }) => {
    const { extractFromHtml } = await import("../lib/document-processors.js");
    return text(await extractFromHtml(html, { preserveStructure: preserve_structure ?? true }));
  },
);

server.tool(
  "knowledge_extract_from_markdown",
  "Extract structured text from markdown, preserving headings, lists, code blocks, and tables",
  {
    markdown: z.string().describe("Markdown content to extract from"),
  },
  async ({ markdown }) => {
    const { extractFromMarkdown } = await import("../lib/document-processors.js");
    return text(await extractFromMarkdown(markdown));
  },
);

// --- Document access analytics ---

server.tool(
  "knowledge_get_document_access_frequency",
  "Get access frequency statistics for a document — view count, last accessed, trend",
  {
    document_id: z.string().describe("Document ID"),
    since_days: z.number().int().optional().describe("Window in days (default 30)"),
  },
  async ({ document_id, since_days }) => {
    const { getDocumentAccessFrequency } = await import("../lib/document-access.js");
    return text(await getDocumentAccessFrequency(sql, document_id, since_days ?? 30));
  },
);

server.tool(
  "knowledge_log_document_access",
  "Log a document access event for analytics and popularity tracking",
  {
    document_id: z.string(),
    user_id: z.string().optional(),
    access_type: z.enum(["read", "search", "cite", "embed"]).default("read"),
    metadata: z.record(z.any()).optional(),
  },
  async ({ document_id, user_id, access_type, metadata }) => {
    const { logDocumentAccess } = await import("../lib/document-access.js");
    await logDocumentAccess(sql, { documentId: document_id, userId: user_id, accessType: access_type, metadata });
    return text({ logged: true });
  },
);

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

// --- Indexing queue management ---

server.tool(
  "knowledge_get_indexing_queue_stats",
  "Get statistics about the background indexing queue: pending, processing, failed, total",
  {
    collection_id: z.string().optional().describe("Filter by collection UUID"),
  },
  async ({ collection_id }) => {
    const { getIndexingQueueStats } = await import("../lib/indexing-jobs.js");
    const stats = await getIndexingQueueStats(sql, collection_id);
    return text(stats);
  },
);

server.tool(
  "knowledge_log_search_query",
  "Log a search query for analytics — track what users are searching for",
  {
    workspace_id: z.string().uuid().describe("Workspace UUID"),
    query: z.string().describe("Search query text"),
    collection_id: z.string().optional().describe("Collection UUID if scoped"),
    result_count: z.number().int().optional().describe("Number of results returned"),
    clicked_doc_id: z.string().optional().describe("Document ID clicked, if any"),
  },
  async ({ workspace_id, query, collection_id, result_count, clicked_doc_id }) => {
    const { logSearchQuery } = await import("../lib/search-analytics.js");
    await logSearchQuery(sql, {
      workspaceId: workspace_id,
      query,
      collectionId: collection_id ?? null,
      resultCount: result_count ?? 0,
      clickedDocId: clicked_doc_id ?? null,
    });
    return text({ logged: true });
  },
);

// --- Document priority management ---

server.tool(
  "knowledge_get_collection_priorities",
  "Get all document priorities for a collection",
  {
    collection_id: z.string().uuid().describe("Collection UUID"),
    limit: z.number().int().optional().default(100),
    offset: z.number().int().optional().default(0),
  },
  async ({ collection_id, limit, offset }) => {
    const { getCollectionPriorities } = await import("../lib/doc-priority.js");
    return text(await getCollectionPriorities(sql, collection_id, { limit, offset }));
  },
);

server.tool(
  "knowledge_clear_document_priority",
  "Clear the priority boost for a document",
  {
    document_id: z.string().uuid().describe("Document UUID"),
  },
  async ({ document_id }) => {
    const { clearDocumentPriority } = await import("../lib/doc-priority.js");
    return text(await clearDocumentPriority(sql, document_id));
  },
);

server.tool(
  "knowledge_prune_expired_priorities",
  "Remove expired priority boosts from the priority table",
  {
    collection_id: z.string().uuid().optional().describe("Collection UUID to scope pruning"),
  },
  async ({ collection_id }) => {
    const { pruneExpiredPriorities } = await import("../lib/doc-priority.js");
    const pruned = await pruneExpiredPriorities(sql, collection_id);
    return text({ pruned_count: pruned });
  },
);

// --- Query Intent Classification ---

server.tool(
  "knowledge_classify_query_intent",
  "Classify a search query by intent (factual, conversational, analytical, navigational) to select the best retrieval strategy",
  {
    query: z.string().describe("The search or retrieval query to classify"),
  },
  async ({ query }) => text(await classifyQueryIntent(query)),
);

server.tool(
  "knowledge_record_query_intent",
  "Record a query intent classification for analytics — track intent distribution over time",
  {
    workspace_id: z.string().describe("Workspace ID"),
    query: z.string().describe("The original query"),
    intent: z.enum(["factual", "conversational", "analytical", "navigational", "unknown"]).describe("Classified intent"),
    confidence: z.number().min(0).max(1).describe("Classification confidence score"),
    strategy_used: z.string().optional().describe("Retrieval strategy that was used"),
  },
  async ({ workspace_id, query, intent, confidence, strategy_used }) => {
    await recordQueryIntent(sql, workspace_id, query, intent, confidence, strategy_used);
    return text({ recorded: true });
  },
);

server.tool(
  "knowledge_get_intent_distribution",
  "Get query intent distribution analytics for a workspace — which intents are most common",
  {
    workspace_id: z.string().describe("Workspace ID"),
    since: z.string().optional().describe("ISO date — start of window (default 30 days)"),
  },
  async ({ workspace_id, since }) =>
    text(await getIntentDistribution(sql, workspace_id, since)),
);

server.tool(
  "knowledge_get_low_confidence_queries",
  "Get queries with low-confidence intent classifications — potential edge cases to improve detection",
  {
    workspace_id: z.string().describe("Workspace ID"),
    threshold: z.number().min(0).max(1).optional().default(0.3).describe("Confidence threshold"),
    limit: z.number().int().positive().optional().default(50),
  },
  async ({ workspace_id, threshold, limit }) =>
    text(await getLowConfidenceQueries(sql, workspace_id, threshold, limit)),
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// --- Incremental indexing ---

server.tool(
  "knowledge_index_document_incremental",
  "Index a document incrementally — only re-processes chunks whose content has changed since last index, skipping unchanged content",
  {
    document_id: z.string().uuid().describe("Document UUID to index incrementally"),
  },
  async ({ document_id }) => {
    const { indexDocumentIncremental } = await import("../lib/incremental.js");
    const result = await indexDocumentIncremental(sql, document_id);
    return text(result);
  },
);

server.tool(
  "knowledge_reindex_if_changed",
  "Re-index a document only if its content hash has changed — returns whether re-indexing occurred",
  {
    document_id: z.string().uuid().describe("Document UUID"),
  },
  async ({ document_id }) => {
    const { reindexIfChanged } = await import("../lib/incremental.js");
    const result = await reindexIfChanged(sql, document_id);
    return text(result);
  },
);

server.tool(
  "knowledge_force_reindex_document",
  "Force a full re-index of a document, deleting all existing chunks and creating new ones from scratch",
  {
    document_id: z.string().uuid().describe("Document UUID to force re-index"),
  },
  async ({ document_id }) => {
    const { forceReindexDocument } = await import("../lib/incremental.js");
    const result = await forceReindexDocument(sql, document_id);
    return text(result);
  },
);

server.tool(
  "knowledge_compute_document_hash",
  "Compute a content hash for a document — use to check if a document has changed before re-indexing",
  {
    content: z.string().describe("Document content to hash"),
  },
  async ({ content }) => {
    const { computeDocumentHash } = await import("../lib/incremental.js");
    const hash = await computeDocumentHash(content);
    return text({ hash });
  },
);

// --- Citation management ---

server.tool(
  "knowledge_add_citation",
  "Add a citation link between two chunks — records that the source chunk references the target chunk",
  {
    source_chunk_id: z.string().uuid().describe("Chunk UUID making the citation"),
    target_chunk_id: z.string().uuid().describe("Chunk UUID being cited"),
    citation_type: z.string().optional().describe("Type of citation (e.g., 'quotes', 'references', 'builds_on')"),
    context: z.string().optional().describe("Text context around the citation"),
  },
  async ({ source_chunk_id, target_chunk_id, citation_type, context }) => {
    const { addCitation } = await import("../lib/citations.js");
    const citation = await addCitation(sql, { sourceChunkId: source_chunk_id, targetChunkId: target_chunk_id, citationType: citation_type ?? "references", context: context ?? null });
    return text(citation);
  },
);

server.tool(
  "knowledge_get_citations_for_chunk",
  "Get all citations made by a specific chunk — what other chunks does this chunk cite",
  { chunk_id: z.string().uuid().describe("Chunk UUID") },
  async ({ chunk_id }) => {
    const { getCitationsForChunk } = await import("../lib/citations.js");
    const citations = await getCitationsForChunk(sql, chunk_id);
    return text({ citations, count: citations.length });
  },
);

server.tool(
  "knowledge_get_citations_made_by_chunk",
  "Get all incoming citations to a chunk — what other chunks cite this chunk",
  { chunk_id: z.string().uuid().describe("Chunk UUID") },
  async ({ chunk_id }) => {
    const { getCitationsMadeByChunk } = await import("../lib/citations.js");
    const citations = await getCitationsMadeByChunk(sql, chunk_id);
    return text({ citations, count: citations.length });
  },
);

server.tool(
  "knowledge_find_citing_documents",
  "Find all documents that cite a given document",
  { document_id: z.string().uuid().describe("Document UUID") },
  async ({ document_id }) => {
    const { findCitingDocuments } = await import("../lib/citations.js");
    const docs = await findCitingDocuments(sql, document_id);
    return text({ documents: docs, count: docs.length });
  },
);

server.tool(
  "knowledge_delete_citations_for_document",
  "Delete all citations associated with a document — used when re-indexing or deleting a document",
  { document_id: z.string().uuid().describe("Document UUID") },
  async ({ document_id }) => {
    const { deleteCitationsForDocument } = await import("../lib/citations.js");
    const count = await deleteCitationsForDocument(sql, document_id);
    return text({ deleted_count: count });
  },
);

// --- Citation provenance ---

server.tool(
  "knowledge_verify_citation",
  "Verify a citation — mark it as confirmed or disputed and add a note",
  {
    citation_id: z.string().uuid().describe("Citation UUID to verify"),
    verified: z.boolean().describe("Whether the citation is confirmed"),
    note: z.string().optional().describe("Verification note"),
  },
  async ({ citation_id, verified, note }) => {
    const { verifyCitation } = await import("../lib/citation-provenance.js");
    const result = await verifyCitation(sql, citation_id, verified, note ?? null);
    return text(result);
  },
);

server.tool(
  "knowledge_get_provenance_chain",
  "Get the full provenance chain for a citation — trace back to root sources",
  { chunk_id: z.string().uuid().describe("Starting chunk UUID") },
  async ({ chunk_id }) => {
    const { getProvenanceChain } = await import("../lib/citation-provenance.js");
    const chain = await getProvenanceChain(sql, chunk_id);
    return text({ chain });
  },
);

server.tool(
  "knowledge_detect_circular_citations",
  "Detect circular citation chains where documents cite each other in a loop",
  { collection_id: z.string().uuid().optional().describe("Collection UUID to check (omit for all)") },
  async ({ collection_id }) => {
    const { detectCircularCitations } = await import("../lib/citation-provenance.js");
    const cycles = await detectCircularCitations(sql, collection_id ?? null);
    return text({ cycles_found: cycles.length, cycles });
  },
);

server.tool(
  "knowledge_list_citations_by_trust",
  "List citations filtered by trust score — useful for finding high vs low confidence references",
  {
    collection_id: z.string().uuid().optional().describe("Collection UUID"),
    min_trust: z.number().optional().default(0).describe("Minimum trust score (0-1)"),
    limit: z.number().int().optional().default(50),
  },
  async ({ collection_id, min_trust, limit }) => {
    const { listCitationsByTrust } = await import("../lib/citation-provenance.js");
    const citations = await listCitationsByTrust(sql, collection_id ?? null, min_trust, limit);
    return text({ citations, count: citations.length });
  },
);

// --- Citation graph ---

server.tool(
  "knowledge_get_outgoing_citations",
  "Get all outgoing citations from a chunk — chunks this chunk cites",
  { chunk_id: z.string().uuid().describe("Chunk UUID") },
  async ({ chunk_id }) => {
    const { getOutgoingCitations } = await import("../lib/citation-graph.js");
    const citations = await getOutgoingCitations(sql, chunk_id);
    return text({ citations, count: citations.length });
  },
);

server.tool(
  "knowledge_get_incoming_citations",
  "Get all incoming citations to a chunk — chunks that cite this chunk",
  { chunk_id: z.string().uuid().describe("Chunk UUID") },
  async ({ chunk_id }) => {
    const { getIncomingCitations } = await import("../lib/citation-graph.js");
    const citations = await getIncomingCitations(sql, chunk_id);
    return text({ citations, count: citations.length });
  },
);

server.tool(
  "knowledge_find_root_source_documents",
  "Find documents that are root sources — documents that cite others but are not cited by anything",
  { collection_id: z.string().uuid().optional().describe("Collection UUID") },
  async ({ collection_id }) => {
    const { findRootSourceDocuments } = await import("../lib/citation-graph.js");
    const docs = await findRootSourceDocuments(sql, collection_id ?? null);
    return text({ documents: docs, count: docs.length });
  },
);

server.tool(
  "knowledge_compute_impact_scores",
  "Compute impact scores for documents based on citation counts — identifies the most influential sources",
  { collection_id: z.string().uuid().optional().describe("Collection UUID") },
  async ({ collection_id }) => {
    const { computeImpactScores } = await import("../lib/citation-graph.js");
    const scores = await computeImpactScores(sql, collection_id ?? null);
    return text({ scores, count: scores.length });
  },
);

// --- Vision / Multi-modal ---

server.tool(
  "knowledge_store_vision_chunk",
  "Store a vision-enriched chunk extracted from an image in a document",
  {
    document_id: z.string().uuid().describe("Parent document UUID"),
    chunk_id: z.string().uuid().describe("Parent chunk UUID"),
    image_description: z.string().describe("AI-generated description of the image"),
    extracted_text: z.string().describe("Text extracted from the image (OCR or image captioning)"),
    visual_elements: z.array(z.object({ type: z.string(), content: z.string() })).optional().describe("Detected visual elements"),
    mime_type: z.string().optional().default("image/png").describe("Image MIME type"),
    source_ref: z.string().optional().describe("Reference to image location in source document"),
  },
  async ({ document_id, chunk_id, image_description, extracted_text, visual_elements, mime_type, source_ref }) => {
    const { storeVisionChunk } = await import("../lib/vision.js");
    const chunk = await storeVisionChunk(sql, { documentId: document_id, chunkId: chunk_id, imageDescription: image_description, extractedText: extracted_text, visualElements: visual_elements ?? null, mimeType: mime_type ?? "image/png", sourceRef: source_ref ?? null });
    return text(chunk);
  },
);

server.tool(
  "knowledge_get_vision_chunks",
  "Get all vision chunks for a document — images and their extracted text/description",
  { document_id: z.string().uuid().describe("Document UUID") },
  async ({ document_id }) => {
    const { getVisionChunks } = await import("../lib/vision.js");
    const chunks = await getVisionChunks(sql, document_id);
    return text({ chunks, count: chunks.length });
  },
);

server.tool(
  "knowledge_delete_vision_chunks",
  "Delete all vision chunks for a document",
  { document_id: z.string().uuid().describe("Document UUID") },
  async ({ document_id }) => {
    const { deleteVisionChunks } = await import("../lib/vision.js");
    const count = await deleteVisionChunks(sql, document_id);
    return text({ deleted_count: count });
  },
);

// --- Multimodal enrichment ---

server.tool(
  "knowledge_enrich_vision_chunk",
  "Enrich a vision chunk with additional analysis — detects objects, text, faces, and adds structured metadata",
  {
    vision_chunk_id: z.string().uuid().describe("Vision chunk UUID to enrich"),
    enrichment_type: z.enum(["objects", "text", "faces", "scene", "all"]).describe("Type of enrichment to apply"),
  },
  async ({ vision_chunk_id, enrichment_type }) => {
    const { enrichVisionChunk } = await import("../lib/multimodal-enrichment.js");
    const enriched = await enrichVisionChunk(sql, vision_chunk_id, enrichment_type);
    return text(enriched);
  },
);

server.tool(
  "knowledge_list_unprocessed_vision_chunks",
  "List vision chunks that have not yet been enriched — useful for batch processing",
  {
    collection_id: z.string().uuid().optional().describe("Filter by collection"),
    enrichment_type: z.string().optional().describe("Enrichment type filter"),
    limit: z.number().int().optional().default(50),
  },
  async ({ collection_id, enrichment_type, limit }) => {
    const { listUnprocessedVisionChunks } = await import("../lib/multimodal-enrichment.js");
    const chunks = await listUnprocessedVisionChunks(sql, collection_id ?? null, enrichment_type ?? null, limit);
    return text({ chunks, count: chunks.length });
  },
);

// --- Index checkpoints ---

server.tool(
  "knowledge_create_index_checkpoint",
  "Create an index checkpoint — snapshots the current index state for resumable incremental indexing",
  {
    collection_id: z.string().uuid().describe("Collection UUID"),
    job_id: z.string().uuid().optional().describe("Indexing job ID"),
    metadata: z.record(z.any()).optional().describe("Additional checkpoint metadata"),
  },
  async ({ collection_id, job_id, metadata }) => {
    const { createIndexCheckpoint } = await import("../lib/index-checkpoints.js");
    const checkpoint = await createIndexCheckpoint(sql, collection_id, job_id ?? null, metadata ?? null);
    return text(checkpoint);
  },
);

server.tool(
  "knowledge_get_latest_checkpoint",
  "Get the most recent index checkpoint for a collection",
  { collection_id: z.string().uuid().describe("Collection UUID") },
  async ({ collection_id }) => {
    const { getLatestCheckpoint } = await import("../lib/index-checkpoints.js");
    const checkpoint = await getLatestCheckpoint(sql, collection_id);
    return text(checkpoint);
  },
);

server.tool(
  "knowledge_compute_delta",
  "Compute the delta between two index checkpoints — returns chunks added/removed/modified between checkpoints",
  {
    from_checkpoint_id: z.string().uuid().describe("Earlier checkpoint UUID"),
    to_checkpoint_id: z.string().uuid().describe("Later checkpoint UUID"),
  },
  async ({ from_checkpoint_id, to_checkpoint_id }) => {
    const { computeDelta } = await import("../lib/index-checkpoints.js");
    const delta = await computeDelta(sql, from_checkpoint_id, to_checkpoint_id);
    return text(delta);
  },
);

server.tool(
  "knowledge_list_checkpoints",
  "List all index checkpoints for a collection",
  {
    collection_id: z.string().uuid().describe("Collection UUID"),
    limit: z.number().int().optional().default(20),
  },
  async ({ collection_id, limit }) => {
    const { listCheckpoints } = await import("../lib/index-checkpoints.js");
    const checkpoints = await listCheckpoints(sql, collection_id, limit);
    return text({ checkpoints, count: checkpoints.length });
  },
);

server.tool(
  "knowledge_prune_old_checkpoints",
  "Prune old index checkpoints beyond a given age — keeps storage clean",
  {
    collection_id: z.string().uuid().optional().describe("Collection UUID (omit for all collections)"),
    older_than_days: z.number().int().optional().default(7).describe("Delete checkpoints older than N days"),
  },
  async ({ collection_id, older_than_days }) => {
    const { pruneOldCheckpoints } = await import("../lib/index-checkpoints.js");
    const pruned = await pruneOldCheckpoints(sql, collection_id ?? null, older_than_days);
    return text({ pruned_count: pruned });
  },
);

// --- Graph Walk & Importance ---
server.tool(
  "knowledge_graph_walk",
  "Walk the citation graph from a starting document using BFS — returns reachable documents up to max_depth",
  {
    start_document_id: z.string().describe("Document ID to start walking from"),
    max_depth: z.number().int().optional().default(3).describe("Maximum traversal depth"),
    limit: z.number().int().optional().default(100).describe("Maximum number of documents to return"),
  },
  async ({ start_document_id, max_depth, limit }) => {
    const nodes = await graphWalk(sql, start_document_id, max_depth, limit);
    return text({ nodes, count: nodes.length });
  },
);

server.tool(
  "knowledge_compute_importance",
  "Compute importance scores for all documents in a collection based on citation counts",
  {
    collection_id: z.string().uuid().describe("Collection UUID"),
  },
  async ({ collection_id }) => {
    const results = await computeCollectionImportance(sql, collection_id);
    return text({ documents: results, count: results.length });
  },
);

server.tool(
  "knowledge_get_citing_documents",
  "Get documents that cite a given document (incoming citation edges)",
  {
    document_id: z.string().describe("Document ID"),
    limit: z.number().int().optional().default(50).describe("Maximum results"),
  },
  async ({ document_id, limit }) => {
    const docs = await getCitingDocuments(sql, document_id, limit);
    return text({ citing_documents: docs, count: docs.length });
  },
);

server.tool(
  "knowledge_get_cited_documents",
  "Get documents cited by a given document (outgoing citation edges)",
  {
    document_id: z.string().describe("Document ID"),
    limit: z.number().int().optional().default(50).describe("Maximum results"),
  },
  async ({ document_id, limit }) => {
    const docs = await getCitedDocuments(sql, document_id, limit);
    return text({ cited_documents: docs, count: docs.length });
  },
);

// --- Incremental Indexing ---
server.tool(
  "knowledge_incremental_reindex",
  "Re-index a document only if its content hash has changed — skips unchanged documents",
  {
    document_id: z.string().describe("Document ID to re-index"),
  },
  async ({ document_id }) => {
    const result = await indexDocumentIncremental(sql, document_id);
    return text(result);
  },
);

server.tool(
  "knowledge_document_hash",
  "Get current and stored content hashes for a document to detect changes",
  {
    document_id: z.string().describe("Document ID"),
    content: z.string().optional().describe("Content to hash (omit to get stored hash only)"),
  },
  async ({ document_id, content }) => {
    const storedHash = await getStoredContentHash(sql, document_id);
    const currentHash = content ? await computeDocumentHash(content) : storedHash;
    const changed = storedHash !== null && storedHash !== currentHash;
    return text({ document_id, stored_hash: storedHash, current_hash: currentHash, content_changed: changed });
  },
);

// --- Citation Classification & Verification ---
server.tool(
  "knowledge_classify_citation_type",
  "Classify a citation as inline, footnote, paraphrase, or reference based on content patterns",
  {
    citation_id: z.string().describe("Citation ID to classify"),
    force_type: z.enum(["inline", "footnote", "paraphrase", "reference"]).optional().describe("Override classification"),
  },
  async ({ citation_id, force_type }) => {
    const type = await classifyCitationType(sql, citation_id, force_type);
    return text({ citation_id, citation_type: type });
  },
);

server.tool(
  "knowledge_get_citations_by_type",
  "Get all citations for a document, optionally filtered by citation type",
  {
    document_id: z.string().describe("Document ID"),
    citation_type: z.enum(["inline", "footnote", "paraphrase", "reference"]).optional().describe("Filter by type"),
  },
  async ({ document_id, citation_type }) => {
    const citations = await getCitationsByType(sql, document_id, citation_type);
    return text({ citations, count: citations.length });
  },
);

server.tool(
  "knowledge_verify_citation",
  "Verify or retract a citation and optionally add verification notes",
  {
    citation_id: z.string().describe("Citation ID"),
    verified: z.boolean().describe("Whether the citation is verified"),
    notes: z.string().optional().describe("Optional verification notes"),
  },
  async ({ citation_id, verified, notes }) => {
    await setCitationVerifiedStatus(sql, citation_id, verified, notes);
    return text({ citation_id, verified });
  },
);

// ─── Collection Diagnostics ─────────────────────────────────────────────────────

server.tool(
  "knowledge_get_collection_diagnostics",
  "Get diagnostic information about a collection — chunk distribution by status, average chunk size, embedding coverage, indexing queue depth, and health flags",
  {
    collection_id: z.string().describe("Collection ID to diagnose"),
  },
  async ({ collection_id }) => {
    const [stats] = await sql`
      SELECT
        COUNT(DISTINCT d.id)::int AS total_documents,
        COUNT(DISTINCT c.id)::int AS total_chunks,
        COUNT(DISTINCT CASE WHEN c.embedding IS NOT NULL THEN c.id END)::int AS chunks_with_embedding,
        AVG(LENGTH(c.content))::int AS avg_chunk_size_bytes,
        COUNT(DISTINCT CASE WHEN d.status = 'pending' THEN d.id END)::int AS pending_documents,
        COUNT(DISTINCT CASE WHEN d.status = 'processing' THEN d.id END)::int AS processing_documents,
        COUNT(DISTINCT CASE WHEN d.status = 'ready' THEN d.id END)::int AS ready_documents,
        COUNT(DISTINCT CASE WHEN d.status = 'failed' THEN d.id END)::int AS failed_documents,
        COUNT(DISTINCT CASE WHEN d.status = 'archived' THEN d.id END)::int AS archived_documents,
        MIN(d.created_at) AS oldest_document,
        MAX(d.updated_at) AS newest_document
      FROM knowledge.documents d
      LEFT JOIN knowledge.chunks c ON c.document_id = d.id
      WHERE d.collection_id = ${collection_id}
    `;
    const [queueDepth] = await sql`
      SELECT COUNT(*)::int AS queued_jobs
      FROM knowledge.indexing_queue
      WHERE collection_id = ${collection_id}
        AND status IN ('queued', 'pending')
    `;
    const chunkSizeBuckets = await sql`
      SELECT
        CASE
          WHEN LENGTH(c.content) < 256 THEN 'tiny_<256B'
          WHEN LENGTH(c.content) < 512 THEN 'small_256-512B'
          WHEN LENGTH(c.content) < 1024 THEN 'medium_512-1KB'
          WHEN LENGTH(c.content) < 2048 THEN 'large_1-2KB'
          ELSE 'xlarge_>2KB'
        END AS size_bucket,
        COUNT(*)::int AS chunk_count
      FROM knowledge.chunks c
      WHERE c.document_id IN (SELECT id FROM knowledge.documents WHERE collection_id = ${collection_id})
      GROUP BY size_bucket
    `;
    const embeddingCoverage = stats.total_chunks > 0
      ? (stats.chunks_with_embedding / stats.total_chunks * 100).toFixed(1)
      : "0";
    const healthFlags: string[] = [];
    if (stats.failed_documents > 0) healthFlags.push(`failed_documents:${stats.failed_documents}`);
    if (Number(queueDepth.queued_jobs) > 100) healthFlags.push(`large_queue:${queueDepth.queued_jobs}`);
    if (Number(embeddingCoverage) < 50) healthFlags.push(`low_embedding_coverage:${embeddingCoverage}%`);
    if (stats.pending_documents > stats.ready_documents) healthFlags.push(`backlogged_indexing`);
    return text({
      collection_id,
      diagnostics: { ...stats, embedding_coverage_percent: embeddingCoverage, queue_depth: queueDepth },
      chunk_size_distribution: chunkSizeBuckets,
      health_flags: healthFlags,
    });
  },
);

server.tool(
  "knowledge_estimate_indexing_cost",
  "Estimate the token count and approximate cost to index a document before actually ingesting it — useful for budgeting",
  {
    collection_id: z.string().describe("Collection ID"),
    content: z.string().describe("Document content to estimate"),
    title: z.string().optional().describe("Document title"),
    chunk_size: z.number().optional().describe("Target chunk size in characters (default: 500)"),
  },
  async ({ collection_id, content, title, chunk_size }) => {
    const { estimateTokens } = await import("../lib/chunking.js");
    const { hasEmbeddingKey } = await import("../lib/embeddings.js");
    const targetChunkSize = chunk_size ?? 500;
    const chunks = Math.ceil(content.length / targetChunkSize);
    const totalTokens = estimateTokens(content);
    const estimatedChunkTokens = Math.ceil(totalTokens / chunks);
    const hasEmbeddings = await hasEmbeddingKey();
    // Rough cost estimates (OpenAI ada-002 pricing approximation)
    const embeddingCostPer1k = 0.0001;
    const gpt4CostPer1k = 0.03;
    const estimatedEmbeddingCost = hasEmbeddings
      ? (totalTokens / 1000) * embeddingCostPer1k
      : null;
    const estimatedProcessingCost = (totalTokens / 1000) * gpt4CostPer1k;
    return text({
      collection_id,
      title: title ?? "(untitled)",
      content_length_chars: content.length,
      estimated_total_tokens: totalTokens,
      chunk_count: chunks,
      avg_tokens_per_chunk: estimatedChunkTokens,
      target_chunk_size: targetChunkSize,
      embeddings_available: hasEmbeddings,
      estimated_embedding_cost_usd: estimatedEmbeddingCost,
      estimated_processing_cost_usd: estimatedProcessingCost,
    });
  },
);

server.tool(
  "knowledge_bulk_archive_documents",
  "Bulk archive documents in a collection — archives all documents older than a given date, or all documents in a given status",
  {
    collection_id: z.string().describe("Collection ID"),
    older_than_days: z.number().optional().describe("Archive documents not updated in this many days"),
    status: z.enum(["pending", "processing", "failed", "ready"]).optional().describe("Archive documents in this status"),
    dry_run: z.boolean().optional().default(true).describe("If true, returns count without archiving"),
    reason: z.string().optional().describe("Reason for archival (recorded in document metadata)"),
  },
  async ({ collection_id, older_than_days, status, dry_run, reason }) => {
    let whereClause: string;
    const params: unknown[] = [collection_id];
    if (older_than_days) {
      const cutoffDate = new Date(Date.now() - older_than_days * 86400000);
      whereClause = `collection_id = $1 AND updated_at < $2 AND status != 'archived'`;
      params.push(cutoffDate);
    } else if (status) {
      whereClause = `collection_id = $1 AND status = $2`;
      params.push(status);
    } else {
      whereClause = `collection_id = $1 AND status != 'archived'`;
    }
    const countQuery = `SELECT COUNT(*)::int AS count FROM knowledge.documents WHERE ${whereClause}`;
    const [countResult] = await sql.unsafe(countQuery, params) as [{ count: number }];
    if (dry_run) {
      return text({
        collection_id,
        dry_run: true,
        would_archive: countResult.count,
        filters: { older_than_days, status },
        message: `Dry run — set dry_run=false to actually archive`,
      });
    }
    const archivalReason = reason ?? `bulk_archive:${new Date().toISOString()}`;
    const updateQuery = `
      UPDATE knowledge.documents
      SET status = 'archived', metadata = jsonb_set(COALESCE(metadata, '{}'), '{archival_reason}', $2)
      WHERE ${whereClause}
    `;
    const result = await sql.unsafe(updateQuery, [...params, archivalReason]);
    return text({
      collection_id,
      dry_run: false,
      archived_count: result.count ?? countResult.count,
      filters: { older_than_days, status },
      archival_reason: archivalReason,
    });
  },
);

server.tool(
  "knowledge_detect_conflicts",
  "Detect contradictory facts across different sources for a specific entity",
  {
    entity_id: z.string().describe("Entity UUID to check for conflicts"),
    workspace_id: z.string().describe("Workspace UUID"),
  },
  async ({ entity_id, workspace_id }) => {
    const report = await detectEntityConflicts(sql, entity_id, workspace_id);
    return text(report);
  },
);

server.tool(
  "knowledge_scan_conflicts",
  "Scan all entities in a workspace for knowledge conflicts",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    limit: z.number().int().positive().optional().default(50).describe("Max entities to scan"),
  },
  async ({ workspace_id, limit }) => {
    const reports = await scanWorkspaceConflicts(sql, workspace_id, limit);
    return text({ conflicts: reports, count: reports.length });
  },
);

server.tool(
  "knowledge_conflict_stats",
  "Get conflict statistics for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
  },
  async ({ workspace_id }) => {
    const stats = await getConflictStats(sql, workspace_id);
    return text(stats);
  },
);

server.tool(
  "knowledge_log_search",
  "Log a search query for analytics — tracks what users are searching for and how results are used",
  {
    workspace_id: z.string().describe("Workspace ID"),
    query: z.string().describe("Search query text"),
    collection_id: z.string().optional().describe("Collection searched (if known)"),
    result_count: z.number().int().nonnegative().optional().default(0).describe("Number of results returned"),
    latency_ms: z.number().int().nonnegative().optional().describe("Search latency in milliseconds"),
  },
  async ({ workspace_id, query, collection_id, result_count, latency_ms }) => {
    const entry = await logSearchQuery(sql, workspace_id, query, { collectionId: collection_id, resultCount: result_count, latencyMs: latency_ms });
    return text({ logged: true, id: (entry as any).id });
  },
);

server.tool(
  "knowledge_record_search_clicks",
  "Record clicks on search results — used to improve search ranking and analytics",
  {
    workspace_id: z.string().describe("Workspace ID"),
    query_id: z.string().describe("Search query ID from knowledge_log_search"),
    chunk_id: z.string().describe("Chunk ID that was clicked"),
    position: z.number().int().nonnegative().optional().describe("Position in result list (0-based)"),
  },
  async ({ workspace_id, query_id, chunk_id, position }) => {
    await recordSearchClicks(sql, workspace_id, query_id, chunk_id, position);
    return text({ recorded: true });
  },
);

server.tool(
  "knowledge_get_search_analytics",
  "Get search analytics summary for a workspace — top queries, no-result queries, click-through rates",
  {
    workspace_id: z.string().describe("Workspace ID"),
    from_date: z.string().optional().describe("Start date (ISO-8601)"),
    to_date: z.string().optional().describe("End date (ISO-8601)"),
    limit: z.number().int().positive().optional().default(20).describe("Max top queries to return"),
  },
  async ({ workspace_id, from_date, to_date, limit }) => {
    const analytics = await getSearchAnalytics(sql, workspace_id, { fromDate: from_date ? new Date(from_date) : undefined, toDate: to_date ? new Date(to_date) : undefined });
    const topQueries = await getTopQueries(sql, workspace_id, limit);
    const noResultQueries = await getNoResultQueries(sql, workspace_id, limit);
    return text({ analytics, top_queries: topQueries, no_result_queries: noResultQueries });
  },
);

server.tool(
  "knowledge_find_related",
  "Find documents semantically related to a given document or query — uses embedding centroids",
  {
    workspace_id: z.string().describe("Workspace ID"),
    document_id: z.string().optional().describe("Document ID to find related docs for"),
    query: z.string().optional().describe("Query text to find related docs for (alternative to document_id)"),
    collection_id: z.string().optional().describe("Collection to search in (required if using query)"),
    limit: z.number().int().positive().optional().default(5).describe("Max related documents to return"),
  },
  async ({ workspace_id, document_id, query, collection_id, limit }) => {
    let results;
    if (document_id) {
      results = await findRelatedDocuments(sql, workspace_id, document_id, limit);
    } else if (query && collection_id) {
      results = await findRelatedByQuery(sql, workspace_id, collection_id, query, limit);
    } else {
      return text({ error: "Provide either document_id or both query and collection_id" });
    }
    return text({ results });
  },
);

server.tool(
  "knowledge_classify_intent",
  "Classify the intent behind a user query — determines what type of information the user is looking for",
  {
    workspace_id: z.string().describe("Workspace ID"),
    query: z.string().describe("Query text to classify"),
  },
  async ({ workspace_id, query }) => {
    const classification = await classifyQueryIntent(sql, workspace_id, query);
    return text(classification);
  },
);

server.tool(
  "knowledge_intent_distribution",
  "Get distribution of query intents for a workspace — useful for understanding user behavior",
  {
    workspace_id: z.string().describe("Workspace ID"),
    from_date: z.string().optional().describe("Start date (ISO-8601)"),
    to_date: z.string().optional().describe("End date (ISO-8601)"),
  },
  async ({ workspace_id, from_date, to_date }) => {
    const distribution = await getIntentDistribution(sql, workspace_id, { fromDate: from_date ? new Date(from_date) : undefined, toDate: to_date ? new Date(to_date) : undefined });
    const lowConfidence = await getLowConfidenceQueries(sql, workspace_id, 10);
    return text({ distribution, low_confidence_queries: lowConfidence });
  },
);

main().catch(console.error);
