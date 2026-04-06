/**
 * Session branching — merge or transplant a fork onto a different parent.
 */

import type { Sql } from "postgres";

export interface MergeResult {
  source_session_id: string;
  target_session_id: string;
  messages_merged: number;
  new_message_count: number;
  operation: "transplant" | "rebase";
}

/**
 * Transplant a fork session onto a new parent session.
 * The fork's messages (after the fork point) are copied into the target as new messages.
 * The source fork is optionally archived.
 */
export async function transplantFork(
  sql: Sql,
  sourceSessionId: string,
  targetSessionId: string,
  archiveSource = false,
): Promise<MergeResult> {
  // Get the source fork's messages after the fork point
  const sourceMsgs = await sql<{
    id: string;
    role: string;
    content: string;
    name: string | null;
    tool_calls: unknown | null;
    tokens: number;
    latency_ms: number | null;
    model: string | null;
    metadata: unknown;
  }[]>`
    SELECT id, role, content, name, tool_calls, tokens, latency_ms, model, metadata
    FROM sessions.messages
    WHERE conversation_id = ${sourceSessionId}
      AND fork_point = false
    ORDER BY created_at ASC
  `;

  // Copy messages into the target session
  let messagesMerged = 0;
  for (const msg of sourceMsgs) {
    await sql`
      INSERT INTO sessions.messages (
        conversation_id, role, content, name, tool_calls,
        tokens, latency_ms, model, metadata
      )
      VALUES (
        ${targetSessionId},
        ${msg.role},
        ${msg.content},
        ${msg.name},
        ${msg.tool_calls ? JSON.stringify(msg.tool_calls) : null},
        ${msg.tokens},
        ${msg.latency_ms},
        ${msg.model},
        ${msg.metadata ? JSON.stringify(msg.metadata) : null}
      )
    `;
    messagesMerged++;
  }

  // Update target session's updated_at and message_count
  await sql`
    UPDATE sessions.conversations
    SET message_count = message_count + ${messagesMerged},
        updated_at = NOW()
    WHERE id = ${targetSessionId}
  `;

  if (archiveSource) {
    await sql`
      UPDATE sessions.conversations
      SET is_archived = true
      WHERE id = ${sourceSessionId}
    `;
  }

  const [updatedTarget] = await sql<{ message_count: number }[]>`
    SELECT message_count FROM sessions.conversations WHERE id = ${targetSessionId}
  `;

  return {
    source_session_id: sourceSessionId,
    target_session_id: targetSessionId,
    messages_merged: messagesMerged,
    new_message_count: Number(updatedTarget?.message_count ?? 0),
    operation: "transplant",
  };
}

/**
 * Rebase a fork session onto a different parent session.
 * Like transplant but also updates the fork's parent_id and depth.
 */
export async function rebaseFork(
  sql: Sql,
  sourceSessionId: string,
  newParentSessionId: string,
): Promise<MergeResult> {
  // Get new parent's fork_depth
  const [parent] = await sql<{ fork_depth: number; root_id: string | null }[]>`
    SELECT fork_depth, root_id FROM sessions.conversations WHERE id = ${newParentSessionId}
  `;
  if (!parent) throw new Error(`Parent session ${newParentSessionId} not found`);

  const newDepth = parent.fork_depth + 1;

  // Update source's parent and depth
  await sql`
    UPDATE sessions.conversations
    SET parent_id = ${newParentSessionId},
        parent_session_id = ${newParentSessionId},
        fork_depth = ${newDepth},
        root_id = COALESCE(${parent.root_id}, ${newParentSessionId}),
        updated_at = NOW()
    WHERE id = ${sourceSessionId}
  `;

  const result = await transplantFork(sql, sourceSessionId, newParentSessionId, false);

  return {
    ...result,
    operation: "rebase",
  };
}

/**
 * Get the full ancestry chain (all ancestors) of a session.
 */
export async function getSessionAncestors(
  sql: Sql,
  sessionId: string,
): Promise<{ id: string; title: string | null; fork_depth: number; parent_id: string | null }[]> {
  const ancestors: { id: string; title: string | null; fork_depth: number; parent_id: string | null }[] = [];
  let currentId: string | null = sessionId;

  for (let i = 0; i < 20 && currentId; i++) {
    const [row] = await sql<{ id: string; title: string | null; fork_depth: number; parent_id: string | null }[]>`
      SELECT id, title, fork_depth, parent_id
      FROM sessions.conversations
      WHERE id = ${currentId}
    `;
    if (!row || row.id === sessionId) break;
    ancestors.unshift(row);
    currentId = row.parent_id;
  }

  return ancestors;
}

/**
 * Find the merge base (common ancestor) between two sessions.
 */
export async function findMergeBase(
  sql: Sql,
  sessionA: string,
  sessionB: string,
): Promise<{ id: string; title: string | null; depth: number } | null> {
  const ancestorsA = await getSessionAncestors(sql, sessionA);
  const ancestorsB = await getSessionAncestors(sql, sessionB);
  const idsA = new Set(ancestorsA.map(a => a.id));

  for (const anc of ancestorsB.reverse()) {
    if (idsA.has(anc.id)) {
      return { id: anc.id, title: anc.title, depth: anc.fork_depth };
    }
  }

  return null;
}
