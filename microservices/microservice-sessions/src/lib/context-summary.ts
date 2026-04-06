/**
 * Context summarization — condense older messages when approaching token limits.
 * The actual summarization is delegated to an LLM caller; this module provides
 * the structural helpers to partition messages and store the summary.
 */

import type { Sql } from "postgres";
import { getConversation } from "./conversations.js";
import { getMessages } from "./messages.js";

export interface SummarizeOpts {
  /** Keep this many of the most recent messages untouched (default 5) */
  keepRecent?: number;
  /** Target token count after summarization (default 2000) */
  targetTokens?: number;
}

export interface SummarizeResult {
  conversationId: string;
  summaryText: string;
  tokensUsed: number;
  messagesPrior: number;
  messagesAfter: number;
  tokensPrior: number;
  tokensAfter: number;
}

/**
 * Build a text summary of all but the most recent N messages.
 * The caller should pass this text to an LLM and then call storeContextSummary.
 */
export function buildSummaryInput(
  messages: {
    role: string;
    content: string;
    name: string | null;
    tokens: number;
  }[],
  keepRecent = 5,
): { priorText: string; priorTokens: number; recentCount: number } {
  if (messages.length <= keepRecent) {
    return { priorText: "", priorTokens: 0, recentCount: messages.length };
  }
  const prior = messages.slice(0, -keepRecent);
  const priorText = prior
    .map((m) => `${m.role}${m.name ? `(${m.name})` : ""}: ${m.content}`)
    .join("\n");
  const priorTokens = prior.reduce((sum, m) => sum + m.tokens, 0);
  return { priorText, priorTokens, recentCount: keepRecent };
}

/**
 * Mark messages as "summary of prior" so downstream callers know they've been summarized.
 */
export async function markPriorAsSummarized(
  sql: Sql,
  conversationId: string,
  count: number,
): Promise<void> {
  const messages = await getMessages(sql, conversationId, { limit: count });
  const ids = messages.slice(0, count).map((m) => m.id);
  if (ids.length === 0) return;
  await sql`
    UPDATE sessions.messages
    SET summary_of_prior = true
    WHERE id IN ${sql(ids)}
  `;
}

/**
 * Store the generated summary text and mark prior messages.
 * Call this after the LLM has produced a summary.
 */
export async function storeContextSummary(
  sql: Sql,
  conversationId: string,
  summaryText: string,
  tokensUsed: number,
  opts: SummarizeOpts = {},
): Promise<SummarizeResult> {
  const { keepRecent = 5 } = opts;

  const messages = await getMessages(sql, conversationId, { limit: 9999 });
  const beforeTokens = messages.reduce((s, m) => s + m.tokens, 0);
  const priorCount = Math.max(0, messages.length - keepRecent);

  // Mark prior messages as summarized
  await markPriorAsSummarized(sql, conversationId, priorCount);

  // Insert a system message with the summary at the transition point
  const summaryMsgIndex = messages.length - keepRecent - 1;
  const [inserted] = await sql`
    INSERT INTO sessions.messages (
      conversation_id, role, content, tokens, model, metadata,
      fork_point, summary_of_prior
    )
    VALUES (
      ${conversationId},
      'system',
      ${`[Prior context summarized]\n\n${summaryText}`},
      ${tokensUsed},
      'summarizer',
      ${JSON.stringify({ summarized_count: priorCount })},
      false,
      true
    )
    RETURNING id
  `;

  // Re-order: insert at the right position by updating the created_at
  if (inserted && summaryMsgIndex >= 0 && summaryMsgIndex < messages.length) {
    const pivotCreatedAt = messages[summaryMsgIndex].created_at;
    await sql`
      UPDATE sessions.messages
      SET created_at = ${pivotCreatedAt} - interval '1 millisecond'
      WHERE id = ${inserted.id}
    `;
  }

  // Recalculate token count
  const updated = await getMessages(sql, conversationId, { limit: 9999 });
  const afterTokens = updated.reduce((s, m) => s + m.tokens, 0);

  // Update conversation summary fields
  const { summarizeConversation } = await import("./conversations.js");
  await summarizeConversation(sql, conversationId, summaryText, tokensUsed);

  return {
    conversationId,
    summaryText,
    tokensUsed,
    messagesPrior: messages.length,
    messagesAfter: updated.length,
    tokensPrior: beforeTokens,
    tokensAfter: afterTokens,
  };
}

/**
 * Detect if a conversation is approaching token limits and needs summarization.
 */
export async function needsSummarization(
  sql: Sql,
  conversationId: string,
  threshold = 6000,
): Promise<{ needs: boolean; totalTokens: number; messageCount: number }> {
  const conv = await getConversation(sql, conversationId);
  if (!conv) return { needs: false, totalTokens: 0, messageCount: 0 };
  return {
    needs: conv.total_tokens > threshold,
    totalTokens: conv.total_tokens,
    messageCount: conv.message_count,
  };
}

/**
 * Get summarization history for a conversation — how many times it was summarized
 * and total tokens saved across all summarizations.
 */
export async function getSummarizationHistory(
  sql: Sql,
  conversationId: string,
): Promise<{
  summaryCount: number;
  totalTokensSummarized: number;
  lastSummaryAt: string | null;
  summaries: Array<{ id: string; tokens: number; created_at: string; model: string }>;
}> {
  const summaries = await sql<Array<{ id: string; tokens: number; created_at: string; model: string }>>`
    SELECT id, tokens, created_at, model
    FROM sessions.messages
    WHERE conversation_id = ${conversationId}
      AND role = 'system'
      AND content LIKE '%[Prior context summarized]%'
    ORDER BY created_at DESC
  `;

  return {
    summaryCount: summaries.length,
    totalTokensSummarized: summaries.reduce((s, m) => s + m.tokens, 0),
    lastSummaryAt: summaries[0]?.created_at ?? null,
    summaries,
  };
}

/**
 * Estimate token savings if a conversation were summarized now.
 * Returns { priorTokens, estimatedAfterTokens, savingsPercent }.
 */
export async function estimateSummarizationSavings(
  sql: Sql,
  conversationId: string,
  keepRecent = 5,
): Promise<{ priorTokens: number; estimatedAfterTokens: number; savingsPercent: number }> {
  const messages = await getMessages(sql, conversationId, { limit: 9999 });
  if (messages.length <= keepRecent) {
    return { priorTokens: 0, estimatedAfterTokens: 0, savingsPercent: 0 };
  }

  const priorMessages = messages.slice(0, -keepRecent);
  const priorTokens = priorMessages.reduce((s, m) => s + m.tokens, 0);

  // Estimate: summary text is roughly 10-15% of original tokens + overhead for system prompt
  const estimatedSummaryTokens = Math.max(50, Math.round(priorTokens * 0.12)) + 30;
  const recentTokens = messages.slice(-keepRecent).reduce((s, m) => s + m.tokens, 0);
  const estimatedAfterTokens = recentTokens + estimatedSummaryTokens;

  const savingsPercent = priorTokens > 0
    ? Math.round((1 - estimatedAfterTokens / priorTokens) * 100)
    : 0;

  return { priorTokens, estimatedAfterTokens, savingsPercent };
}
