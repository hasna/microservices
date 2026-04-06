/**
 * Auto-summarization scheduler — microservice-sessions.
 *
 * Monitors sessions approaching their context window limits
 * and automatically schedules summarization. Works with the
 * existing context-summary module.
 *
 * Usage:
 *   await processAutoSummarization(sql, { workspaceId, dryRun: false })
 */

import type { Sql } from "postgres";
import { buildSummaryInput, estimateSummarizationSavings } from "./context-summary.js";
import { getMessages } from "./messages.js";
import { getConversation, updateConversation } from "./conversations.js";
import { storeSessionSummary } from "./session-summaries.js";

export interface AutoSummarizeConfig {
  /** Token threshold to trigger summarization (default 120000) */
  tokenThreshold?: number;
  /** Minimum messages before considering (default 20) */
  minMessages?: number;
  /** Max sessions to process per run (default 50) */
  maxPerRun?: number;
  /** Skip pinned sessions (default true) */
  skipPinned?: boolean;
}

export interface AutoSummarizeResult {
  sessionId: string;
  conversationTitle: string | null;
  tokensBefore: number;
  messagesBefore: number;
  estimatedSavingsTokens: number;
  summaryText: string | null;
  skipped: boolean;
  skipReason: string | null;
}

/**
 * Get sessions that are approaching their context window limit
 * and should be summarized.
 */
export async function getSessionsNeedingSummarization(
  sql: Sql,
  opts: AutoSummarizeConfig = {},
): Promise<{ sessionId: string; conversationTitle: string | null; totalTokens: number; messageCount: number; isPinned: boolean }[]> {
  const {
    tokenThreshold = 120000,
    minMessages = 20,
    maxPerRun = 50,
    skipPinned = true,
  } = opts;

  let query = sql`
    SELECT
      c.id as session_id,
      c.title as conversation_title,
      COALESCE(SUM(m.token_count)::int, 0)::int as total_tokens,
      COUNT(m.id)::int as message_count,
      c.is_pinned
    FROM sessions.conversations c
    LEFT JOIN sessions.messages m ON m.conversation_id = c.id
    WHERE c.is_archived = false
      AND c.is_deleted = false
      AND (${tokenThreshold}) = 120000
    GROUP BY c.id, c.title, c.is_pinned
    HAVING COALESCE(SUM(m.token_count)::int, 0) > ${tokenThreshold}
       AND COUNT(m.id)::int >= ${minMessages}
  `;

  if (skipPinned) {
    query = sql`
      SELECT
        c.id as session_id,
        c.title as conversation_title,
        COALESCE(SUM(m.token_count)::int, 0)::int as total_tokens,
        COUNT(m.id)::int as message_count,
        c.is_pinned
      FROM sessions.conversations c
      LEFT JOIN sessions.messages m ON m.conversation_id = c.id
      WHERE c.is_archived = false
        AND c.is_deleted = false
        AND c.is_pinned = false
      GROUP BY c.id, c.title, c.is_pinned
      HAVING COALESCE(SUM(m.token_count)::int, 0) > ${tokenThreshold}
         AND COUNT(m.id)::int >= ${minMessages}
      LIMIT ${maxPerRun}
    `;
  }

  return await sql<{ session_id: string; conversation_title: string | null; total_tokens: number; message_count: number; is_pinned: boolean }>(query);
}

/**
 * Process sessions needing auto-summarization.
 * Returns array of results.
 */
export async function processAutoSummarization(
  sql: Sql,
  opts: AutoSummarizeConfig & { workspaceId?: string; dryRun?: boolean } = {},
): Promise<AutoSummarizeResult[]> {
  const sessions = await getSessionsNeedingSummarization(sql, opts);
  const results: AutoSummarizeResult[] = [];

  for (const s of sessions) {
    try {
      const messages = await getMessages(sql, s.session_id, { limit: 10000, offset: 0 });
      const tokensByMsg = messages.map((m: any) => ({ role: m.role, content: m.content ?? "", name: m.name ?? null, tokens: m.token_count ?? 0 }));

      const { priorText, priorTokens, recentCount } = buildSummaryInput(tokensByMsg, 10);
      if (!priorText) {
        results.push({ sessionId: s.session_id, conversationTitle: s.conversation_title, tokensBefore: s.total_tokens, messagesBefore: s.message_count, estimatedSavingsTokens: 0, summaryText: null, skipped: true, skipReason: "Not enough old messages to summarize" });
        continue;
      }

      const savings = estimateSummarizationSavings(priorTokens, 10);

      if (opts.dryRun) {
        results.push({ sessionId: s.session_id, conversationTitle: s.conversation_title, tokensBefore: s.total_tokens, messagesBefore: s.message_count, estimatedSavingsTokens: savings, summaryText: null, skipped: false, skipReason: null });
        continue;
      }

      // Store a placeholder summary record (actual LLM summarization is external)
      const summaryText = `[Auto-summarized ${priorTokens} tokens from ${messages.length - recentCount} messages — ${new Date().toISOString()}]`;
      await storeSessionSummary(sql, s.session_id, summaryText, { priorTokens, priorMessages: messages.length - recentCount });

      results.push({ sessionId: s.session_id, conversationTitle: s.conversation_title, tokensBefore: s.total_tokens, messagesBefore: s.message_count, estimatedSavingsTokens: savings, summaryText, skipped: false, skipReason: null });
    } catch (err) {
      results.push({ sessionId: s.session_id, conversationTitle: s.conversation_title, tokensBefore: s.total_tokens, messagesBefore: s.message_count, estimatedSavingsTokens: 0, summaryText: null, skipped: true, skipReason: String(err) });
    }
  }

  return results;
}

/**
 * Get context window fill ratio for a session.
 */
export async function getContextWindowFill(
  sql: Sql,
  sessionId: string,
  maxTokens = 128000,
): Promise<{ sessionId: string; usedTokens: number; maxTokens: number; fillPercent: number; messageCount: number }> {
  const messages = await getMessages(sql, sessionId, { limit: 10000 });
  const usedTokens = messages.reduce((sum: number, m: any) => sum + (m.token_count ?? 0), 0);
  return {
    sessionId,
    usedTokens,
    maxTokens,
    fillPercent: Math.round((usedTokens / maxTokens) * 100 * 100) / 100,
    messageCount: messages.length,
  };
}