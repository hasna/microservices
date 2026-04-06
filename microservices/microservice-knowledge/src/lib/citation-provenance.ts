/**
 * Citation provenance tracking for microservice-knowledge.
 *
 * - Tracks citation sources with confidence scores
 * - Verifies citations against source documents
 * - Computes provenance chains (citation chain length, reliability)
 * - Detects citation loops and circular references
 */

import type { Sql } from "postgres";

export type ProvenanceConfidence = "high" | "medium" | "low" | "unverified";
export type VerificationStatus = "verified" | "disputed" | "unverified" | "retracted";

export interface CitationProvenance {
  citation_id: string;
  source_chunk_id: string;
  target_chunk_id: string;
  confidence: ProvenanceConfidence;
  verification_status: VerificationStatus;
  verification_notes: string | null;
  /** How many hops in the citation chain (direct=1, citation of citation=2, etc.) */
  chain_depth: number;
  /** Whether this citation creates a circular reference */
  is_circular: boolean;
  /** Trust score 0-100 based on source document age, verification history, etc. */
  trust_score: number;
  created_at: Date;
  updated_at: Date;
}

export interface ProvenanceChain {
  citation_id: string;
  path: string[]; // Array of chunk IDs from source to target
  depth: number;
  is_circular: boolean;
  avg_confidence: ProvenanceConfidence;
}

export interface ProvenanceStats {
  total_citations: number;
  verified_citations: number;
  disputed_citations: number;
  unverified_citations: number;
  retracted_citations: number;
  avg_chain_depth: number;
  circular_citation_count: number;
}

/**
 * Add or update provenance for a citation.
 */
export async function setCitationProvenance(
  sql: Sql,
  citationId: string,
  opts: {
    confidence?: ProvenanceConfidence;
    verificationStatus?: VerificationStatus;
    verificationNotes?: string;
    trustScore?: number;
  },
): Promise<CitationProvenance | null> {
  const confidence = opts.confidence ?? "unverified";
  const verificationStatus = opts.verificationStatus ?? "unverified";
  const trustScore = opts.trustScore ?? 50;

  const [row] = await sql<CitationProvenance[]>`
    INSERT INTO knowledge.citation_provenance
      (citation_id, confidence, verification_status, verification_notes, trust_score)
    VALUES (
      ${citationId}, ${confidence}::TEXT, ${verificationStatus}::TEXT,
      ${opts.verificationNotes ?? null}, ${trustScore}
    )
    ON CONFLICT (citation_id) DO UPDATE SET
      confidence = EXCLUDED.confidence,
      verification_status = EXCLUDED.verification_status,
      verification_notes = EXCLUDED.verification_notes,
      trust_score = EXCLUDED.trust_score,
      updated_at = NOW()
    RETURNING *
  `;

  return row ? parseProvenanceRow(row) : null;
}

/**
 * Get provenance for a citation.
 */
export async function getCitationProvenance(
  sql: Sql,
  citationId: string,
): Promise<CitationProvenance | null> {
  const [row] = await sql`SELECT * FROM knowledge.citation_provenance WHERE citation_id = ${citationId}`;
  return row ? parseProvenanceRow(row) : null;
}

/**
 * Verify a citation's source against the actual source chunk content.
 * Returns updated provenance with verification status.
 */
export async function verifyCitation(
  sql: Sql,
  citationId: string,
  verificationNotes?: string,
): Promise<CitationProvenance | null> {
  // Get the citation and its source chunk
  const [row] = await sql<Record<string, unknown>[]>`
    SELECT
      cp.*,
      c.content as source_content,
      sc.content as target_content
    FROM knowledge.citation_provenance cp
    JOIN knowledge.citations ct ON ct.id = ${citationId}
    JOIN knowledge.chunks c ON c.id = cp.source_chunk_id
    JOIN knowledge.chunks sc ON sc.id = cp.target_chunk_id
    WHERE cp.citation_id = ${citationId}
  `;

  if (!row) return null;

  // Simple verification: check if source content actually references target
  // In practice, you'd use NLP/embedding similarity here
  const sourceContent = (row.source_content as string) ?? "";
  const targetContent = (row.target_content as string) ?? "";

  // Placeholder verification logic - in production use embedding similarity
  const hasOverlap = sourceContent.includes(targetContent.slice(0, 50))
    || targetContent.includes(sourceContent.slice(0, 50));

  const verificationStatus: VerificationStatus = hasOverlap ? "verified" : "disputed";
  const confidence: ProvenanceConfidence = hasOverlap ? "high" : "low";
  const trustScore = hasOverlap ? 85 : 25;

  return setCitationProvenance(sql, citationId, {
    confidence,
    verificationStatus,
    verificationNotes: verificationNotes ?? (hasOverlap ? "Content overlap verified" : "Content overlap not found"),
    trustScore,
  });
}

/**
 * Get the provenance chain (citation path) from source to target document.
 */
export async function getProvenanceChain(
  sql: Sql,
  citationId: string,
): Promise<ProvenanceChain | null> {
  // BFS to find shortest citation path
  const visited = new Set<string>();
  const queue: Array<{ citationId: string; path: string[] }> = [];

  const start = await getCitationProvenance(sql, citationId);
  if (!start) return null;

  queue.push({ citationId, path: [citationId] });

  while (queue.length > 0) {
    const { citationId: currentId, path } = queue.shift()!;

    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const prov = await getCitationProvenance(sql, currentId);
    if (!prov) continue;

    if (prov.source_chunk_id === prov.target_chunk_id && path.length > 1) {
      // Found a cycle
      return {
        citation_id: citationId,
        path: [...path, currentId],
        depth: path.length,
        is_circular: true,
        avg_confidence: "medium",
      };
    }

    // Get outgoing citations from the source chunk
    const outgoing = await sql<{ id: string }[]>`
      SELECT id FROM knowledge.citations
      WHERE source_chunk_id = ${prov.target_chunk_id}
    `;

    for (const next of outgoing) {
      if (!visited.has(next.id)) {
        queue.push({ citationId: next.id, path: [...path, next.id] });
      }
    }
  }

  return {
    citation_id: citationId,
    path: [citationId],
    depth: 1,
    is_circular: false,
    avg_confidence: "medium",
  };
}

/**
 * Detect circular citations for a chunk.
 */
export async function detectCircularCitations(
  sql: Sql,
  chunkId: string,
): Promise<{ has_circular: boolean; circular_chains: string[][] }> {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const circularChains: string[][] = [];

  async function dfs(currentId: string, path: string[]): Promise<boolean> {
    if (inStack.has(currentId)) {
      // Found a cycle
      const cycleStart = path.indexOf(currentId);
      circularChains.push(path.slice(cycleStart));
      return true;
    }
    if (visited.has(currentId)) return false;

    visited.add(currentId);
    inStack.add(currentId);

    const outgoing = await sql<{ id: string }[]>`
      SELECT id FROM knowledge.citations WHERE source_chunk_id = ${currentId}
    `;

    for (const row of outgoing) {
      await dfs(row.id, [...path, row.id]);
    }

    inStack.delete(currentId);
    return false;
  }

  await dfs(chunkId, [chunkId]);

  return {
    has_circular: circularChains.length > 0,
    circular_chains: circularChains,
  };
}

/**
 * Get aggregate provenance stats for a collection.
 */
export async function getCollectionProvenanceStats(
  sql: Sql,
  collectionId: string,
): Promise<ProvenanceStats> {
  const [stats] = await sql<[{
    total: number;
    verified: number;
    disputed: number;
    unverified: number;
    retracted: number;
    avg_depth: number;
    circular_count: number;
  }]>`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN verification_status = 'verified' THEN 1 ELSE 0 END) as verified,
      SUM(CASE WHEN verification_status = 'disputed' THEN 1 ELSE 0 END) as disputed,
      SUM(CASE WHEN verification_status = 'unverified' THEN 1 ELSE 0 END) as unverified,
      SUM(CASE WHEN verification_status = 'retracted' THEN 1 ELSE 0 END) as retracted,
      AVG(chain_depth)::INT as avg_depth,
      SUM(CASE WHEN is_circular THEN 1 ELSE 0 END) as circular_count
    FROM knowledge.citation_provenance cp
    JOIN knowledge.citations c ON c.id = cp.citation_id
    JOIN knowledge.chunks ch ON ch.id = c.source_chunk_id
    JOIN knowledge.documents d ON d.id = ch.document_id
    WHERE d.collection_id = ${collectionId}
  `;

  return {
    total_citations: Number(stats.total),
    verified_citations: Number(stats.verified),
    disputed_citations: Number(stats.disputed),
    unverified_citations: Number(stats.unverified),
    retracted_citations: Number(stats.retracted),
    avg_chain_depth: Number(stats.avg_depth) || 1,
    circular_citation_count: Number(stats.circular_count),
  };
}

/**
 * List citations by trust score threshold.
 */
export async function listCitationsByTrust(
  sql: Sql,
  workspaceId: string,
  minTrust = 0,
  limit = 50,
): Promise<CitationProvenance[]> {
  const rows = await sql`
    SELECT cp.*
    FROM knowledge.citation_provenance cp
    JOIN knowledge.citations c ON c.id = cp.citation_id
    JOIN knowledge.chunks ch ON ch.id = c.source_chunk_id
    JOIN knowledge.documents d ON d.id = ch.document_id
    JOIN knowledge.collections col ON col.id = d.collection_id
    WHERE col.workspace_id = ${workspaceId}
      AND cp.trust_score >= ${minTrust}
    ORDER BY cp.trust_score DESC
    LIMIT ${limit}
  `;

  return rows.map(parseProvenanceRow);
}

/**
 * Retract a citation (mark as retracted with reason).
 */
export async function retractCitation(
  sql: Sql,
  citationId: string,
  reason: string,
): Promise<CitationProvenance | null> {
  const [row] = await sql<CitationProvenance[]>`
    UPDATE knowledge.citation_provenance
    SET
      verification_status = 'retracted'::TEXT,
      verification_notes = ${reason},
      trust_score = 0,
      updated_at = NOW()
    WHERE citation_id = ${citationId}
    RETURNING *
  `;
  return row ? parseProvenanceRow(row) : null;
}

function parseProvenanceRow(row: Record<string, unknown>): CitationProvenance {
  return {
    citation_id: row.citation_id as string,
    source_chunk_id: row.source_chunk_id as string,
    target_chunk_id: row.target_chunk_id as string,
    confidence: row.confidence as ProvenanceConfidence,
    verification_status: row.verification_status as VerificationStatus,
    verification_notes: row.verification_notes as string | null,
    chain_depth: Number(row.chain_depth),
    is_circular: Boolean(row.is_circular),
    trust_score: Number(row.trust_score),
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
  };
}
