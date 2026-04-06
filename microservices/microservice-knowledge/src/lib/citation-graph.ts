/**
 * Citation graph — recursive citation tracking and graph traversal.
 *
 * Builds a directed citation graph between documents and provides
 * traversal algorithms to find root sources, citation chains,
 * and impact scores.
 */

import type { Sql } from "postgres";

export interface CitationNode {
  documentId: string;
  title: string;
  citationCount: number;   // How many documents this one cites
  citedByCount: number;    // How many documents cite this one
  isRootSource: boolean;
  depth: number;           // Depth in citation tree (0 = root)
}

export interface CitationEdge {
  sourceDocumentId: string;
  targetDocumentId: string;
  quote: string | null;
  context: string | null;
}

export interface CitationPath {
  path: string[];   // Document IDs from source to target
  depth: number;
}

export interface ImpactScore {
  documentId: string;
  title: string;
  directCitations: number;
  totalCitations: number;  // Including transitive
  depth: number;           // Shortest path from a root source
  impactScore: number;     // Weighted: directCitations * 1.0 + transitive * 0.5
}

/**
 * Get all documents that a given document cites (outgoing edges).
 */
export async function getOutgoingCitations(
  sql: Sql,
  documentId: string,
): Promise<CitationEdge[]> {
  const rows = await sql<{
    source_document_id: string;
    target_document_id: string;
    quote: string | null;
    context: string | null;
  }[]>`
    SELECT source_document_id, target_document_id, quote, context
    FROM knowledge.citation_edges
    WHERE source_document_id = ${documentId}
  `;

  return rows.map((r) => ({
    sourceDocumentId: r.source_document_id,
    targetDocumentId: r.target_document_id,
    quote: r.quote,
    context: r.context,
  }));
}

/**
 * Get all documents that cite a given document (incoming edges).
 */
export async function getIncomingCitations(
  sql: Sql,
  documentId: string,
): Promise<CitationEdge[]> {
  const rows = await sql<{
    source_document_id: string;
    target_document_id: string;
    quote: string | null;
    context: string | null;
  }[]>`
    SELECT source_document_id, target_document_id, quote, context
    FROM knowledge.citation_edges
    WHERE target_document_id = ${documentId}
  `;

  return rows.map((r) => ({
    sourceDocumentId: r.source_document_id,
    targetDocumentId: r.target_document_id,
    quote: r.quote,
    context: r.context,
  }));
}

/**
 * Find root source documents — documents that cite nothing (depth 0).
 * These are the primary sources in a knowledge base.
 */
export async function findRootSourceDocuments(
  sql: Sql,
  workspaceId: string,
): Promise<CitationNode[]> {
  // Documents with no outgoing citation edges
  const roots = await sql<{ id: string; title: string; cited_by_count: string }[]>`
    SELECT d.id, d.title,
      (SELECT COUNT(*) FROM knowledge.citation_edges ce WHERE ce.target_document_id = d.id) as cited_by_count
    FROM knowledge.documents d
    WHERE d.collection_id IN (
      SELECT id FROM knowledge.collections WHERE workspace_id = ${workspaceId}
    )
    AND NOT EXISTS (
      SELECT 1 FROM knowledge.citation_edges ce WHERE ce.source_document_id = d.id
    )
  `;

  return roots.map((r) => ({
    documentId: r.id,
    title: r.title,
    citationCount: 0,
    citedByCount: Number(r.cited_by_count),
    isRootSource: true,
    depth: 0,
  }));
}

/**
 * Find all documents that cite a given document directly or transitively.
 * Uses BFS to traverse the citation graph.
 */
export async function findAllCitingDocuments(
  sql: Sql,
  documentId: string,
  maxDepth = 5,
): Promise<CitationNode[]> {
  const visited = new Set<string>();
  const queue: Array<{ docId: string; depth: number }> = [{ docId: documentId, depth: 0 }];
  const results: CitationNode[] = [];

  while (queue.length > 0) {
    const { docId, depth } = queue.shift()!;
    if (visited.has(docId) || depth > maxDepth) continue;
    visited.add(docId);

    const incoming = await getIncomingCitations(sql, docId);
    for (const edge of incoming) {
      if (!visited.has(edge.sourceDocumentId)) {
        const [docRow] = await sql<{ title: string }[]>`
          SELECT title FROM knowledge.documents WHERE id = ${edge.sourceDocumentId}
        `;
        results.push({
          documentId: edge.sourceDocumentId,
          title: docRow?.title ?? "Unknown",
          citationCount: 0,
          citedByCount: 0,
          isRootSource: false,
          depth: depth + 1,
        });
        queue.push({ docId: edge.sourceDocumentId, depth: depth + 1 });
      }
    }
  }

  return results;
}

/**
 * Find the citation path (shortest chain) between two documents.
 * Uses BFS to find the shortest path.
 */
export async function findCitationPath(
  sql: Sql,
  sourceDocumentId: string,
  targetDocumentId: string,
): Promise<CitationPath | null> {
  if (sourceDocumentId === targetDocumentId) {
    return { path: [sourceDocumentId], depth: 0 };
  }

  const visited = new Set<string>();
  const queue: Array<{ docId: string; path: string[] }> = [
    { docId: sourceDocumentId, path: [sourceDocumentId] },
  ];

  while (queue.length > 0) {
    const { docId, path } = queue.shift()!;
    if (visited.has(docId)) continue;
    visited.add(docId);

    const outgoing = await getOutgoingCitations(sql, docId);
    for (const edge of outgoing) {
      const newPath = [...path, edge.targetDocumentId];
      if (edge.targetDocumentId === targetDocumentId) {
        return { path: newPath, depth: newPath.length - 1 };
      }
      if (!visited.has(edge.targetDocumentId)) {
        queue.push({ docId: edge.targetDocumentId, path: newPath });
      }
    }
  }

  return null;
}

/**
 * Compute impact scores for all documents in a workspace.
 * Impact = direct citations + (transitive citations * 0.5).
 */
export async function computeImpactScores(
  sql: Sql,
  workspaceId: string,
): Promise<ImpactScore[]> {
  const docs = await sql<{ id: string; title: string }[]>`
    SELECT id, title FROM knowledge.documents d
    WHERE d.collection_id IN (
      SELECT id FROM knowledge.collections WHERE workspace_id = ${workspaceId}
    )
  `;

  const scores: ImpactScore[] = [];

  for (const doc of docs) {
    const directIncoming = await getIncomingCitations(sql, doc.id);
    const allCiting = await findAllCitingDocuments(sql, doc.id);

    // Shortest depth from a root source
    const depth = allCiting.length > 0
      ? Math.min(...allCiting.map((c) => c.depth))
      : 0;

    const impactScore = directIncoming.length * 1.0 + allCiting.length * 0.5;

    scores.push({
      documentId: doc.id,
      title: doc.title,
      directCitations: directIncoming.length,
      totalCitations: allCiting.length,
      depth,
      impactScore,
    });
  }

  return scores.sort((a, b) => b.impactScore - a.impactScore);
}
