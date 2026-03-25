import { Command } from "commander";
import {
  listMentions,
  getMention,
  markRead,
  markAllRead,
  getMentionStats,
  replyToMention,
  pollMentions,
  stopPolling,
  type MentionType,
} from "../../lib/mentions.js";

export function registerMentionCommands(program: Command): void {
  const mentionsCmd = program
    .command("mentions")
    .description("Mention monitoring");

  mentionsCmd
    .command("list")
    .description("List mentions")
    .option("--account <id>", "Filter by account ID")
    .option("--unread", "Show only unread mentions", false)
    .option("--type <type>", "Filter by type (mention/reply/quote/dm)")
    .option("--limit <n>", "Limit results")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const mentions = listMentions(opts.account, {
        unread: opts.unread ? true : undefined,
        type: opts.type as MentionType | undefined,
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });

      if (opts.json) {
        console.log(JSON.stringify(mentions, null, 2));
      } else {
        if (mentions.length === 0) {
          console.log("No mentions found.");
          return;
        }
        for (const m of mentions) {
          const readFlag = m.read ? " " : "*";
          const preview = m.content ? m.content.substring(0, 60) + (m.content.length > 60 ? "..." : "") : "(no content)";
          const author = m.author_handle ? `@${m.author_handle}` : m.author || "unknown";
          console.log(`  ${readFlag} [${m.type || "?"}] ${author}: ${preview}`);
        }
        console.log(`\n${mentions.length} mention(s)`);
      }
    });

  mentionsCmd
    .command("reply")
    .description("Reply to a mention")
    .argument("<id>", "Mention ID")
    .requiredOption("--content <text>", "Reply content")
    .option("--json", "Output as JSON", false)
    .action(async (id, opts) => {
      try {
        const result = await replyToMention(id, opts.content);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Reply sent. Platform reply ID: ${result.platformReplyId}`);
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  mentionsCmd
    .command("read")
    .description("Mark a mention as read")
    .argument("<id>", "Mention ID")
    .option("--json", "Output as JSON", false)
    .action((id, opts) => {
      const mention = markRead(id);
      if (!mention) {
        console.error(`Mention '${id}' not found.`);
        process.exit(1);
      }
      if (opts.json) {
        console.log(JSON.stringify(mention, null, 2));
      } else {
        console.log(`Marked mention ${id} as read.`);
      }
    });

  mentionsCmd
    .command("read-all")
    .description("Mark all mentions for an account as read")
    .argument("<account-id>", "Account ID")
    .action((accountId) => {
      const count = markAllRead(accountId);
      console.log(`Marked ${count} mention(s) as read.`);
    });

  mentionsCmd
    .command("watch")
    .description("Start polling for new mentions")
    .option("--interval <ms>", "Poll interval in milliseconds", "120000")
    .action((opts) => {
      const interval = parseInt(opts.interval);
      pollMentions(interval);
      console.log(`Mention poller started (interval: ${interval}ms)`);
      console.log("Press Ctrl+C to stop.");
      process.on("SIGINT", () => {
        stopPolling();
        console.log("\nMention poller stopped.");
        process.exit(0);
      });
    });

  mentionsCmd
    .command("stats")
    .description("Get mention statistics for an account")
    .argument("<account-id>", "Account ID")
    .option("--json", "Output as JSON", false)
    .action((accountId, opts) => {
      const stats = getMentionStats(accountId);
      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log("Mention Stats:");
        console.log(`  Total: ${stats.total}`);
        console.log(`  Unread: ${stats.unread}`);
        if (Object.keys(stats.by_type).length) {
          console.log("  By type:");
          for (const [type, count] of Object.entries(stats.by_type)) {
            console.log(`    ${type}: ${count}`);
          }
        }
        if (Object.keys(stats.by_sentiment).length) {
          console.log("  By sentiment:");
          for (const [sentiment, count] of Object.entries(stats.by_sentiment)) {
            console.log(`    ${sentiment}: ${count}`);
          }
        }
      }
    });
}
