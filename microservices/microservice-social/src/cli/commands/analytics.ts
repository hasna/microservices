import { Command } from "commander";
import {
  getEngagementStats,
  getStatsByPlatform,
  getOverallStats,
  getBestTimeToPost,
  getHashtagStats,
} from "../../db/social.js";

export function registerAnalyticsCommands(program: Command): void {
  const analyticsCmd = program
    .command("analytics")
    .description("Engagement analytics");

  analyticsCmd
    .command("engagement")
    .description("View engagement analytics")
    .option("--account <id>", "Filter by account ID")
    .option("--by-platform", "Group by platform")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      if (opts.byPlatform) {
        const stats = getStatsByPlatform();

        if (opts.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          if (stats.length === 0) {
            console.log("No platform data.");
            return;
          }
          for (const s of stats) {
            console.log(`\n${s.platform} (${s.account_count} account(s), ${s.post_count} post(s)):`);
            console.log(`  Published: ${s.engagement.total_posts}`);
            console.log(`  Likes: ${s.engagement.total_likes} (avg ${s.engagement.avg_likes})`);
            console.log(`  Shares: ${s.engagement.total_shares} (avg ${s.engagement.avg_shares})`);
            console.log(`  Comments: ${s.engagement.total_comments} (avg ${s.engagement.avg_comments})`);
            console.log(`  Impressions: ${s.engagement.total_impressions} (avg ${s.engagement.avg_impressions})`);
          }
        }
      } else {
        const stats = getEngagementStats(opts.account);

        if (opts.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log("Engagement Analytics:");
          console.log(`  Published posts: ${stats.total_posts}`);
          console.log(`  Total likes: ${stats.total_likes} (avg ${stats.avg_likes})`);
          console.log(`  Total shares: ${stats.total_shares} (avg ${stats.avg_shares})`);
          console.log(`  Total comments: ${stats.total_comments} (avg ${stats.avg_comments})`);
          console.log(`  Total impressions: ${stats.total_impressions} (avg ${stats.avg_impressions})`);
          console.log(`  Total clicks: ${stats.total_clicks} (avg ${stats.avg_clicks})`);
        }
      }
    });

  analyticsCmd
    .command("best-time")
    .description("Find best time to post based on historical engagement")
    .requiredOption("--account <id>", "Account ID")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const result = getBestTimeToPost(opts.account);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.total_analyzed === 0) {
          console.log("No published posts to analyze.");
          return;
        }
        console.log(`Analyzed ${result.total_analyzed} published post(s)\n`);

        if (result.best_hours.length > 0) {
          console.log("Best hours to post:");
          for (const slot of result.best_hours.slice(0, 5)) {
            console.log(`  ${slot.day_name} ${slot.hour}:00 — avg engagement: ${slot.avg_engagement} (${slot.post_count} posts)`);
          }
        }

        if (result.best_days.length > 0) {
          console.log("\nBest days to post:");
          for (const day of result.best_days) {
            console.log(`  ${day.day_name} — avg engagement: ${day.avg_engagement} (${day.post_count} posts)`);
          }
        }
      }
    });

  analyticsCmd
    .command("hashtags")
    .description("Hashtag performance analytics")
    .requiredOption("--account <id>", "Account ID")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const stats = getHashtagStats(opts.account);

      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        if (stats.length === 0) {
          console.log("No hashtags found in published posts.");
          return;
        }
        console.log("Hashtag Analytics:");
        for (const h of stats) {
          console.log(`  #${h.hashtag} — ${h.post_count} post(s), avg engagement: ${h.avg_engagement}`);
          console.log(`    likes: ${h.total_likes}, shares: ${h.total_shares}, comments: ${h.total_comments}`);
        }
      }
    });

  // Stats command (overall statistics)
  program
    .command("stats")
    .description("Overall statistics")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const stats = getOverallStats();

      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log("Social Media Stats:");
        console.log(`  Accounts: ${stats.total_accounts}`);
        console.log(`  Posts: ${stats.total_posts}`);
        if (Object.keys(stats.posts_by_status).length) {
          for (const [status, count] of Object.entries(stats.posts_by_status)) {
            console.log(`    ${status}: ${count}`);
          }
        }
        console.log(`  Templates: ${stats.total_templates}`);
        console.log(`  Published engagement:`);
        console.log(`    Likes: ${stats.engagement.total_likes}`);
        console.log(`    Shares: ${stats.engagement.total_shares}`);
        console.log(`    Comments: ${stats.engagement.total_comments}`);
        console.log(`    Impressions: ${stats.engagement.total_impressions}`);
      }
    });
}
