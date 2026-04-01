/**
 * Message management — add, get, list, delete, pin, search.
 */

import type { Sql } from "postgres";

export interface Message {
  id: string;
  conversation_id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name: string | null;
  tool_calls: unknown | null;
  tokens: number;
  latency_ms: number | null;
  model: string | null;
  metadata: any;
  is_pinned: boolean;
  created_at: string;
}

export async function addMessage(
  sql: Sql,
  conversationId: string,
  data: {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    name?: string;
    tool_calls?: unknown;
    tokens?: number;
    latency_ms?: number;
    model?: string;
    metadata?: any;
  },
): Promise<Message> {
  const tokens = data.tokens ?? 0;

  const [msg] = await sql<Message[]>`
    INSERT INTO sessions.messages (conversation_id, role, content, name, tool_calls, tokens, latency_ms, model, metadata)
    VALUES (
      ${conversationId},
      ${data.role},
      ${data.content},
      ${data.name ?? null},
      ${data.tool_calls ? JSON.stringify(data.tool_calls) : null},
      ${tokens},
      ${data.latency_ms ?? null},
      ${data.model ?? null},
      ${JSON.stringify(data.metadata ?? {})}
    )
    RETURNING *
  `;

  // Increment conversation message_count and total_tokens
  await sql`
    UPDATE sessions.conversations
    SET message_count = message_count + 1,
        total_tokens = total_tokens + ${tokens},
        updated_at = NOW()
    WHERE id = ${conversationId}
  `;

  return msg;
}

export async function getMessages(
  sql: Sql,
  conversationId: string,
  opts: { limit?: number; before?: string; after?: string; role?: string } = {},
): Promise<Message[]> {
  const limit = opts.limit ?? 100;

  if (opts.before) {
    if (opts.role) {
      return sql<Message[]>`
        SELECT * FROM sessions.messages
        WHERE conversation_id = ${conversationId}
          AND created_at < ${opts.before}
          AND role = ${opts.role}
        ORDER BY created_at ASC
        LIMIT ${limit}
      `;
    }
    return sql<Message[]>`
      SELECT * FROM sessions.messages
      WHERE conversation_id = ${conversationId}
        AND created_at < ${opts.before}
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
  }

  if (opts.after) {
    if (opts.role) {
      return sql<Message[]>`
        SELECT * FROM sessions.messages
        WHERE conversation_id = ${conversationId}
          AND created_at > ${opts.after}
          AND role = ${opts.role}
        ORDER BY created_at ASC
        LIMIT ${limit}
      `;
    }
    return sql<Message[]>`
      SELECT * FROM sessions.messages
      WHERE conversation_id = ${conversationId}
        AND created_at > ${opts.after}
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
  }

  if (opts.role) {
    return sql<Message[]>`
      SELECT * FROM sessions.messages
      WHERE conversation_id = ${conversationId}
        AND role = ${opts.role}
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
  }

  return sql<Message[]>`
    SELECT * FROM sessions.messages
    WHERE conversation_id = ${conversationId}
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;
}

export async function getMessage(
  sql: Sql,
  id: string,
): Promise<Message | null> {
  const [msg] = await sql<Message[]>`
    SELECT * FROM sessions.messages WHERE id = ${id}
  `;
  return msg ?? null;
}

export async function deleteMessage(sql: Sql, id: string): Promise<boolean> {
  // Get message info first for updating conversation counts
  const msg = await getMessage(sql, id);
  if (!msg) return false;

  const result = await sql`
    DELETE FROM sessions.messages WHERE id = ${id}
  `;

  if (result.count > 0) {
    await sql`
      UPDATE sessions.conversations
      SET message_count = message_count - 1,
          total_tokens = total_tokens - ${msg.tokens},
          updated_at = NOW()
      WHERE id = ${msg.conversation_id}
    `;
    return true;
  }
  return false;
}

export async function pinMessage(
  sql: Sql,
  id: string,
): Promise<Message | null> {
  const [msg] = await sql<Message[]>`
    UPDATE sessions.messages SET is_pinned = NOT is_pinned WHERE id = ${id} RETURNING *
  `;
  return msg ?? null;
}

export async function searchMessages(
  sql: Sql,
  workspaceId: string,
  query: string,
  opts: { conversationId?: string; limit?: number } = {},
): Promise<Message[]> {
  const limit = opts.limit ?? 20;

  if (opts.conversationId) {
    return sql<Message[]>`
      SELECT m.* FROM sessions.messages m
      JOIN sessions.conversations c ON c.id = m.conversation_id
      WHERE c.workspace_id = ${workspaceId}
        AND m.conversation_id = ${opts.conversationId}
        AND to_tsvector('english', m.content) @@ plainto_tsquery('english', ${query})
      ORDER BY m.created_at DESC
      LIMIT ${limit}
    `;
  }

  return sql<Message[]>`
    SELECT m.* FROM sessions.messages m
    JOIN sessions.conversations c ON c.id = m.conversation_id
    WHERE c.workspace_id = ${workspaceId}
      AND to_tsvector('english', m.content) @@ plainto_tsquery('english', ${query})
    ORDER BY m.created_at DESC
    LIMIT ${limit}
  `;
}
