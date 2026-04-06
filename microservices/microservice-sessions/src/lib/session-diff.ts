/**
 * Session diff — compare two sessions or two branches of a fork tree
 * and return structured differences in message content, token usage, and structure.
 */

import type { Sql } from "postgres";
import { getConversation } from "./conversations.js";
import { getMessages } from "./messages.js";

export interface SessionDiff {
  session_a_id: string;
  session_b_id: string;
  same_session: boolean;
  // Structural diff
  messages_in_a: number;
  messages_in_b: number;
  message_diff: number;
  // Content diff
  common_messages: DiffMessage[];
  only_in_a: DiffMessage[];
  only_in_b: DiffMessage[];
  // Token diff
  tokens_a: number;
  tokens_b: number;
  token_diff: number;
  // Fork relationship
  relationship: "identical" | "fork" | "unrelated" | "same_session";
}

export interface DiffMessage {
  id: string;
  role: string;
  content: string;
  content_preview: string;
  tokens: number;
  created_at: string;
  position_in_session: number;
}

/**
 * Compare two sessions and return structured differences.
 */
export async function diffSessions(
  sql: Sql,
  sessionA: string,
  sessionB: string,
): Promise<SessionDiff> {
  if (sessionA === sessionB) {
    const conv = await getConversation(sql, sessionA);
    const msgs = await getMessages(sql, sessionA, { limit: 10000 });
    return {
      session_a_id: sessionA,
      session_b_id: sessionB,
      same_session: true,
      messages_in_a: msgs.length,
      messages_in_b: msgs.length,
      message_diff: 0,
      common_messages: msgs.map((m, i) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        content_preview: m.content.slice(0, 100),
        tokens: m.tokens,
        created_at: m.created_at,
        position_in_session: i,
      })),
      only_in_a: [],
      only_in_b: [],
      tokens_a: conv?.total_tokens ?? 0,
      tokens_b: conv?.total_tokens ?? 0,
      token_diff: 0,
      relationship: "same_session",
    };
  }

  const [convA, convB] = await Promise.all([
    getConversation(sql, sessionA),
    getConversation(sql, sessionB),
  ]);

  const [msgsA, msgsB] = await Promise.all([
    getMessages(sql, sessionA, { limit: 10000 }),
    getMessages(sql, sessionB, { limit: 10000 }),
  ]);

  // Determine relationship
  let relationship: SessionDiff["relationship"] = "unrelated";
  if (convA?.root_id && convB?.root_id && convA.root_id === convB.root_id) {
    relationship = "fork";
  } else if (convA?.parent_id === sessionB || convB?.parent_id === sessionA) {
    relationship = "fork";
  }

  const msgsAById = new Map(msgsA.map((m, i) => [m.id, { ...m, position_in_session: i }]));
  const msgsBById = new Map(msgsB.map((m, i) => [m.id, { ...m, position_in_session: i }]));

  const common: DiffMessage[] = [];
  const onlyA: DiffMessage[] = [];
  const onlyB: DiffMessage[] = [];

  for (const [id, m] of msgsAById) {
    const preview = { id: m.id, role: m.role, content: m.content, content_preview: m.content.slice(0, 100), tokens: m.tokens, created_at: m.created_at, position_in_session: m.position_in_session };
    if (msgsBById.has(id)) {
      common.push(preview);
    } else {
      onlyA.push(preview);
    }
  }

  for (const [id, m] of msgsBById) {
    const preview = { id: m.id, role: m.role, content: m.content, content_preview: m.content.slice(0, 100), tokens: m.tokens, created_at: m.created_at, position_in_session: m.position_in_session };
    if (!msgsAById.has(id)) {
      onlyB.push(preview);
    }
  }

  const totalTokensA = msgsA.reduce((s, m) => s + m.tokens, 0);
  const totalTokensB = msgsB.reduce((s, m) => s + m.tokens, 0);

  return {
    session_a_id: sessionA,
    session_b_id: sessionB,
    same_session: false,
    messages_in_a: msgsA.length,
    messages_in_b: msgsB.length,
    message_diff: msgsA.length - msgsB.length,
    common_messages: common,
    only_in_a: onlyA,
    only_in_b: onlyB,
    tokens_a: totalTokensA,
    tokens_b: totalTokensB,
    token_diff: totalTokensA - totalTokensB,
    relationship,
  };
}

/**
 * Find the common ancestor of two forked sessions.
 */
export async function findCommonAncestor(
  sql: Sql,
  sessionA: string,
  sessionB: string,
): Promise<{ messageId: string; createdAt: string } | null> {
  // Walk the fork tree for both sessions to find a common ancestor message
  const msgsA = await getMessages(sql, sessionA, { limit: 10000 });
  const msgsB = await getMessages(sql, sessionB, { limit: 10000 });

  const contentHashesA = new Map<string, { id: string; created_at: string; index: number }>();
  for (let i = 0; i < msgsA.length; i++) {
    const m = msgsA[i];
    const hash = simpleHash(`${m.role}:${m.content.slice(0, 50)}`);
    contentHashesA.set(hash, { id: m.id, created_at: m.created_at, index: i });
  }

  // Find first matching message (earliest in session A that also appears in B)
  for (let i = 0; i < msgsB.length; i++) {
    const m = msgsB[i];
    const hash = simpleHash(`${m.role}:${m.content.slice(0, 50)}`);
    const match = contentHashesA.get(hash);
    if (match) {
      return { messageId: match.id, createdAt: match.created_at };
    }
  }

  return null;
}

function simpleHash(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return hash.toString(16);
}

/**
 * Generate a plain-text diff between two sessions for human reading.
 */
export async function generateSessionDiffText(
  sql: Sql,
  sessionA: string,
  sessionB: string,
  opts?: { maxLines?: number },
): Promise<string> {
  const diff = await diffSessions(sql, sessionA, sessionB);
  const maxLines = opts?.maxLines ?? 100;
  const lines: string[] = [];

  lines.push(`=== Session Diff: ${sessionA} vs ${sessionB} ===`);
  lines.push(`Relationship: ${diff.relationship}`);
  lines.push(`Messages: ${diff.messages_in_a} vs ${diff.messages_in_b} (diff: ${diff.message_diff >= 0 ? "+" : ""}${diff.message_diff})`);
  lines.push(`Tokens: ${diff.tokens_a} vs ${diff.tokens_b} (diff: ${diff.token_diff >= 0 ? "+" : ""}${diff.token_diff})`);
  lines.push("");

  if (diff.only_in_a.length > 0) {
    lines.push(`--- Only in ${sessionA} (${diff.only_in_a.length} messages) ---`);
    for (const m of diff.only_in_a.slice(0, maxLines / 3)) {
      lines.push(`[${m.role}] ${m.content_preview}${m.content.length > 100 ? "..." : ""}`);
    }
    if (diff.only_in_a.length > maxLines / 3) lines.push(`... (${diff.only_in_a.length - maxLines / 3} more)`);
  }

  if (diff.only_in_b.length > 0) {
    lines.push(`--- Only in ${sessionB} (${diff.only_in_b.length} messages) ---`);
    for (const m of diff.only_in_b.slice(0, maxLines / 3)) {
      lines.push(`[${m.role}] ${m.content_preview}${m.content.length > 100 ? "..." : ""}`);
    }
    if (diff.only_in_b.length > maxLines / 3) lines.push(`... (${diff.only_in_b.length - maxLines / 3} more)`);
  }

  if (diff.common_messages.length > 0) {
    lines.push(`--- Common messages (${diff.common_messages.length}) ---`);
    lines.push("(Message content identical in both sessions)");
  }

  return lines.join("\n");
}