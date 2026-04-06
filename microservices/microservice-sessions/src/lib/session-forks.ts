/**
 * Session forking and pinning.
 *
 * fork_session  — creates a copy of a session under a new namespace
 *                 (or new workspace) with a new session_id; the fork's
 *                 parent_session_id references the original.
 *
 * get_session_lineage — returns the full fork tree (ancestors + descendants)
 *                       as a flat list with depth.
 *
 * pin_session / unpin_session — mark a session so it is never auto-archived.
 * is_session_pinned — check pin status.
 */

import type { Sql } from "postgres";
import type { Conversation } from "./conversations.js";
import { getConversation } from "./conversations.js";
import { getMessages } from "./messages.js";

export interface SessionLineageEntry {
  conversation: Conversation;
  depth: number;
  relationship: "self" | "ancestor" | "descendant";
}

/**
 * Create a fork of an existing session under a new namespace (workspace).
 * The new session copies all messages from the original.
 * The fork's parent_session_id points to the original session.
 *
 * @param sql          - database handle
 * @param sessionId    - id of the session to fork
 * @param newNamespace - optional new workspace_id; if omitted the fork
 *                        is created in the same workspace (a true clone)
 */
export async function forkSession(
  sql: Sql,
  sessionId: string,
  newNamespace?: string,
): Promise<Conversation | null> {
  const original = await getConversation(sql, sessionId);
  if (!original) return null;

  const [forked] = await sql<Conversation[]>`
    INSERT INTO sessions.conversations (
      workspace_id, user_id, title, model, system_prompt, metadata,
      parent_id, fork_depth, root_id, is_fork_pinned, parent_session_id
    )
    VALUES (
      ${newNamespace ?? original.workspace_id},
      ${original.user_id},
      ${original.title ? `Fork of ${original.title}` : "Forked session"},
      ${original.model},
      ${original.system_prompt},
      ${JSON.stringify(original.metadata)},
      ${sessionId},
      ${original.fork_depth + 1},
      ${original.root_id ?? original.id},
      false,
      ${sessionId}
    )
    RETURNING *
  `;

  // Copy all messages from the original session
  await sql`
    INSERT INTO sessions.messages (
      conversation_id, role, content, name, tool_calls, tokens,
      latency_ms, model, metadata, is_pinned, fork_point, summary_of_prior, created_at
    )
    SELECT
      ${forked.id}, role, content, name, tool_calls, tokens,
      latency_ms, model, metadata, is_pinned, fork_point, summary_of_prior, created_at
    FROM sessions.messages
    WHERE conversation_id = ${sessionId}
    ORDER BY created_at ASC
  `;

  // Sync message counts and tokens
  const [stats] = await sql<[{ count: number; total_tokens: number }]>`
    SELECT COUNT(*)::int as count, COALESCE(SUM(tokens), 0)::int as total_tokens
    FROM sessions.messages WHERE conversation_id = ${forked.id}
  `;

  await sql`
    UPDATE sessions.conversations
    SET message_count = ${stats.count},
        total_tokens  = ${stats.total_tokens},
        updated_at     = NOW(),
        last_activity_at = NOW()
    WHERE id = ${forked.id}
  `;

  return forked;
}

/**
 * Return the full fork lineage for a session: all ancestors and all descendants,
 * as a flat list with depth relative to the queried session and a relationship tag.
 *
 * Depth convention:
 *   depth < 0  → ancestor (higher in the tree)
 *   depth = 0  → self
 *   depth > 0  → descendant (lower in the tree)
 */
export async function getSessionLineage(
  sql: Sql,
  sessionId: string,
): Promise<SessionLineageEntry[]> {
  const conv = await getConversation(sql, sessionId);
  if (!conv) return [];

  const rootId = conv.root_id ?? conv.id;

  // Collect all members of the tree
  const tree = await sql<Conversation[]>`
    WITH RECURSIVE fork_tree AS (
      SELECT * FROM sessions.conversations WHERE id = ${rootId}
      UNION ALL
      SELECT c.* FROM sessions.conversations c
      INNER JOIN fork_tree ft ON c.parent_id = ft.id
    )
    SELECT * FROM fork_tree ORDER BY fork_depth ASC, created_at ASC
  `;

  // Index by id for quick lookup
  const byId = new Map<string, Conversation>();
  for (const c of tree) byId.set(c.id, c);

  const targetDepth = conv.fork_depth;

  const result: SessionLineageEntry[] = [];

  for (const c of tree) {
    let relationship: SessionLineageEntry["relationship"];
    if (c.id === sessionId) {
      relationship = "self";
    } else if (c.fork_depth < targetDepth) {
      relationship = "ancestor";
    } else {
      relationship = "descendant";
    }

    result.push({
      conversation: c,
      depth: c.fork_depth - targetDepth,
      relationship,
    });
  }

  return result;
}

/**
 * Pin a session so it is never auto-archived or auto-deleted.
 */
export async function pinSession(
  sql: Sql,
  sessionId: string,
): Promise<Conversation | null> {
  const [updated] = await sql<Conversation[]>`
    UPDATE sessions.conversations
    SET is_fork_pinned = true, updated_at = NOW()
    WHERE id = ${sessionId}
    RETURNING *
  `;
  return updated ?? null;
}

/**
 * Unpin a session, restoring normal lifecycle management.
 */
export async function unpinSession(
  sql: Sql,
  sessionId: string,
): Promise<Conversation | null> {
  const [updated] = await sql<Conversation[]>`
    UPDATE sessions.conversations
    SET is_fork_pinned = false, updated_at = NOW()
    WHERE id = ${sessionId}
    RETURNING *
  `;
  return updated ?? null;
}

/**
 * Return true if a session is currently pinned.
 */
export async function isSessionPinned(
  sql: Sql,
  sessionId: string,
): Promise<boolean> {
  const conv = await getConversation(sql, sessionId);
  return conv?.is_fork_pinned ?? false;
}
