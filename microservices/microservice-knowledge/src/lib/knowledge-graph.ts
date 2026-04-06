/**
 * Knowledge graph traversal — navigate citation edges to rank and explore
 * document relationships (e.g., PageRank-style citation ranking, graph walk).
 */

import type { Sql } from "postgres";

export interface GraphNode {
  document_id: string;
  title: string;
  citation_count: number;
  referenced_by_count: number;
  score: number;
}

export interface GraphEdge {
  source_document_id: string;
  cited_document_id: string;
  depth: number;
  score: number;
}

/**
 * Get documents that cite a given document (incoming edges).
 */
export async function getCitingDocuments(
  sql: Sql,
  documentId: string,
  limit = 50,
): Promise<Array<{ document_id: string; title: string; score: number | null }>> {
  return sql<Array<{ document_id: string; title: string; score: number | null }>>`
    SELECT d.id as document_id, d.title, MAX(e.score) as score
    FROM knowledge.citation_edges e
    JOIN knowledge.documents d ON d.id = e.source_document_id
    WHERE e.cited_document_id = ${documentId}
    GROUP BY d.id, d.title
    ORDER BY score DESC NULLS LAST
    LIMIT ${limit}
  `;
}

/**
 * Get documents that a given document cites (outgoing edges).
 */
export async function getCitedDocuments(
  sql: Sql,
  documentId: string,
  limit = 50,
): Promise<Array<{ document_id: string; title: string; score: number | null }>> {
  return sql<Array<{ document_id: string; title: string; score: number | null }>>`
    SELECT d.id as document_id, d.title, MAX(e.score) as score
    FROM knowledge.citation_edges e
    JOIN knowledge.documents d ON d.id = e.cited_document_id
    WHERE e.source_document_id = ${documentId}
    GROUP BY d.id, d.title
    ORDER BY score DESC NULLS LAST
    LIMIT ${limit}
  `;
}

/**
 * Perform a graph walk starting from a document, returning reachable documents
 * up to a given depth (BFS).
 */
export async function graphWalk(
  sql: Sql,
  startDocumentId: string,
  maxDepth = 3,
  limit = 100,
): Promise<GraphNode[]> {
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startDocumentId, depth: 0 }];
  const results: GraphNode[] = [];

  while (queue.length > 0 && results.length < limit) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const [doc] = await sql<Array<{ id: string; title: string }>>`
      SELECT id, title FROM knowledge.documents WHERE id = ${id}
    `;
    if (!doc) continue;

    const [citing] = await sql<[{ count: number }]>`
      SELECT COUNT(*) as count FROM knowledge.citation_edges WHERE cited_document_id = ${id}
    `;
    const [cited] = await sql<[{ count: number }]>`
      SELECT COUNT(*) as count FROM knowledge.citation_edges WHERE source_document_id = ${id}
    `;

    results.push({
      document_id: id,
      title: doc.title,
      citation_count: Number(cited.count),
      referenced_by_count: Number(citing.count),
      score: 1 / (depth + 1),
    });

    if (depth < maxDepth) {
      const outgoing = await sql<Array<{ cited_document_id: string }>>`
        SELECT cited_document_id FROM knowledge.citation_edges
        WHERE source_document_id = ${id}
        LIMIT 50
      `;
      for (const row of outgoing) {
        if (!visited.has(row.cited_document_id)) {
          queue.push({ id: row.cited_document_id, depth: depth + 1 });
        }
      }
    }
  }

  return results;
}

/**
 * Compute simple citation-based importance scores for documents in a collection.
 * Documents that are cited by many others score higher.
 */
export async function computeCollectionImportance(
  sql: Sql,
  collectionId: string,
): Promise<Array<{ document_id: string; title: string; importance_score: number }>> {
  return sql<Array<{ document_id: string; title: string; importance_score: number }>>`
    SELECT
      d.id as document_id,
      d.title,
      COALESCE(COUNT(DISTINCT e.source_document_id), 0) * 1.0
        + COALESCE(SUM(DISTINCT e.score), 0) * 0.1 as importance_score
    FROM knowledge.documents d
    LEFT JOIN knowledge.citation_edges e ON e.cited_document_id = d.id
    WHERE d.collection_id = ${collectionId}
    GROUP BY d.id, d.title
    ORDER BY importance_score DESC
  `;
}
