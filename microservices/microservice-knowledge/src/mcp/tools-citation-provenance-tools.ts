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

