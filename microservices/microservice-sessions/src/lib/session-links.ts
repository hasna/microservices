/**
 * Session links — associate a session with external service IDs
 * (e.g., link a traces trace_id, or a knowledge document_id) for
 * unified debugging and cross-service correlation.
 */

import type { Sql } from "postgres";

export interface SessionLink {
  id: string;
  conversation_id: string;
  external_service: string; // e.g., "traces", "knowledge", "memory"
  external_id: string;   // e.g., trace_id, document_id
  link_type: string;      // e.g., "related", "caused_by", "parent"
  metadata: Record<string, string | number | boolean>;
  created_at: Date;
}

/**
 * Link an external service ID to a session.
 */
export async function linkSessionToExternal(
  sql: Sql,
  opts: {
    conversationId: string;
    externalService: string;
    externalId: string;
    linkType?: string;
    metadata?: Record<string, string | number | boolean>;
  },
): Promise<SessionLink> {
  const [link] = await sql<SessionLink[]>`
    INSERT INTO sessions.session_links (
      conversation_id, external_service, external_id, link_type, metadata
    ) VALUES (
      ${opts.conversationId},
      ${opts.externalService},
      ${opts.externalId},
      ${opts.linkType ?? "related"},
      ${JSON.stringify(opts.metadata ?? {})}
    )
    ON CONFLICT (conversation_id, external_service, external_id)
    DO UPDATE SET
      link_type = EXCLUDED.link_type,
      metadata = EXCLUDED.metadata
    RETURNING *
  `;
  return link;
}

/**
 * Get all external links for a session.
 */
export async function getSessionLinks(
  sql: Sql,
  conversationId: string,
): Promise<SessionLink[]> {
  return sql<SessionLink[]>`
    SELECT * FROM sessions.session_links
    WHERE conversation_id = ${conversationId}
    ORDER BY created_at DESC
  `;
}

/**
 * Get sessions linked to a specific external ID.
 */
export async function getSessionsByExternalId(
  sql: Sql,
  externalService: string,
  externalId: string,
): Promise<SessionLink[]> {
  return sql<SessionLink[]>`
    SELECT * FROM sessions.session_links
    WHERE external_service = ${externalService}
      AND external_id = ${externalId}
    ORDER BY created_at DESC
  `;
}

/**
 * Get sessions linked to any external ID in a list.
 */
export async function getSessionsByExternalIds(
  sql: Sql,
  externalService: string,
  externalIds: string[],
): Promise<SessionLink[]> {
  return sql<SessionLink[]>`
    SELECT * FROM sessions.session_links
    WHERE external_service = ${externalService}
      AND external_id = ANY(${externalIds})
    ORDER BY created_at DESC
  `;
}

/**
 * Delete a session link.
 */
export async function deleteSessionLink(
  sql: Sql,
  id: string,
): Promise<void> {
  await sql`DELETE FROM sessions.session_links WHERE id = ${id}`;
}

/**
 * Delete all links for a session.
 */
export async function deleteAllSessionLinks(
  sql: Sql,
  conversationId: string,
): Promise<number> {
  const [result] = await sql<[{ count: string }]>`
    DELETE FROM sessions.session_links
    WHERE conversation_id = ${conversationId}
    RETURNING COUNT(*) as count
  `;
  return Number(result.count);
}

/**
 * Get link counts by external service for a workspace.
 */
export async function getLinkStatsByService(
  sql: Sql,
  workspaceId: string,
): Promise<{ external_service: string; link_count: number }[]> {
  return sql<{ external_service: string; link_count: number }[]>`
    SELECT
      sl.external_service,
      COUNT(*)::int AS link_count
    FROM sessions.session_links sl
    JOIN sessions.conversations c ON c.id = sl.conversation_id
    WHERE c.workspace_id = ${workspaceId}
    GROUP BY sl.external_service
    ORDER BY link_count DESC
  `;
}
