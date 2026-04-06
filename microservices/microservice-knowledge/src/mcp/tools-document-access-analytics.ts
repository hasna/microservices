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

