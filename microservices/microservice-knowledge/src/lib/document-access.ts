/**
 * Document access tracking — logs when documents/chunks are accessed,
 * enabling audit trails, popularity metrics, and access-based ranking.
 */

import type { Sql } from "postgres";

export interface DocumentAccess {
  id: string;
  document_id: string;
  chunk_id: string | null;
  accessed_by: string | null;
  access_type: "read" | "search" | "retrieve" | "embed";
  ip_address: string | null;
  user_agent: string | null;
  response_time_ms: number | null;
  created_at: string;
}

/**
 * Log a document or chunk access event.
 */
export async function logDocumentAccess(
  sql: Sql,
  documentId: string,
  accessedBy?: string,
  accessType: "read" | "search" | "retrieve" | "embed" = "read",
  ipAddress?: string,
  userAgent?: string,
  responseTimeMs?: number,
  chunkId?: string,
): Promise<DocumentAccess> {
  const [entry] = await sql<DocumentAccess[]>`
    INSERT INTO knowledge.document_access_log (
      document_id, chunk_id, accessed_by, access_type,
      ip_address, user_agent, response_time_ms
    )
    VALUES (
      ${documentId},
      ${chunkId ?? null},
      ${accessedBy ?? null},
      ${accessType},
      ${ipAddress ?? null},
      ${userAgent ?? null},
      ${responseTimeMs ?? null}
    )
    RETURNING *
  `;
  return entry;
}

/**
 * Get the most popular documents in a collection (by access count).
 */
export async function getPopularDocuments(
  sql: Sql,
  collectionId: string,
  windowHours = 24,
  limit = 20,
): Promise<Array<{ document_id: string; title: string; access_count: number }>> {
  return sql<Array<{ document_id: string; title: string; access_count: number }>>`
    SELECT
      d.id as document_id,
      d.title,
      COUNT(*) as access_count
    FROM knowledge.document_access_log l
    JOIN knowledge.documents d ON d.id = l.document_id
    WHERE d.collection_id = ${collectionId}
      AND l.created_at > NOW() - INTERVAL '${String(windowHours)} hours'
    GROUP BY d.id, d.title
    ORDER BY access_count DESC
    LIMIT ${limit}
  `;
}

/**
 * Get access frequency over time for a document (for decay ranking).
 */
export async function getDocumentAccessFrequency(
  sql: Sql,
  documentId: string,
  windowHours = 168,
): Promise<{ hour: string; count: number }[]> {
  return sql<{ hour: string; count: number }[]>`
    SELECT
      DATE_TRUNC('hour', created_at) as hour,
      COUNT(*) as count
    FROM knowledge.document_access_log
    WHERE document_id = ${documentId}
      AND created_at > NOW() - INTERVAL '${String(windowHours)} hours'
    GROUP BY 1
    ORDER BY 1
  `;
}

/**
 * Get the hottest (most accessed) chunks in a collection recently.
 */
export async function getHotChunks(
  sql: Sql,
  collectionId: string,
  windowHours = 24,
  limit = 20,
): Promise<Array<{ chunk_id: string; content_preview: string; access_count: number }>> {
  return sql<Array<{ chunk_id: string; content_preview: string; access_count: number }>>`
    SELECT
      l.chunk_id,
      LEFT(c.content, 100) as content_preview,
      COUNT(*) as access_count
    FROM knowledge.document_access_log l
    JOIN knowledge.chunks c ON c.id = l.chunk_id
    WHERE c.collection_id = ${collectionId}
      AND l.chunk_id IS NOT NULL
      AND l.created_at > NOW() - INTERVAL '${String(windowHours)} hours'
    GROUP BY l.chunk_id, c.content
    ORDER BY access_count DESC
    LIMIT ${limit}
  `;
}

/**
 * Record an access and update the document's last_accessed_at.
 */
export async function touchDocument(
  sql: Sql,
  documentId: string,
): Promise<void> {
  await sql`
    UPDATE knowledge.documents
    SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{last_accessed_at}', to_jsonb(NOW()))
    WHERE id = ${documentId}
  `;
}
