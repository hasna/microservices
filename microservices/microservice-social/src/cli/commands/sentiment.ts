import { Command } from "commander";
import {
  analyzeSentiment,
  getSentimentReport,
  autoAnalyzeMention,
} from "../../lib/sentiment.js";

export function registerSentimentCommands(program: Command): void {
  const sentimentCmd = program
    .command("sentiment")
    .description("Sentiment analysis for mentions");

  sentimentCmd
    .command("analyze")
    .description("Analyze sentiment of a text")
    .requiredOption("--text <text>", "Text to analyze")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      try {
        const result = await analyzeSentiment(opts.text);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Sentiment: ${result.sentiment}`);
          console.log(`Score: ${result.score}`);
          if (result.keywords.length) {
            console.log(`Keywords: ${result.keywords.join(", ")}`);
          }
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  sentimentCmd
    .command("report")
    .description("Get sentiment report for an account")
    .argument("<account-id>", "Account ID")
    .option("--days <n>", "Number of days to analyze", "30")
    .option("--json", "Output as JSON", false)
    .action((accountId, opts) => {
      const days = parseInt(opts.days);
      const report = getSentimentReport(accountId, days);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        if (report.total_analyzed === 0) {
          console.log("No analyzed mentions found.");
          return;
        }
        console.log(`Sentiment Report (last ${days} days):`);
        console.log(`  Total analyzed: ${report.total_analyzed}`);
        console.log(`  Positive: ${report.positive_pct}%`);
        console.log(`  Neutral: ${report.neutral_pct}%`);
        console.log(`  Negative: ${report.negative_pct}%`);
        if (report.trending_keywords.length) {
          console.log(`  Trending keywords: ${report.trending_keywords.join(", ")}`);
        }
        if (report.most_positive) {
          const preview = report.most_positive.content.substring(0, 60);
          console.log(`  Most positive: ${preview}${report.most_positive.content.length > 60 ? "..." : ""}`);
        }
        if (report.most_negative) {
          const preview = report.most_negative.content.substring(0, 60);
          console.log(`  Most negative: ${preview}${report.most_negative.content.length > 60 ? "..." : ""}`);
        }
      }
    });

  sentimentCmd
    .command("auto")
    .description("Auto-analyze sentiment for a mention")
    .argument("<mention-id>", "Mention ID")
    .option("--json", "Output as JSON", false)
    .action(async (mentionId, opts) => {
      try {
        const result = await autoAnalyzeMention(mentionId);
        if (!result) {
          console.error("Analysis returned no result.");
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Analyzed mention ${mentionId}:`);
          console.log(`  Sentiment: ${result.sentiment}`);
          console.log(`  Score: ${result.score}`);
          if (result.keywords.length) {
            console.log(`  Keywords: ${result.keywords.join(", ")}`);
          }
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
