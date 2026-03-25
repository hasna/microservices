import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const MentionTypeEnum = z.enum(["mention", "reply", "quote", "dm"]);

export function registerMentionTools(server: McpServer) {
  server.registerTool(
    "list_mentions",
    {
      title: "List Mentions",
      description: "List mentions for an account with optional filters (unread, type, platform).",
      inputSchema: {
        account_id: z.string().optional(),
        unread: z.boolean().optional(),
        type: MentionTypeEnum.optional(),
        platform: z.string().optional(),
        limit: z.number().optional(),
      },
    },
    async ({ account_id, ...filters }) => {
      const { listMentions } = await import("../../lib/mentions.js");
      const mentions = listMentions(account_id, filters);
      return {
        content: [
          { type: "text", text: JSON.stringify({ mentions, count: mentions.length }, null, 2) },
        ],
      };
    }
  );

  server.registerTool(
    "reply_to_mention",
    {
      title: "Reply to Mention",
      description: "Reply to a mention via the platform API (X or Meta).",
      inputSchema: {
        mention_id: z.string(),
        content: z.string(),
      },
    },
    async ({ mention_id, content }) => {
      try {
        const { replyToMention } = await import("../../lib/mentions.js");
        const result = await replyToMention(mention_id, content);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "mark_mention_read",
    {
      title: "Mark Mention Read",
      description: "Mark a single mention as read, or all mentions for an account.",
      inputSchema: {
        mention_id: z.string().optional(),
        account_id: z.string().optional(),
      },
    },
    async ({ mention_id, account_id }) => {
      const { markRead, markAllRead } = await import("../../lib/mentions.js");
      if (account_id) {
        const count = markAllRead(account_id);
        return { content: [{ type: "text", text: JSON.stringify({ account_id, marked_read: count }, null, 2) }] };
      }
      if (mention_id) {
        const mention = markRead(mention_id);
        if (!mention) {
          return { content: [{ type: "text", text: `Mention '${mention_id}' not found.` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(mention, null, 2) }] };
      }
      return { content: [{ type: "text", text: "Provide either mention_id or account_id." }], isError: true };
    }
  );

  server.registerTool(
    "poll_mentions",
    {
      title: "Poll Mentions",
      description: "Start or stop the background mention poller.",
      inputSchema: {
        action: z.enum(["start", "stop", "status"]),
        interval_ms: z.number().optional(),
      },
    },
    async ({ action, interval_ms }) => {
      const { pollMentions, stopPolling, isPolling } = await import("../../lib/mentions.js");
      try {
        if (action === "start") {
          pollMentions(interval_ms || 120000);
          return { content: [{ type: "text", text: JSON.stringify({ status: "started", interval_ms: interval_ms || 120000 }, null, 2) }] };
        } else if (action === "stop") {
          stopPolling();
          return { content: [{ type: "text", text: JSON.stringify({ status: "stopped" }, null, 2) }] };
        } else {
          return { content: [{ type: "text", text: JSON.stringify({ running: isPolling() }, null, 2) }] };
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "mention_stats",
    {
      title: "Mention Stats",
      description: "Get mention statistics for an account (total, unread, by type, by sentiment).",
      inputSchema: {
        account_id: z.string(),
      },
    },
    async ({ account_id }) => {
      const { getMentionStats } = await import("../../lib/mentions.js");
      const stats = getMentionStats(account_id);
      return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
    }
  );
}
