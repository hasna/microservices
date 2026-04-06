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

