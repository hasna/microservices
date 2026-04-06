// ─── Citation Management ─────────────────────────────────────────────────────

server.tool(
  "knowledge_delete_citations_for_document",
  "Delete all citations involving a document (either as source or citing document)",
  {
    document_id: z.string().uuid().describe("Document ID"),
  },
  async ({ document_id }) => text({ deleted: await deleteCitationsForDocument(sql, document_id) }),
);

