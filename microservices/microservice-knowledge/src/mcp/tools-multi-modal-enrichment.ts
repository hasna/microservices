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

