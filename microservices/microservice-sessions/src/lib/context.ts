/**
 * Context window management — fit messages within a token budget.
 */

import type { Sql } from "postgres";
import type { Message } from "./messages.js";

export interface ContextWindow {
  messages: Message[];
  total_tokens: number;
  truncated: boolean;
  included_count: number;
  total_count: number;
}

/**
 * Returns messages that fit within the token budget, starting from most recent.
 * If total exceeds maxTokens, truncates from the beginning but always keeps the system prompt message.
 */
export async function getContextWindow(
  sql: Sql,
  conversationId: string,
  maxTokens: number,
): Promise<ContextWindow> {
  // Get all messages ordered by creation time
  const allMessages = await sql<Message[]>`
    SELECT * FROM sessions.messages
    WHERE conversation_id = ${conversationId}
    ORDER BY created_at ASC
  `;

  const totalCount = allMessages.length;

  if (maxTokens <= 0 || totalCount === 0) {
    return {
      messages: [],
      total_tokens: 0,
      truncated: totalCount > 0,
      included_count: 0,
      total_count: totalCount,
    };
  }

  // Separate system prompt from other messages
  const systemMessages = allMessages.filter((m) => m.role === "system");
  const nonSystemMessages = allMessages.filter((m) => m.role !== "system");

  // Calculate system prompt token cost
  let systemTokens = 0;
  for (const m of systemMessages) {
    systemTokens += m.tokens > 0 ? m.tokens : estimateTokens(m.content);
  }

  // If system tokens alone exceed the budget, still include system messages
  const remainingBudget = Math.max(0, maxTokens - systemTokens);

  // Start from the most recent non-system messages and work backwards
  const included: Message[] = [];
  let usedTokens = 0;

  for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
    const msg = nonSystemMessages[i];
    const msgTokens = msg.tokens > 0 ? msg.tokens : estimateTokens(msg.content);

    if (usedTokens + msgTokens <= remainingBudget) {
      included.unshift(msg);
      usedTokens += msgTokens;
    } else {
      break;
    }
  }

  // Combine system messages first, then included messages
  const result = [...systemMessages, ...included];
  const totalTokens = systemTokens + usedTokens;
  const truncated = result.length < totalCount;

  return {
    messages: result,
    total_tokens: totalTokens,
    truncated,
    included_count: result.length,
    total_count: totalCount,
  };
}

/**
 * Rough token estimate: chars / 4.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
