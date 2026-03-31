/**
 * Conversation export — markdown and JSON formats.
 */

import type { Sql } from "postgres";
import { getConversation } from "./conversations.js";
import { getMessages } from "./messages.js";

const ROLE_LABELS: Record<string, string> = {
  system: "System",
  user: "User",
  assistant: "Assistant",
  tool: "Tool",
};

export async function exportConversation(
  sql: Sql,
  conversationId: string,
  format: "markdown" | "json"
): Promise<string> {
  const conv = await getConversation(sql, conversationId);
  if (!conv) throw new Error(`Conversation ${conversationId} not found`);

  const messages = await getMessages(sql, conversationId, { limit: 10000 });

  if (format === "json") {
    return JSON.stringify(messages, null, 2);
  }

  // markdown format
  const lines: string[] = [];
  lines.push(`# ${conv.title ?? "Untitled Conversation"}`);
  lines.push("");

  for (const msg of messages) {
    const label = ROLE_LABELS[msg.role] ?? msg.role;
    lines.push(`**${label}**: ${msg.content}`);
    lines.push("");
  }

  return lines.join("\n");
}
