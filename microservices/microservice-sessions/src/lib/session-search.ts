/**
 * Session search — full-text search across message content and
 * metadata-based filtering.
 *
 * search_sessions_messages      — ranked full-text search across message
 *                                  content within sessions.
 * search_sessions_by_metadata   — filter sessions by arbitrary JSONB
 *                                  key-value pairs (metadata containment).
 */

import type { Sql } from "postgres";
import type { Message } from "./messages.js";
import type { Conversation } from "./conversations.js";

export interface MessageSearchMatch {
  session_id: string;
  message_id: string;
  snippet: string;
  rank: number;
  role: string;
  created_at: string;
}

export interface MetadataFilter {
  key: string;
  value: unknown;
}

/**
 * Full-text search across message content within sessions.
 * Uses PostgreSQL tsvector ranking.  Searches across all workspaces
 * the caller has access to by passing a workspaceId filter.
 *
 * @param sql     - database handle
 * @param query   - search query (plain text; converted to tsquery internally)
 * @param opts.workspaceId     - restrict to a specific workspace
 * @param opts.sessionId       - restrict to a specific session
 * @param opts.limit           - max results (default 20)
 */
export async function searchSessionsMessages(
  sql: Sql,
  query: string,
  opts: {
    workspaceId?: string;
    sessionId?: string;
    limit?: number;
  } = {},
): Promise<MessageSearchMatch[]> {
  const limit = opts.limit ?? 20;

  // Build snippet by highlighting matching terms
  const tsquery = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[^\w'-]/g, ""))
    .join(" & ");

  if (!tsquery) return [];

  if (opts.sessionId) {
    const rows = await sql<{
      session_id: string;
      message_id: string;
      snippet: string;
      rank: number;
      role: string;
      created_at: string;
    }[]>`
      SELECT
        m.conversation_id   AS session_id,
        m.id                AS message_id,
        ts_headline('english', m.content, plainto_tsquery('english', ${query}),
          'StartSel=<mark>, StopSel=</mark>, MaxWords=50, MinWords=20, MaxFragments=2'
        )                    AS snippet,
        ts_rank(m.content_tsvector, plainto_tsquery('english', ${query})) AS rank,
        m.role,
        m.created_at
      FROM sessions.messages m
      WHERE m.conversation_id = ${opts.sessionId}
        AND m.content_tsvector @@ plainto_tsquery('english', ${query})
      ORDER BY rank DESC, m.created_at DESC
      LIMIT ${limit}
    `;
    return rows;
  }

  if (opts.workspaceId) {
    const rows = await sql<{
      session_id: string;
      message_id: string;
      snippet: string;
      rank: number;
      role: string;
      created_at: string;
    }[]>`
      SELECT
        m.conversation_id   AS session_id,
        m.id                AS message_id,
        ts_headline('english', m.content, plainto_tsquery('english', ${query}),
          'StartSel=<mark>, StopSel=</mark>, MaxWords=50, MinWords=20, MaxFragments=2'
        )                    AS snippet,
        ts_rank(m.content_tsvector, plainto_tsquery('english', ${query})) AS rank,
        m.role,
        m.created_at
      FROM sessions.messages m
      JOIN sessions.conversations c ON c.id = m.conversation_id
      WHERE c.workspace_id = ${opts.workspaceId}
        AND m.content_tsvector @@ plainto_tsquery('english', ${query})
      ORDER BY rank DESC, m.created_at DESC
      LIMIT ${limit}
    `;
    return rows;
  }

  // No workspace filter — search across all accessible sessions
  const rows = await sql<{
    session_id: string;
    message_id: string;
    snippet: string;
    rank: number;
    role: string;
    created_at: string;
  }[]>`
    SELECT
      m.conversation_id   AS session_id,
      m.id                AS message_id,
      ts_headline('english', m.content, plainto_tsquery('english', ${query}),
        'StartSel=<mark>, StopSel=</mark>, MaxWords=50, MinWords=20, MaxFragments=2'
      )                    AS snippet,
      ts_rank(m.content_tsvector, plainto_tsquery('english', ${query})) AS rank,
      m.role,
      m.created_at
    FROM sessions.messages m
    WHERE m.content_tsvector @@ plainto_tsquery('english', ${query})
    ORDER BY rank DESC, m.created_at DESC
    LIMIT ${limit}
  `;
  return rows;
}

/**
 * Filter sessions by metadata key-value pairs using PostgreSQL JSONB
 * containment (@>) operator.
 *
 * @param sql             - database handle
 * @param metadataFilters - array of { key, value } pairs; all must match
 *                          (AND logic).  Value supports nested objects.
 */
export async function searchSessionsByMetadata(
  sql: Sql,
  metadataFilters: MetadataFilter[],
): Promise<Conversation[]> {
  if (metadataFilters.length === 0) return [];

  // Build a JSONB object with all the filter key-value pairs
  const filterObj: Record<string, unknown> = {};
  for (const f of metadataFilters) {
    filterObj[f.key] = f.value;
  }

  return sql<Conversation[]>`
    SELECT * FROM sessions.conversations
    WHERE metadata @> ${JSON.stringify(filterObj)}::jsonb
    ORDER BY updated_at DESC
  `;
}
