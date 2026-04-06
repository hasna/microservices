/**
 * Document priority: boost certain documents in retrieval results.
 * Priority scores are applied as additive boosts to relevance scores during retrieval.
 */

import type { Sql } from "postgres";

export interface DocumentPriority {
  document_id: string;
  priority_score: number;
  reason: string | null;
  set_by: string | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SetPriorityInput {
  documentId: string;
  priorityScore: number;
  reason?: string;
  setBy?: string;
  expiresAt?: Date | null;
}

/**
 * Set or update the priority score for a document.
 */
export async function setDocumentPriority(
  sql: Sql,
  input: SetPriorityInput,
): Promise<DocumentPriority> {
  const { documentId, priorityScore, reason, setBy, expiresAt } = input;

  const [entry] = await sql<DocumentPriority[]>`
    INSERT INTO knowledge.document_priority (
      document_id, priority_score, reason, set_by, expires_at
    )
    VALUES (
      ${documentId},
      ${priorityScore},
      ${reason ?? null},
      ${setBy ?? null},
      ${expiresAt ?? null}
    )
    ON CONFLICT (document_id) DO UPDATE SET
      priority_score = EXCLUDED.priority_score,
      reason = COALESCE(EXCLUDED.reason, document_priority.reason),
      set_by = COALESCE(EXCLUDED.set_by, document_priority.set_by),
      expires_at = EXCLUDED.expires_at,
      updated_at = NOW()
    RETURNING *
  `;
  return entry!;
}

/**
 * Get the priority for a document.
 */
export async function getDocumentPriority(
  sql: Sql,
  documentId: string,
): Promise<DocumentPriority | null> {
  const [entry] = await sql<DocumentPriority[]>`
    SELECT * FROM knowledge.document_priority
    WHERE document_id = ${documentId}
  `;
  return entry ?? null;
}

/**
 * Get all active (non-expired) document priorities for a collection.
 */
export async function getCollectionPriorities(
  sql: Sql,
  collectionId: string,
): Promise<DocumentPriority[]> {
  const rows = await sql<DocumentPriority[]>`
    SELECT dp.* FROM knowledge.document_priority dp
    JOIN knowledge.documents d ON d.id = dp.document_id
    WHERE d.collection_id = ${collectionId}
      AND (dp.expires_at IS NULL OR dp.expires_at > NOW())
    ORDER BY dp.priority_score DESC
  `;
  return rows;
}

/**
 * Delete/clear the priority for a document.
 */
export async function clearDocumentPriority(
  sql: Sql,
  documentId: string,
): Promise<boolean> {
  const [{ affected }] = await sql<[{ affected: number }]>`
    DELETE FROM knowledge.document_priority
    WHERE document_id = ${documentId}
  `;
  return affected > 0;
}

/**
 * Delete all expired priorities (cleanup job).
 */
export async function pruneExpiredPriorities(sql: Sql): Promise<number> {
  const [{ affected }] = await sql<[{ affected: number }]>`
    DELETE FROM knowledge.document_priority
    WHERE expires_at IS NOT NULL AND expires_at < NOW()
  `;
  return affected;
}

/**
 * Boost a retrieval result by adding priority score to the relevance score.
 * Call this after retrieving chunks to re-rank them.
 *
 * Input: array of { document_id, score } and optional priority map
 * Output: same array with boosted scores
 */
export interface ScoredDocument {
  document_id: string;
  score: number;
  [key: string]: unknown;
}

export function boostScores<T extends ScoredDocument>(
  results: T[],
  priorityMap: Map<string, number>,
  boostFactor = 0.1,
): T[] {
  return results.map((item) => {
    const priority = priorityMap.get(item.document_id) ?? 0;
    return {
      ...item,
      score: item.score + priority * boostFactor,
    };
  });
}

/**
 * Compute a map of document_id -> priority_score for a collection.
 * Use this to build the priority map before calling boostScores.
 */
export async function buildPriorityMap(
  sql: Sql,
  collectionId: string,
): Promise<Map<string, number>> {
  const priorities = await getCollectionPriorities(sql, collectionId);
  return new Map(priorities.map((p) => [p.document_id, p.priority_score]));
}
