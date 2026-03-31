/**
 * Conversation management — create, get, list, update, delete, archive, fork.
 */

import type { Sql } from "postgres";

export interface Conversation {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string | null;
  model: string | null;
  system_prompt: string | null;
  metadata: Record<string, unknown>;
  is_archived: boolean;
  is_pinned: boolean;
  total_tokens: number;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export async function createConversation(
  sql: Sql,
  data: {
    workspace_id: string;
    user_id: string;
    title?: string;
    model?: string;
    system_prompt?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<Conversation> {
  const [conv] = await sql<Conversation[]>`
    INSERT INTO sessions.conversations (workspace_id, user_id, title, model, system_prompt, metadata)
    VALUES (
      ${data.workspace_id},
      ${data.user_id},
      ${data.title ?? null},
      ${data.model ?? null},
      ${data.system_prompt ?? null},
      ${JSON.stringify(data.metadata ?? {})}
    )
    RETURNING *
  `;
  return conv;
}

export async function getConversation(sql: Sql, id: string): Promise<Conversation | null> {
  const [conv] = await sql<Conversation[]>`
    SELECT * FROM sessions.conversations WHERE id = ${id}
  `;
  return conv ?? null;
}

export async function listConversations(
  sql: Sql,
  workspaceId: string,
  userId: string,
  opts: { archived?: boolean; limit?: number; offset?: number; search?: string } = {}
): Promise<Conversation[]> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  if (opts.search) {
    const pattern = `%${opts.search}%`;
    if (opts.archived !== undefined) {
      return sql<Conversation[]>`
        SELECT * FROM sessions.conversations
        WHERE workspace_id = ${workspaceId}
          AND user_id = ${userId}
          AND is_archived = ${opts.archived}
          AND (title ILIKE ${pattern} OR system_prompt ILIKE ${pattern})
        ORDER BY updated_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }
    return sql<Conversation[]>`
      SELECT * FROM sessions.conversations
      WHERE workspace_id = ${workspaceId}
        AND user_id = ${userId}
        AND (title ILIKE ${pattern} OR system_prompt ILIKE ${pattern})
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  if (opts.archived !== undefined) {
    return sql<Conversation[]>`
      SELECT * FROM sessions.conversations
      WHERE workspace_id = ${workspaceId}
        AND user_id = ${userId}
        AND is_archived = ${opts.archived}
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  return sql<Conversation[]>`
    SELECT * FROM sessions.conversations
    WHERE workspace_id = ${workspaceId}
      AND user_id = ${userId}
    ORDER BY updated_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export async function updateConversation(
  sql: Sql,
  id: string,
  data: {
    title?: string;
    model?: string;
    system_prompt?: string;
    is_archived?: boolean;
    is_pinned?: boolean;
    metadata?: Record<string, unknown>;
  }
): Promise<Conversation | null> {
  const sets: string[] = [];
  const conv = await getConversation(sql, id);
  if (!conv) return null;

  // Build dynamic update
  const [updated] = await sql<Conversation[]>`
    UPDATE sessions.conversations SET
      title         = COALESCE(${data.title ?? null}, title),
      model         = COALESCE(${data.model ?? null}, model),
      system_prompt = COALESCE(${data.system_prompt ?? null}, system_prompt),
      is_archived   = COALESCE(${data.is_archived ?? null}, is_archived),
      is_pinned     = COALESCE(${data.is_pinned ?? null}, is_pinned),
      metadata      = COALESCE(${data.metadata ? JSON.stringify(data.metadata) : null}::jsonb, metadata),
      updated_at    = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return updated ?? null;
}

export async function deleteConversation(sql: Sql, id: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM sessions.conversations WHERE id = ${id}
  `;
  return result.count > 0;
}

export async function archiveConversation(sql: Sql, id: string): Promise<Conversation | null> {
  return updateConversation(sql, id, { is_archived: true });
}

export async function forkConversation(
  sql: Sql,
  conversationId: string,
  fromMessageId: string
): Promise<Conversation | null> {
  const original = await getConversation(sql, conversationId);
  if (!original) return null;

  // Get the target message to find its creation time
  const [targetMsg] = await sql<[{ created_at: string }]>`
    SELECT created_at FROM sessions.messages WHERE id = ${fromMessageId} AND conversation_id = ${conversationId}
  `;
  if (!targetMsg) return null;

  // Create a new conversation
  const [forked] = await sql<Conversation[]>`
    INSERT INTO sessions.conversations (workspace_id, user_id, title, model, system_prompt, metadata)
    VALUES (
      ${original.workspace_id},
      ${original.user_id},
      ${original.title ? `Fork of ${original.title}` : 'Forked conversation'},
      ${original.model},
      ${original.system_prompt},
      ${JSON.stringify(original.metadata)}
    )
    RETURNING *
  `;

  // Copy messages up to and including the target message
  await sql`
    INSERT INTO sessions.messages (conversation_id, role, content, name, tool_calls, tokens, latency_ms, model, metadata, is_pinned, created_at)
    SELECT ${forked.id}, role, content, name, tool_calls, tokens, latency_ms, model, metadata, is_pinned, created_at
    FROM sessions.messages
    WHERE conversation_id = ${conversationId}
      AND created_at <= ${targetMsg.created_at}
    ORDER BY created_at ASC
  `;

  // Update counts on the forked conversation
  const [stats] = await sql<[{ count: number; total_tokens: number }]>`
    SELECT COUNT(*)::int as count, COALESCE(SUM(tokens), 0)::int as total_tokens
    FROM sessions.messages WHERE conversation_id = ${forked.id}
  `;

  const [updated] = await sql<Conversation[]>`
    UPDATE sessions.conversations
    SET message_count = ${stats.count}, total_tokens = ${stats.total_tokens}, updated_at = NOW()
    WHERE id = ${forked.id}
    RETURNING *
  `;

  return updated;
}
