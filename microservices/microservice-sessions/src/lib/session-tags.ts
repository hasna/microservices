/**
 * Session tags — arbitrary labels for organizing and filtering sessions.
 *
 * Tags allow users to categorize sessions by project, topic, status,
 * or any other dimension without modifying session content.
 */

import type { Sql } from "postgres";

export interface SessionTag {
  id: string;
  session_id: string;
  tag: string;
  color: string | null;
  created_at: string;
  created_by: string | null;
}

/**
 * Add one or more tags to a session.
 * Silently skips tags that are already on the session.
 */
export async function tagSession(
  sql: Sql,
  sessionId: string,
  tags: string[],
  createdBy?: string,
): Promise<SessionTag[]> {
  const results: SessionTag[] = [];
  for (const tag of tags) {
    const [existing] = await sql<[{ id: string }]>`
      SELECT id FROM sessions.session_tags WHERE session_id = ${sessionId} AND tag = ${tag}
    `;
    if (existing) continue;

    const [inserted] = await sql<SessionTag[]>`
      INSERT INTO sessions.session_tags (session_id, tag, created_by)
      VALUES (${sessionId}, ${tag}, ${createdBy ?? null})
      RETURNING *
    `;
    results.push(inserted);
  }
  return results;
}

/**
 * Remove a tag from a session.
 */
export async function untagSession(
  sql: Sql,
  sessionId: string,
  tag: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM sessions.session_tags
    WHERE session_id = ${sessionId} AND tag = ${tag}
  `;
  return Number(result.count ?? 0) > 0;
}

/**
 * Remove all tags from a session.
 */
export async function clearSessionTags(
  sql: Sql,
  sessionId: string,
): Promise<number> {
  const result = await sql`
    DELETE FROM sessions.session_tags WHERE session_id = ${sessionId}
  `;
  return Number(result.count ?? 0);
}

/**
 * List all tags for a session.
 */
export async function listSessionTags(
  sql: Sql,
  sessionId: string,
): Promise<SessionTag[]> {
  return sql<SessionTag[]>`
    SELECT * FROM sessions.session_tags
    WHERE session_id = ${sessionId}
    ORDER BY created_at ASC
  `;
}

/**
 * List all tags used in a workspace with usage counts.
 */
export async function listWorkspaceTags(
  sql: Sql,
  workspaceId: string,
  limit = 100,
): Promise<Array<{ tag: string; count: number; color: string | null }>> {
  return sql<Array<{ tag: string; count: number; color: string | null }>>`
    SELECT st.tag, COUNT(*) as count,
           MAX(st.color) as color
    FROM sessions.session_tags st
    JOIN sessions.conversations c ON c.id = st.session_id
    WHERE c.workspace_id = ${workspaceId}
    GROUP BY st.tag
    ORDER BY count DESC
    LIMIT ${limit}
  `;
}

/**
 * Find sessions by tag in a workspace.
 */
export async function findSessionsByTag(
  sql: Sql,
  workspaceId: string,
  tag: string,
  limit = 50,
): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    SELECT c.id
    FROM sessions.conversations c
    JOIN sessions.session_tags st ON st.session_id = c.id
    WHERE c.workspace_id = ${workspaceId} AND st.tag = ${tag}
    ORDER BY c.updated_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

/**
 * Update the color of a tag on a session.
 */
export async function updateTagColor(
  sql: Sql,
  sessionId: string,
  tag: string,
  color: string,
): Promise<boolean> {
  const result = await sql`
    UPDATE sessions.session_tags
    SET color = ${color}
    WHERE session_id = ${sessionId} AND tag = ${tag}
  `;
  return Number(result.count ?? 0) > 0;
}

/**
 * Add the same tags to multiple sessions at once (bulk tagging).
 */
export async function bulkTagSessions(
  sql: Sql,
  sessionIds: string[],
  tags: string[],
  createdBy?: string,
): Promise<{ tagged: number; skipped: number }> {
  if (sessionIds.length === 0 || tags.length === 0) return { tagged: 0, skipped: 0 };
  let tagged = 0;
  let skipped = 0;

  for (const sessionId of sessionIds) {
    const results = await tagSession(sql, sessionId, tags, createdBy);
    tagged += results.length;
    skipped += tags.length - results.length;
  }
  return { tagged, skipped };
}

/**
 * Find orphan tags — tags that exist but are not attached to any active session.
 * Useful for workspace admins to clean up stale tags.
 */
export async function findOrphanTags(
  sql: Sql,
  workspaceId: string,
): Promise<Array<{ tag: string; last_used_at: string | null }>> {
  return sql`
    SELECT st.tag, MAX(st.created_at) AS last_used_at
    FROM sessions.session_tags st
    JOIN sessions.conversations c ON c.id = st.session_id
    WHERE c.workspace_id = ${workspaceId}
    GROUP BY st.tag
    HAVING COUNT(st.session_id) = 0
  `;
}
