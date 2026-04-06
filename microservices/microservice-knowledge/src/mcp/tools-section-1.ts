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

