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
  metadata: any;
  is_archived: boolean;
  is_pinned: boolean;
  total_tokens: number;
  message_count: number;
  created_at: string;
  updated_at: string;
  parent_id: string | null;
  fork_depth: number;
  summary: string | null;
  summary_tokens: number | null;
  is_fork_pinned: boolean;
  root_id: string | null;
}

export async function createConversation(
  sql: Sql,
  data: {
    workspace_id: string;
    user_id: string;
    title?: string;
    model?: string;
    system_prompt?: string;
    metadata?: any;
  },
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

export async function getConversation(
  sql: Sql,
  id: string,
): Promise<Conversation | null> {
  const [conv] = await sql<Conversation[]>`
    SELECT * FROM sessions.conversations WHERE id = ${id}
  `;
  return conv ?? null;
}

export async function listConversations(
  sql: Sql,
  workspaceId: string,
  userId: string,
  opts: {
    archived?: boolean;
    limit?: number;
    offset?: number;
    search?: string;
  } = {},
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
    metadata?: any;
    summary?: string;
    summary_tokens?: number;
    is_fork_pinned?: boolean;
  },
): Promise<Conversation | null> {
  const conv = await getConversation(sql, id);
  if (!conv) return null;

  const [updated] = await sql<Conversation[]>`
    UPDATE sessions.conversations SET
      title         = COALESCE(${data.title ?? null}, title),
      model         = COALESCE(${data.model ?? null}, model),
      system_prompt = COALESCE(${data.system_prompt ?? null}, system_prompt),
      is_archived   = COALESCE(${data.is_archived ?? null}, is_archived),
      is_pinned     = COALESCE(${data.is_pinned ?? null}, is_pinned),
      metadata      = COALESCE(${data.metadata ? JSON.stringify(data.metadata) : null}::jsonb, metadata),
      summary       = COALESCE(${data.summary ?? null}, summary),
      summary_tokens = COALESCE(${data.summary_tokens ?? null}, summary_tokens),
      is_fork_pinned = COALESCE(${data.is_fork_pinned ?? null}, is_fork_pinned),
      updated_at    = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return updated ?? null;
}

/**
 * Update or set a conversation summary (typically called by an LLM summarizer).
 */
export async function updateSummary(
  sql: Sql,
  id: string,
  summary: string,
  summaryTokens: number,
): Promise<Conversation | null> {
  return updateConversation(sql, id, { summary, summary_tokens: summaryTokens });
}

/**
 * Pin or unpin a fork in the conversation tree.
 */
export async function setForkPinned(
  sql: Sql,
  id: string,
  pinned: boolean,
): Promise<Conversation | null> {
  return updateConversation(sql, id, { is_fork_pinned: pinned });
}

/**
 * Get the full fork tree for a given conversation (all descendants).
 */
export async function getForkTree(
  sql: Sql,
  conversationId: string,
): Promise<Conversation[]> {
  // Find root
  const conv = await getConversation(sql, conversationId);
  if (!conv) return [];
  const rootId = conv.root_id ?? conv.id;

  // Recursive CTE to get all descendants
  return sql<Conversation[]>`
    WITH RECURSIVE fork_tree AS (
      SELECT * FROM sessions.conversations WHERE id = ${rootId}
      UNION ALL
      SELECT c.* FROM sessions.conversations c
      INNER JOIN fork_tree ft ON c.parent_id = ft.id
    )
    SELECT * FROM fork_tree ORDER BY fork_depth ASC, created_at ASC
  `;
}

/**
 * Summarize a conversation: condenses older messages into a summary.
 * The actual summarization should be done by an LLM — this function stores the result.
 */
export async function summarizeConversation(
  sql: Sql,
  id: string,
  summaryText: string,
  tokensUsed: number,
): Promise<Conversation | null> {
  return updateSummary(sql, id, summaryText, tokensUsed);
}

/**
 * Get the root conversation of a fork tree.
 */
export async function getRootConversation(
  sql: Sql,
  conversationId: string,
): Promise<Conversation | null> {
  const conv = await getConversation(sql, conversationId);
  if (!conv) return null;
  if (!conv.root_id) return conv;
  return getConversation(sql, conv.root_id);
}

/**
 * List all forks directly descended from a conversation.
 */
export async function listChildForks(
  sql: Sql,
  conversationId: string,
): Promise<Conversation[]> {
  return sql<Conversation[]>`
    SELECT * FROM sessions.conversations
    WHERE parent_id = ${conversationId}
    ORDER BY created_at ASC
  `;
}

export async function deleteConversation(
  sql: Sql,
  id: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM sessions.conversations WHERE id = ${id}
  `;
  return result.count > 0;
}

export async function archiveConversation(
  sql: Sql,
  id: string,
): Promise<Conversation | null> {
  return updateConversation(sql, id, { is_archived: true });
}

export async function forkConversation(
  sql: Sql,
  conversationId: string,
  fromMessageId: string,
  opts: { title?: string; pinFork?: boolean } = {},
): Promise<Conversation | null> {
  const original = await getConversation(sql, conversationId);
  if (!original) return null;

  // Get the target message to find its creation time
  const [targetMsg] = await sql<[{ created_at: string }]>`
    SELECT created_at FROM sessions.messages WHERE id = ${fromMessageId} AND conversation_id = ${conversationId}
  `;
  if (!targetMsg) return null;

  const rootId = original.root_id ?? original.id;

  // Create a new conversation with fork tree fields
  const [forked] = await sql<Conversation[]>`
    INSERT INTO sessions.conversations (workspace_id, user_id, title, model, system_prompt, metadata, parent_id, fork_depth, root_id, is_fork_pinned)
    VALUES (
      ${original.workspace_id},
      ${original.user_id},
      ${opts.title ?? (original.title ? `Fork of ${original.title}` : "Forked conversation")},
      ${original.model},
      ${original.system_prompt},
      ${JSON.stringify(original.metadata)},
      ${conversationId},
      ${original.fork_depth + 1},
      ${rootId},
      ${opts.pinFork ?? false}
    )
    RETURNING *
  `;

  // Copy messages up to and including the target message, marking fork point
  await sql`
    INSERT INTO sessions.messages (conversation_id, role, content, name, tool_calls, tokens, latency_ms, model, metadata, is_pinned, fork_point, created_at)
    SELECT
      ${forked.id}, role, content, name, tool_calls, tokens, latency_ms, model, metadata, is_pinned,
      CASE WHEN id = ${fromMessageId} THEN true ELSE false END,
      created_at
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
