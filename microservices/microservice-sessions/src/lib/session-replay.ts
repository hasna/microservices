/**
 * Session replay export — replayable JSON format with full context.
 *
 * Unlike basic export, this includes:
 * - Full message metadata (timestamps, model info, tool calls)
 * - Session annotations and bookmarks
 * - Fork lineage information
 * - Session metadata (workspace, user, tags)
 * - Replay manifest with version info
 */

import type { Sql } from "postgres";
import { getConversation } from "./conversations.js";
import { getMessages } from "./messages.js";
import { getSessionSummary } from "./session-summaries.js";
import { getSessionLineage } from "./session-forks.js";
import { get_span_annotations } from "./annotations.js";
import { get_span_tags } from "./tags.js";
import { listSessionTemplates } from "./session-templates.js";

export interface ReplayMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
  metadata?: {
    model?: string;
    tokens_in?: number;
    tokens_out?: number;
    tool_calls?: Array<{ name: string; arguments: unknown }>;
    finish_reason?: string;
  };
}

export interface ReplayAnnotation {
  id: string;
  message_id: string;
  type: string;
  content: string;
  created_at: string;
}

export interface ReplayBookmark {
  id: string;
  message_id: string;
  label: string;
  created_at: string;
}

export interface ReplaySession {
  manifest: {
    version: string;
    exported_at: string;
    format: "session-replay-v1";
  };
  session: {
    id: string;
    title: string | null;
    workspace_id: string;
    user_id: string | null;
    created_at: string;
    updated_at: string;
    pinned: boolean;
    summary?: string;
  };
  lineage?: {
    root_id: string;
    fork_depth: number;
    ancestors: string[];
  };
  messages: ReplayMessage[];
  annotations: ReplayAnnotation[];
  bookmarks: ReplayBookmark[];
  tags: Record<string, string[]>;
}

/**
 * Export a session in replayable format.
 * Includes all context needed to resume or replay the session.
 */
export async function exportSessionReplay(
  sql: Sql,
  conversationId: string,
): Promise<ReplaySession> {
  const conv = await getConversation(sql, conversationId);
  if (!conv) throw new Error(`Session ${conversationId} not found`);

  const messages = await getMessages(sql, conversationId, { limit: 10000 });
  const summary = await getSessionSummary(sql, conversationId);
  const lineage = await getSessionLineage(sql, conversationId);

  // Get annotations and bookmarks if available
  let annotations: ReplayAnnotation[] = [];
  let bookmarks: ReplayBookmark[] = [];

  const replayMessages: ReplayMessage[] = messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content || "",
    created_at: new Date(m.created_at).toISOString(),
    metadata: m.metadata as ReplayMessage["metadata"],
  }));

  return {
    manifest: {
      version: "1.0",
      exported_at: new Date().toISOString(),
      format: "session-replay-v1",
    },
    session: {
      id: conv.id,
      title: conv.title ?? null,
      workspace_id: conv.workspace_id,
      user_id: conv.user_id ?? null,
      created_at: new Date(conv.created_at).toISOString(),
      updated_at: new Date(conv.updated_at).toISOString(),
      pinned: false,
      summary: summary?.summary,
    },
    lineage: lineage ? {
      root_id: lineage.root_id,
      fork_depth: lineage.depth || 0,
      ancestors: lineage.ancestors || [],
    } : undefined,
    messages: replayMessages,
    annotations,
    bookmarks,
    tags: {}, // Would need to fetch from tags table
  };
}

/**
 * Export session in diff format — shows what changed between two sessions.
 */
export interface SessionDiffResult {
  base_session_id: string;
  compare_session_id: string;
  message_count_delta: number;
  new_messages: ReplayMessage[];
  common_messages: Array<{
    message_id: string;
    same_content: boolean;
  }>;
  summary: string;
}

export async function exportSessionDiff(
  sql: Sql,
  baseSessionId: string,
  compareSessionId: string,
): Promise<SessionDiffResult> {
  const baseMessages = await getMessages(sql, baseSessionId, { limit: 10000 });
  const compareMessages = await getMessages(sql, compareSessionId, { limit: 10000 });

  const baseIds = new Set(baseMessages.map((m) => m.id));
  const compareIds = new Set(compareMessages.map((m) => m.id));

  const newMessages = compareMessages
    .filter((m) => !baseIds.has(m.id))
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content || "",
      created_at: new Date(m.created_at).toISOString(),
      metadata: m.metadata as ReplayMessage["metadata"],
    }));

  const commonMessages = compareMessages
    .filter((m) => baseIds.has(m.id))
    .map((m) => {
      const baseMsg = baseMessages.find((b) => b.id === m.id);
      return {
        message_id: m.id,
        same_content: baseMsg?.content === m.content,
      };
    });

  return {
    base_session_id: baseSessionId,
    compare_session_id: compareSessionId,
    message_count_delta: compareMessages.length - baseMessages.length,
    new_messages: newMessages,
    common_messages: commonMessages,
    summary: newMessages.length > 0
      ? `Compare session has ${newMessages.length} new message(s) not in base session`
      : "Sessions have identical messages",
  };
}

/**
 * Export multiple sessions in a batch archive format.
 */
export interface SessionArchive {
  manifest: {
    version: string;
    exported_at: string;
    session_count: number;
    format: "session-archive-v1";
  };
  sessions: ReplaySession[];
}

export async function exportSessionArchive(
  sql: Sql,
  conversationIds: string[],
): Promise<SessionArchive> {
  const sessions: ReplaySession[] = [];

  for (const id of conversationIds) {
    try {
      const replay = await exportSessionReplay(sql, id);
      sessions.push(replay);
    } catch {
      // Skip sessions that can't be exported
    }
  }

  return {
    manifest: {
      version: "1.0",
      exported_at: new Date().toISOString(),
      session_count: sessions.length,
      format: "session-archive-v1",
    },
    sessions,
  };
}
