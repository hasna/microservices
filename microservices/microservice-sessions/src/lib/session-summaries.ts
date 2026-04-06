/**
 * Session summarization — store and retrieve LLM-generated summaries for sessions.
 *
 * Unlike context-summary.ts (which inserts a synthetic summarization message into
 * the conversation), this module stores standalone summary records so summaries
 * can be queried independently of the conversation message history.
 */

import type { Sql } from "postgres";
import { getConversation } from "./conversations.js";
import { getMessages } from "./messages.js";

export interface SessionSummary {
  id: string;
  session_id: string;
  summary_text: string;
  model_used: string | null;
  summarized_at: string;
  original_message_count: number;
}

export interface SummarizeSessionResult {
  summary: string;
  original_length: number;
  summarized_at: string;
}

/**
 * Generate a text summary of a session by extracting and concatenating
 * all assistant/user message content (skipping system/tool messages).
 *
 * This is a deterministic text-extraction summarizer — callers may replace
 * it with an actual LLM call and pass the result to store_session_summary.
 *
 * @param sql       - database handle
 * @param sessionId - conversation id
 * @param maxLength - optional max characters in the returned summary
 */
export async function summarizeSession(
  sql: Sql,
  sessionId: string,
  maxLength = 2000,
): Promise<SummarizeSessionResult> {
  const conv = await getConversation(sql, sessionId);
  if (!conv) throw new Error(`Session ${sessionId} not found`);

  const messages = await getMessages(sql, sessionId, { limit: 10000 });

  // Extract readable content: user + assistant + tool text
  const textParts: string[] = [];
  for (const msg of messages) {
    if (msg.role === "system") continue;
    if (msg.content) {
      textParts.push(`[${msg.role}]${msg.name ? `(${msg.name})` : ""}: ${msg.content}`);
    }
  }

  const originalText = textParts.join("\n");
  const original_length = originalText.length;

  let summary = originalText;
  if (summary.length > maxLength && maxLength > 0) {
    summary = summary.slice(0, maxLength - 3) + "...";
  }

  return {
    summary,
    original_length,
    summarized_at: new Date().toISOString(),
  };
}

/**
 * Summarize a session using an LLM-generated summary text and persist it.
 *
 * @param sql         - database handle
 * @param sessionId   - conversation id
 * @param summaryText - the LLM-generated summary
 * @param modelUsed   - model used for summarization
 */
export async function storeSessionSummary(
  sql: Sql,
  sessionId: string,
  summaryText: string,
  modelUsed?: string,
): Promise<SessionSummary> {
  const messages = await getMessages(sql, sessionId, { limit: 10000 });

  const [row] = await sql<SessionSummary[]>`
    INSERT INTO sessions.session_summaries (session_id, summary_text, model_used, original_message_count)
    VALUES (
      ${sessionId},
      ${summaryText},
      ${modelUsed ?? null},
      ${messages.length}
    )
    RETURNING *
  `;

  return row;
}

/**
 * Retrieve the latest summary for a session.
 */
export async function getSessionSummary(
  sql: Sql,
  sessionId: string,
): Promise<SessionSummary | null> {
  const [row] = await sql<SessionSummary[]>`
    SELECT * FROM sessions.session_summaries
    WHERE session_id = ${sessionId}
    ORDER BY summarized_at DESC
    LIMIT 1
  `;
  return row ?? null;
}

/**
 * Retrieve all summaries for a session, newest first.
 */
export async function listSessionSummaries(
  sql: Sql,
  sessionId: string,
): Promise<SessionSummary[]> {
  return sql<SessionSummary[]>`
    SELECT * FROM sessions.session_summaries
    WHERE session_id = ${sessionId}
    ORDER BY summarized_at DESC
  `;
}
