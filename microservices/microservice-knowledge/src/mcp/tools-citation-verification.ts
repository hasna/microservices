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

