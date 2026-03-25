import { Command } from "commander";
import {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
} from "../../lib/scheduler.js";
import {
  syncAllMetrics,
  syncAccountMetrics,
  startMetricsSync,
  stopMetricsSync,
  getMetricsSyncStatus,
  getSyncReport,
} from "../../lib/metrics-sync.js";
import {
  validateMedia,
  getSupportedFormats,
  uploadMedia,
} from "../../lib/media.js";
import { type Platform } from "../../db/social.js";

export function registerSchedulerCommands(program: Command): void {
  const schedulerCmd = program
    .command("scheduler")
    .description("Scheduled post publishing worker");

  schedulerCmd
    .command("start")
    .description("Start the scheduler to auto-publish due posts")
    .option("--interval <ms>", "Check interval in milliseconds", "60000")
    .action((opts) => {
      try {
        const interval = parseInt(opts.interval);
        startScheduler(interval);
        console.log(`Scheduler started (interval: ${interval}ms)`);
        console.log("Press Ctrl+C to stop.");
        // Keep process alive
        process.on("SIGINT", () => {
          stopScheduler();
          console.log("\nScheduler stopped.");
          process.exit(0);
        });
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  schedulerCmd
    .command("status")
    .description("Show scheduler status")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const status = getSchedulerStatus();

      if (opts.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log("Scheduler Status:");
        console.log(`  Running: ${status.running}`);
        console.log(`  Last check: ${status.lastCheck || "never"}`);
        console.log(`  Posts processed: ${status.postsProcessed}`);
        console.log(`  Errors: ${status.errors}`);
      }
    });

  schedulerCmd
    .command("stop")
    .description("Stop the scheduler")
    .action(() => {
      stopScheduler();
      console.log("Scheduler stopped.");
    });
}

export function registerMediaCommands(program: Command): void {
  const mediaCmd = program
    .command("media")
    .description("Media upload and validation");

  mediaCmd
    .command("upload")
    .description("Upload a media file to a platform")
    .argument("<file>", "Path to media file")
    .requiredOption("--platform <platform>", "Target platform (x/linkedin/instagram/threads/bluesky)")
    .option("--page-id <id>", "Page ID (required for Meta/LinkedIn)")
    .option("--json", "Output as JSON", false)
    .action(async (file, opts) => {
      const platform = opts.platform as Platform;

      // Validate first
      const validation = validateMedia(file, platform);
      if (!validation.valid) {
        console.error("Validation errors:");
        for (const err of validation.errors) {
          console.error(`  - ${err}`);
        }
        process.exit(1);
      }

      try {
        const result = await uploadMedia(file, platform, opts.pageId);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Uploaded successfully. Media ID: ${result.mediaId}`);
          if (result.url) console.log(`  URL: ${result.url}`);
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  mediaCmd
    .command("formats")
    .description("Show supported media formats for a platform")
    .requiredOption("--platform <platform>", "Platform (x/linkedin/instagram/threads/bluesky)")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const platform = opts.platform as Platform;
      const formats = getSupportedFormats(platform);

      if (opts.json) {
        console.log(JSON.stringify({ platform, formats }, null, 2));
      } else {
        console.log(`Supported formats for ${platform}: ${formats.join(", ")}`);
      }
    });

  mediaCmd
    .command("validate")
    .description("Validate a media file for a platform")
    .argument("<file>", "Path to media file")
    .requiredOption("--platform <platform>", "Target platform")
    .option("--json", "Output as JSON", false)
    .action((file, opts) => {
      const platform = opts.platform as Platform;
      const result = validateMedia(file, platform);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.valid) {
          console.log(`File '${file}' is valid for ${platform}.`);
        } else {
          console.error(`File '${file}' is NOT valid for ${platform}:`);
          for (const err of result.errors) {
            console.error(`  - ${err}`);
          }
          process.exit(1);
        }
      }
    });
}

export function registerMetricsCommands(program: Command): void {
  const metricsCmd = program
    .command("metrics")
    .description("Metrics sync — pull engagement data from platform APIs");

  metricsCmd
    .command("sync")
    .description("Sync metrics for recent published posts")
    .option("--watch", "Continuously sync on an interval", false)
    .option("--interval <ms>", "Sync interval in milliseconds (with --watch)", "300000")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      if (opts.watch) {
        const interval = parseInt(opts.interval);
        try {
          startMetricsSync(interval);
          console.log(`Metrics sync started (interval: ${interval}ms)`);
          console.log("Press Ctrl+C to stop.");
          process.on("SIGINT", () => {
            stopMetricsSync();
            const report = getSyncReport();
            console.log(`\nMetrics sync stopped. Posts synced: ${report.posts_synced}, Errors: ${report.errors.length}`);
            process.exit(0);
          });
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      } else {
        try {
          const report = await syncAllMetrics();

          if (opts.json) {
            console.log(JSON.stringify(report, null, 2));
          } else {
            console.log(`Metrics sync complete:`);
            console.log(`  Posts synced: ${report.posts_synced}`);
            console.log(`  Accounts synced: ${report.accounts_synced}`);
            if (report.errors.length > 0) {
              console.log(`  Errors: ${report.errors.length}`);
              for (const err of report.errors) {
                console.log(`    [${err.type}] ${err.id}: ${err.message}`);
              }
            }
          }
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      }
    });

  metricsCmd
    .command("status")
    .description("Show metrics sync status")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const status = getMetricsSyncStatus();

      if (opts.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log("Metrics Sync Status:");
        console.log(`  Running: ${status.running}`);
        console.log(`  Interval: ${status.interval_ms}ms`);
        console.log(`  Last sync: ${status.last_sync || "never"}`);
        console.log(`  Posts synced: ${status.posts_synced}`);
        console.log(`  Accounts synced: ${status.accounts_synced}`);
        console.log(`  Errors: ${status.errors}`);
      }
    });
}
