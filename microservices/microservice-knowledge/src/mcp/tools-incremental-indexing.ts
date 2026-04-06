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

