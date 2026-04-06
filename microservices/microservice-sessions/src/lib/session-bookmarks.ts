/**
 * Session bookmarks — highlight/bookmark specific messages within a session.
 *
 * Unlike tags (which label the whole session), bookmarks reference
 * specific messages for later reference.
 */

import type { Sql } from "postgres";

export interface SessionBookmark {
  id: string;
  session_id: string;
  message_id: string;
  label: string | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
}

/**
 * Bookmark a message in a session.
 */
export async function bookmarkMessage(
  sql: Sql,
  sessionId: string,
  messageId: string,
  label?: string,
  note?: string,
  createdBy?: string,
): Promise<SessionBookmark> {
  const [existing] = await sql<[{ id: string }]>`
    SELECT id FROM sessions.session_bookmarks
    WHERE session_id = ${sessionId} AND message_id = ${messageId}
  `;

  if (existing) {
    const [updated] = await sql<SessionBookmark[]>`
      UPDATE sessions.session_bookmarks
      SET label = COALESCE(${label}, label),
          note = COALESCE(${note}, note)
      WHERE session_id = ${sessionId} AND message_id = ${messageId}
      RETURNING *
    `;
    return updated;
  }

  const [inserted] = await sql<SessionBookmark[]>`
    INSERT INTO sessions.session_bookmarks (session_id, message_id, label, note, created_by)
    VALUES (${sessionId}, ${messageId}, ${label ?? null}, ${note ?? null}, ${createdBy ?? null})
    RETURNING *
  `;
  return inserted;
}

/**
 * Remove a bookmark from a session.
 */
export async function removeBookmark(
  sql: Sql,
  sessionId: string,
  messageId: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM sessions.session_bookmarks
    WHERE session_id = ${sessionId} AND message_id = ${messageId}
  `;
  return Number(result.count ?? 0) > 0;
}

/**
 * List all bookmarks in a session, ordered by message position.
 */
export async function listSessionBookmarks(
  sql: Sql,
  sessionId: string,
): Promise<SessionBookmark[]> {
  return sql<SessionBookmark[]>`
    SELECT sb.* FROM sessions.session_bookmarks sb
    JOIN sessions.messages m ON m.id = sb.message_id
    WHERE sb.session_id = ${sessionId}
    ORDER BY m.created_at ASC
  `;
}

/**
 * Check if a message is bookmarked.
 */
export async function isMessageBookmarked(
  sql: Sql,
  sessionId: string,
  messageId: string,
): Promise<boolean> {
  const [row] = await sql<[{ count: number }]>`
    SELECT COUNT(*) as count FROM sessions.session_bookmarks
    WHERE session_id = ${sessionId} AND message_id = ${messageId}
  `;
  return Number(row.count) > 0;
}

/**
 * Count bookmarks in a session.
 */
export async function countSessionBookmarks(
  sql: Sql,
  sessionId: string,
): Promise<number> {
  const [row] = await sql<[{ count: number }]>`
    SELECT COUNT(*) as count FROM sessions.session_bookmarks
    WHERE session_id = ${sessionId}
  `;
  return Number(row.count);
}

/**
 * Clear all bookmarks from a session.
 */
export async function clearSessionBookmarks(
  sql: Sql,
  sessionId: string,
): Promise<number> {
  const result = await sql`
    DELETE FROM sessions.session_bookmarks WHERE session_id = ${sessionId}
  `;
  return Number(result.count ?? 0);
}
