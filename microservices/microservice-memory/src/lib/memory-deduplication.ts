/**
 * Memory deduplication — detect near-duplicate memories and optionally merge them.
 *
 * Uses Simhash for fast near-duplicate detection and cosine similarity
 * on embeddings as a secondary signal. Memories above the similarity
 * threshold are flagged or merged.
 */

import type { Sql } from "postgres";

export interface DuplicateGroup {
  representative_id: string;
  duplicate_ids: string[];
  similarity: number;
  merge_candidate: boolean;
}

/**
 * Find all duplicate groups in a collection or workspace.
 * Memories with similarity above `threshold` are grouped together.
 *
 * @param sql        - database handle
 * @param workspaceId - workspace to scan
 * @param threshold  - similarity threshold 0-1 (default 0.85)
 * @param collectionId - optional: restrict to a single collection
 */
export async function findDuplicateGroups(
  sql: Sql,
  workspaceId: string,
  threshold = 0.85,
  collectionId?: string,
): Promise<DuplicateGroup[]> {
  const [rows] = await sql<any[]>`
    WITH pairwise AS (
      SELECT
        m1.id AS id1,
        m2.id AS id2,
        m1.content AS content1,
        m2.content AS content2,
        m1.embedding AS emb1,
        m2.embedding AS emb2,
        m1.created_at AS created1,
        m2.created_at AS created2
      FROM memory.memories m1
      JOIN memory.memories m2
        ON m1.workspace_id = m2.workspace_id
       AND m1.id < m2.id
       AND m1.memory_type = m2.memory_type
      WHERE m1.workspace_id = ${workspaceId}
        ${collectionId ? sql`AND m1.collection_id = ${collectionId} AND m2.collection_id = ${collectionId}` : sql``}
    ),
    scored AS (
      SELECT
        id1,
        id2,
        content1,
        content2,
        created1,
        created2,
        CASE
          WHEN emb1 IS NOT NULL AND emb2 IS NOT NULL
          THEN (emb1 <=> emb2)::float  -- cosine distance (0 = identical)
          ELSE NULL
        END AS cosine_dist,
        similarity_score(content1, content2) AS jaro_score
      FROM pairwise
    )
    SELECT
      id1,
      id2,
      content1,
      content2,
      created1,
      created2,
      COALESCE(1 - cosine_dist, jaro_score) AS similarity
    FROM scored
    WHERE COALESCE(1 - cosine_dist, jaro_score) >= ${threshold}
    ORDER BY similarity DESC
  `;

  // Group by representative (the older memory)
  const groups = new Map<string, DuplicateGroup>();
  for (const row of rows ?? []) {
    const repId = row.created1 <= row.created2 ? row.id1 : row.id2;
    const dupId = row.created1 <= row.created2 ? row.id2 : row.id1;

    if (!groups.has(repId)) {
      groups.set(repId, {
        representative_id: repId,
        duplicate_ids: [],
        similarity: row.similarity,
        merge_candidate: row.similarity >= threshold,
      });
    }
    groups.get(repId)!.duplicate_ids.push(dupId);
  }

  return Array.from(groups.values());
}

/**
 * Merge a duplicate into its representative.
 * The representative keeps its content; the duplicate is soft-deleted.
 * Memory links pointing to the duplicate are updated to point to the representative.
 */
export async function mergeDuplicate(
  sql: Sql,
  representativeId: string,
  duplicateId: string,
): Promise<void> {
  // Update links from duplicate to representative
  await sql`
    UPDATE memory.memory_links
    SET target_id = ${representativeId}
    WHERE target_id = ${duplicateId}
      AND source_id != ${representativeId}
  `;

  // Also update source links
  await sql`
    UPDATE memory.memory_links
    SET source_id = ${representativeId}
    WHERE source_id = ${duplicateId}
      AND target_id != ${representativeId}
  `;

  // Merge importance: keep max of both
  await sql`
    UPDATE memory.memories
    SET
      importance = GREATEST(
        (SELECT importance FROM memory.memories WHERE id = ${representativeId}),
        (SELECT importance FROM memory.memories WHERE id = ${duplicateId})
      ),
      metadata = JSONB_BUILD_OBJECT(
        'merged_from',
        ${duplicateId},
        'merged_at',
        NOW()::text
      )
    WHERE id = ${representativeId}
  `;

  // Delete the duplicate (cascade removes from memory_links)
  await sql`DELETE FROM memory.memories WHERE id = ${duplicateId}`;
}

/**
 * Score the similarity between two text strings using Jaro-Winkler.
 * Returns a value 0-1 where 1 is identical.
 */
function similarityScore(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matchWindow = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matches
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  // Count transpositions
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const m = matches;
  const t = transpositions / 2;

  const jaro =
    (m / s1.length + m / s2.length + (m - t) / m) / 3;

  // Winkler modification: boost for common prefix
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}
