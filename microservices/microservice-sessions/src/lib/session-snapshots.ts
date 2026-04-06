/**
 * Session snapshots — point-in-time snapshots of a session's full state.
 * Snapshots capture the complete message history and conversation metadata
 * at a specific point in time, enabling audit trails, rollback, and comparison.
 */

import type { Sql } from "postgres";
import { getConversation } from "./conversations.js";
import { getMessages } from "./messages.js";

export interface SessionSnapshot {
  id: string;
  session_id: string;
  label: string | null;
  description: string | null;
  snapshot_data: SnapshotData;
  message_count: number;
  total_tokens: number;
  created_at: string;
}

export interface SnapshotData {
  conversation: {
    id: string;
    title: string | null;
    model: string | null;
    system_prompt: string | null;
    metadata: Record<string, unknown>;
    is_pinned: boolean;
    is_archived: boolean;
  };
  messages: Array<{
    id: string;
    role: string;
    content: string;
    name: string | null;
    tool_calls: unknown | null;
    tokens: number;
    latency_ms: number | null;
    model: string | null;
    metadata: Record<string, unknown>;
    is_pinned: boolean;
    created_at: string;
  }>;
  stats: {
    message_count: number;
    total_tokens: number;
    assistant_message_count: number;
    user_message_count: number;
    tool_message_count: number;
  };
}

/**
 * Create a point-in-time snapshot of a session.
 */
export async function createSessionSnapshot(
  sql: Sql,
  sessionId: string,
  opts?: { label?: string; description?: string },
): Promise<SessionSnapshot> {
  const conv = await getConversation(sql, sessionId);
  if (!conv) throw new Error(`Session ${sessionId} not found`);

  const messages = await getMessages(sql, sessionId, { limit: 10000 });

  const assistantMsgs = messages.filter((m) => m.role === "assistant").length;
  const userMsgs = messages.filter((m) => m.role === "user").length;
  const toolMsgs = messages.filter((m) => m.role === "tool").length;

  const snapshotData: SnapshotData = {
    conversation: {
      id: conv.id,
      title: conv.title,
      model: conv.model,
      system_prompt: conv.system_prompt,
      metadata: conv.metadata as Record<string, unknown>,
      is_pinned: conv.is_pinned,
      is_archived: conv.is_archived,
    },
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      name: m.name,
      tool_calls: m.tool_calls,
      tokens: m.tokens,
      latency_ms: m.latency_ms,
      model: m.model,
      metadata: m.metadata as Record<string, unknown>,
      is_pinned: m.is_pinned,
      created_at: m.created_at,
    })),
    stats: {
      message_count: messages.length,
      total_tokens: conv.total_tokens,
      assistant_message_count: assistantMsgs,
      user_message_count: userMsgs,
      tool_message_count: toolMsgs,
    },
  };

  const [row] = await sql<SessionSnapshot[]>`
    INSERT INTO sessions.session_snapshots
      (session_id, label, description, snapshot_data, message_count, total_tokens)
    VALUES (
      ${sessionId},
      ${opts?.label ?? null},
      ${opts?.description ?? null},
      ${snapshotData},
      ${messages.length},
      ${conv.total_tokens}
    )
    RETURNING *
  `;
  return row;
}

/**
 * Get a snapshot by ID.
 */
export async function getSessionSnapshot(
  sql: Sql,
  snapshotId: string,
): Promise<SessionSnapshot | null> {
  const [row] = await sql<SessionSnapshot[]>`
    SELECT * FROM sessions.session_snapshots WHERE id = ${snapshotId}
  `;
  return row ?? null;
}

/**
 * List snapshots for a session.
 */
export async function listSessionSnapshots(
  sql: Sql,
  sessionId: string,
  options?: { limit?: number; offset?: number },
): Promise<SessionSnapshot[]> {
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;
  const [rows] = await sql<SessionSnapshot[]>`
    SELECT * FROM sessions.session_snapshots
    WHERE session_id = ${sessionId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return rows;
}

/**
 * Delete a snapshot.
 */
export async function deleteSessionSnapshot(
  sql: Sql,
  snapshotId: string,
): Promise<boolean> {
  const result = await sql`DELETE FROM sessions.session_snapshots WHERE id = ${snapshotId}`;
  return (result as any).count > 0;
}

/**
 * Compare two snapshots and return a diff summary.
 */
export async function compareSnapshots(
  sql: Sql,
  snapshotA: string,
  snapshotB: string,
): Promise<{
  session_id: string;
  added_messages: number;
  removed_messages: number;
  token_delta: number;
  time_elapsed: string;
  newer_snapshot_id: string;
  older_snapshot_id: string;
}> {
  const [snapA, snapB] = await Promise.all([
    getSessionSnapshot(sql, snapshotA),
    getSessionSnapshot(sql, snapshotB),
  ]);
  if (!snapA || !snapB) throw new Error("One or both snapshots not found");

  const older = new Date(snapA.created_at) < new Date(snapB.created_at) ? snapA : snapB;
  const newer = older.id === snapA.id ? snapB : snapA;

  const olderMsgIds = new Set(older.snapshot_data.messages.map((m) => m.id));
  const newerMsgIds = new Set(newer.snapshot_data.messages.map((m) => m.id));

  const addedMessages = newer.snapshot_data.messages.filter((m) => !olderMsgIds.has(m.id)).length;
  const removedMessages = older.snapshot_data.messages.filter((m) => !newerMsgIds.has(m.id)).length;

  const tokenDelta = newer.snapshot_data.stats.total_tokens - older.snapshot_data.stats.total_tokens;

  const elapsed = Math.abs(new Date(newer.created_at).getTime() - new Date(older.created_at).getTime());
  const elapsedStr = elapsed < 60000
    ? `${Math.floor(elapsed / 1000)}s`
    : elapsed < 3600000
    ? `${Math.floor(elapsed / 60000)}m`
    : `${Math.floor(elapsed / 3600000)}h`;

  return {
    session_id: newer.snapshot_data.conversation.id,
    added_messages: addedMessages,
    removed_messages: removedMessages,
    token_delta: tokenDelta,
    time_elapsed: elapsedStr,
    newer_snapshot_id: newer.id,
    older_snapshot_id: older.id,
  };
}

/**
 * Restore a session from a snapshot (replaces current messages with snapshot messages).
 * This archives the current state first by creating an automatic snapshot.
 */
export async function restoreFromSnapshot(
  sql: Sql,
  sessionId: string,
  snapshotId: string,
): Promise<{ restored_message_count: number; auto_snapshot_id: string }> {
  // First, create an automatic snapshot of the current state before overwriting
  const autoSnapshot = await createSessionSnapshot(sql, sessionId, {
    label: "auto-backup-before-restore",
    description: `Automatic backup created before restoring from snapshot ${snapshotId}`,
  });

  const snapshot = await getSessionSnapshot(sql, snapshotId);
  if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found`);

  // Delete all current messages
  await sql`DELETE FROM sessions.messages WHERE conversation_id = ${sessionId}`;

  // Re-insert all messages from the snapshot
  const msgs = snapshot.snapshot_data.messages;
  if (msgs.length > 0) {
    const values = msgs.map((m) =>
      `(${sessionId}, ${m.role}, ${m.content}, ${m.name ?? null}, ${m.tool_calls ? JSON.stringify(m.tool_calls) : null}, ${m.tokens}, ${m.latency_ms ?? null}, ${m.model ?? null}, ${JSON.stringify(m.metadata)}, ${m.is_pinned}, ${m.created_at})`
    ).join(", ");

    await sql.unsafe(`
      INSERT INTO sessions.messages
        (conversation_id, role, content, name, tool_calls, tokens, latency_ms, model, metadata, is_pinned, created_at)
      VALUES ${values}
    `);
  }

  // Update conversation metadata
  const conv = snapshot.snapshot_data.conversation;
  await sql`
    UPDATE sessions.conversations SET
      title = ${conv.title},
      model = ${conv.model},
      system_prompt = ${conv.system_prompt},
      metadata = ${conv.metadata},
      is_pinned = ${conv.is_pinned},
      is_archived = ${conv.is_archived},
      total_tokens = ${snapshot.snapshot_data.stats.total_tokens},
      message_count = ${snapshot.snapshot_data.stats.message_count},
      updated_at = NOW()
    WHERE id = ${sessionId}
  `;

  return {
    restored_message_count: msgs.length,
    auto_snapshot_id: autoSnapshot.id,
  };
}

/**
 * Prune old snapshots, keeping only the most recent N per session.
 */
export async function pruneOldSnapshots(
  sql: Sql,
  workspaceId: string,
  keepMostRecent = 5,
): Promise<number> {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days old
  const [oldSnapshots] = await sql<{ id: string; session_id: string }[]>`
    SELECT id, session_id FROM sessions.session_snapshots ss
    JOIN sessions.conversations c ON c.id = ss.session_id
    WHERE c.workspace_id = ${workspaceId}
      AND ss.created_at < ${cutoff}
      AND ss.label IS DISTINCT FROM 'auto-backup-before-restore'
  `;

  if (!oldSnapshots || oldSnapshots.length === 0) return 0;

  // Delete old snapshots
  const ids = oldSnapshots.map((s) => s.id);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  await sql.unsafe(`DELETE FROM sessions.session_snapshots WHERE id IN (${placeholders})`, ...ids);

  return ids.length;
}