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
