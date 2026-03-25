import { Command } from "commander";
import {
  syncFollowers,
  getAudienceInsights,
  getFollowerGrowthChart,
  getTopFollowers,
} from "../../lib/audience.js";

export function registerAudienceCommands(program: Command): void {
  const audienceCmd = program
    .command("audience")
    .description("Follower sync and audience insights");

  audienceCmd
    .command("sync")
    .description("Sync followers from the platform API")
    .argument("<account-id>", "Account ID")
    .option("--json", "Output as JSON", false)
    .action((accountId, opts) => {
      const result = syncFollowers(accountId);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Follower sync complete:`);
        console.log(`  Synced: ${result.synced}`);
        console.log(`  New: ${result.new_followers}`);
        console.log(`  Unfollowed: ${result.unfollowed}`);
        if (result.message) console.log(`  Note: ${result.message}`);
      }
    });

  audienceCmd
    .command("insights")
    .description("Get audience insights for an account")
    .argument("<account-id>", "Account ID")
    .option("--json", "Output as JSON", false)
    .action((accountId, opts) => {
      const insights = getAudienceInsights(accountId);

      if (opts.json) {
        console.log(JSON.stringify(insights, null, 2));
      } else {
        console.log("Audience Insights:");
        console.log(`  Total followers: ${insights.total_followers}`);
        console.log(`  Growth (7d): ${insights.growth_rate_7d}%`);
        console.log(`  Growth (30d): ${insights.growth_rate_30d}%`);
        console.log(`  New followers (7d): ${insights.new_followers_7d}`);
        console.log(`  Lost followers (7d): ${insights.lost_followers_7d}`);
        if (insights.top_followers.length > 0) {
          console.log("  Top followers:");
          for (const f of insights.top_followers.slice(0, 5)) {
            console.log(`    @${f.username || "?"} — ${f.follower_count} followers`);
          }
        }
      }
    });

  audienceCmd
    .command("growth")
    .description("Show follower growth chart data")
    .argument("<account-id>", "Account ID")
    .option("--days <n>", "Number of days", "30")
    .option("--json", "Output as JSON", false)
    .action((accountId, opts) => {
      const days = parseInt(opts.days);
      const chart = getFollowerGrowthChart(accountId, days);

      if (opts.json) {
        console.log(JSON.stringify(chart, null, 2));
      } else {
        if (chart.length === 0) {
          console.log("No snapshot data available.");
          return;
        }
        console.log(`Follower Growth (last ${days} days):`);
        for (const point of chart) {
          console.log(`  ${point.date}: ${point.count}`);
        }
      }
    });

  audienceCmd
    .command("top")
    .description("Show top followers by their follower count")
    .argument("<account-id>", "Account ID")
    .option("--limit <n>", "Number of results", "10")
    .option("--json", "Output as JSON", false)
    .action((accountId, opts) => {
      const limit = parseInt(opts.limit);
      const followers = getTopFollowers(accountId, limit);

      if (opts.json) {
        console.log(JSON.stringify(followers, null, 2));
      } else {
        if (followers.length === 0) {
          console.log("No followers found.");
          return;
        }
        console.log("Top Followers:");
        for (const f of followers) {
          const name = f.display_name ? ` (${f.display_name})` : "";
          console.log(`  @${f.username || "?"}${name} — ${f.follower_count} followers`);
        }
      }
    });
}
