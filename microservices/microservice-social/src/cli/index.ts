#!/usr/bin/env bun

import { Command } from "commander";
import { readFileSync } from "node:fs";
import {
  createAccount,
  getAccount,
  listAccounts,
  updateAccount,
  deleteAccount,
  createPost,
  getPost,
  listPosts,
  updatePost,
  deletePost,
  schedulePost,
  publishPost,
  createTemplate,
  listTemplates,
  getTemplate,
  deleteTemplate,
  useTemplate,
  getEngagementStats,
  getStatsByPlatform,
  getCalendar,
  getOverallStats,
  batchSchedule,
  crossPost,
  getBestTimeToPost,
  reschedulePost,
  submitPostForReview,
  approvePost,
  createRecurringPost,
  getHashtagStats,
  checkPlatformLimit,
  PLATFORM_LIMITS,
  type Platform,
  type PostStatus,
  type Recurrence,
} from "../db/social.js";
import {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
} from "../lib/scheduler.js";
import {
  syncAllMetrics,
  syncAccountMetrics,
  startMetricsSync,
  stopMetricsSync,
  getMetricsSyncStatus,
  getSyncReport,
} from "../lib/metrics-sync.js";
import {
  validateMedia,
  getSupportedFormats,
  uploadMedia,
} from "../lib/media.js";
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
} from "../lib/mentions.js";
import {
  createThread,
  getThread,
  publishThread,
  deleteThread,
  createCarousel,
} from "../lib/threads.js";
import {
  generatePost as aiGeneratePost,
  suggestHashtags as aiSuggestHashtags,
  optimizePost as aiOptimizePost,
  generateThread as aiGenerateThread,
  repurposePost as aiRepurposePost,
  type Tone,
} from "../lib/content-ai.js";
import {
  syncFollowers,
  getAudienceInsights,
  getFollowerGrowthChart,
  getTopFollowers,
} from "../lib/audience.js";
import {
  analyzeSentiment,
  getSentimentReport,
  autoAnalyzeMention,
} from "../lib/sentiment.js";

const program = new Command();

program
  .name("microservice-social")
  .description("Social media management microservice")
  .version("0.0.1");

// --- Posts ---

const postCmd = program
  .command("post")
  .description("Post management");

postCmd
  .command("create")
  .description("Create a new post")
  .requiredOption("--account <id>", "Account ID")
  .requiredOption("--content <text>", "Post content")
  .option("--media <urls>", "Comma-separated media URLs")
  .option("--status <status>", "Post status (draft/scheduled/published/failed)", "draft")
  .option("--scheduled-at <datetime>", "Schedule date/time")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--recurring <recurrence>", "Recurrence (daily/weekly/biweekly/monthly)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    // Check platform character limit
    const warning = checkPlatformLimit(opts.content, opts.account);
    if (warning) {
      console.warn(`Warning: Content (${warning.content_length} chars) exceeds ${warning.platform} limit (${warning.limit} chars) by ${warning.over_by} chars`);
    }

    const post = createPost({
      account_id: opts.account,
      content: opts.content,
      media_urls: opts.media ? opts.media.split(",").map((u: string) => u.trim()) : undefined,
      status: opts.status as PostStatus,
      scheduled_at: opts.scheduledAt,
      tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
      recurrence: opts.recurring as Recurrence | undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(post, null, 2));
    } else {
      console.log(`Created post: ${post.id} [${post.status}]`);
      console.log(`  Content: ${post.content.substring(0, 80)}${post.content.length > 80 ? "..." : ""}`);
    }
  });

postCmd
  .command("list")
  .description("List posts")
  .option("--account <id>", "Filter by account ID")
  .option("--status <status>", "Filter by status")
  .option("--tag <tag>", "Filter by tag")
  .option("--search <query>", "Search post content")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const posts = listPosts({
      account_id: opts.account,
      status: opts.status as PostStatus | undefined,
      tag: opts.tag,
      search: opts.search,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(posts, null, 2));
    } else {
      if (posts.length === 0) {
        console.log("No posts found.");
        return;
      }
      for (const p of posts) {
        const preview = p.content.substring(0, 60) + (p.content.length > 60 ? "..." : "");
        const tags = p.tags.length ? ` [${p.tags.join(", ")}]` : "";
        console.log(`  [${p.status}] ${preview}${tags}`);
      }
      console.log(`\n${posts.length} post(s)`);
    }
  });

postCmd
  .command("get")
  .description("Get a post by ID")
  .argument("<id>", "Post ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const post = getPost(id);
    if (!post) {
      console.error(`Post '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(post, null, 2));
    } else {
      console.log(`Post ${post.id} [${post.status}]`);
      console.log(`  Content: ${post.content}`);
      console.log(`  Account: ${post.account_id}`);
      if (post.scheduled_at) console.log(`  Scheduled: ${post.scheduled_at}`);
      if (post.published_at) console.log(`  Published: ${post.published_at}`);
      if (post.tags.length) console.log(`  Tags: ${post.tags.join(", ")}`);
      if (Object.keys(post.engagement).length) {
        console.log(`  Engagement: ${JSON.stringify(post.engagement)}`);
      }
    }
  });

postCmd
  .command("schedule")
  .description("Schedule a post")
  .argument("<id>", "Post ID")
  .requiredOption("--at <datetime>", "Schedule date/time")
  .option("--recurring <recurrence>", "Recurrence (daily/weekly/biweekly/monthly)")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    if (opts.recurring) {
      const post = getPost(id);
      if (!post) {
        console.error(`Post '${id}' not found.`);
        process.exit(1);
      }
      updatePost(id, { recurrence: opts.recurring as Recurrence });
    }

    const post = schedulePost(id, opts.at);
    if (!post) {
      console.error(`Post '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(post, null, 2));
    } else {
      console.log(`Scheduled post ${post.id} for ${post.scheduled_at}${post.recurrence ? ` (recurring: ${post.recurrence})` : ""}`);
    }
  });

postCmd
  .command("publish")
  .description("Publish a post — sends to the platform API if --live, otherwise marks as published locally")
  .argument("<id>", "Post ID")
  .option("--platform-id <id>", "Platform post ID (for manual/local publish)")
  .option("--live", "Publish via platform API (X, Meta)", false)
  .option("--json", "Output as JSON", false)
  .action(async (id, opts) => {
    try {
      let post;
      if (opts.live) {
        const { publishToApi } = await import("../lib/publisher.js");
        post = await publishToApi(id);
      } else {
        post = publishPost(id, opts.platformId);
      }

      if (!post) {
        console.error(`Post '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(post, null, 2));
      } else {
        console.log(`Published post ${post.id} at ${post.published_at}${post.platform_post_id ? ` (platform ID: ${post.platform_post_id})` : ""}`);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

postCmd
  .command("schedule-batch")
  .description("Schedule multiple posts from a JSON file")
  .requiredOption("--file <path>", "Path to JSON file with post array")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    let postsData;
    try {
      postsData = JSON.parse(readFileSync(opts.file, "utf-8"));
    } catch (err) {
      console.error(`Failed to read file: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    if (!Array.isArray(postsData)) {
      console.error("File must contain a JSON array of posts.");
      process.exit(1);
    }

    const result = batchSchedule(postsData);

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Scheduled ${result.scheduled.length} post(s)`);
      if (result.errors.length > 0) {
        console.log(`Errors: ${result.errors.length}`);
        for (const err of result.errors) {
          console.log(`  [${err.index}] ${err.error}`);
        }
      }
      if (result.warnings.length > 0) {
        console.log("Warnings:");
        for (const w of result.warnings) {
          console.log(`  ${w.platform}: content (${w.content_length}) exceeds limit (${w.limit}) by ${w.over_by} chars`);
        }
      }
    }
  });

postCmd
  .command("crosspost")
  .description("Create identical post on multiple platforms")
  .requiredOption("--content <text>", "Post content")
  .requiredOption("--platforms <list>", "Comma-separated platforms (x,linkedin,bluesky,...)")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--scheduled-at <datetime>", "Schedule date/time")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const platforms = opts.platforms.split(",").map((p: string) => p.trim()) as Platform[];

    try {
      const result = crossPost(opts.content, platforms, {
        tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
        scheduled_at: opts.scheduledAt,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Cross-posted to ${result.posts.length} platform(s):`);
        for (const post of result.posts) {
          const account = getAccount(post.account_id);
          console.log(`  ${account?.platform || "?"} → ${post.id} [${post.status}]`);
        }
        if (result.warnings.length > 0) {
          console.log("Warnings:");
          for (const w of result.warnings) {
            console.log(`  ${w.platform}: content (${w.content_length}) exceeds limit (${w.limit}) by ${w.over_by} chars`);
          }
        }
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

postCmd
  .command("reschedule")
  .description("Reschedule a post to a new date/time")
  .argument("<id>", "Post ID")
  .requiredOption("--to <datetime>", "New schedule date/time")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    try {
      const post = reschedulePost(id, opts.to);
      if (!post) {
        console.error(`Post '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(post, null, 2));
      } else {
        console.log(`Rescheduled post ${post.id} to ${post.scheduled_at}`);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

postCmd
  .command("submit")
  .description("Submit a draft post for review")
  .argument("<id>", "Post ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    try {
      const post = submitPostForReview(id);
      if (!post) {
        console.error(`Post '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(post, null, 2));
      } else {
        console.log(`Post ${post.id} submitted for review [${post.status}]`);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

postCmd
  .command("approve")
  .description("Approve a post pending review")
  .argument("<id>", "Post ID")
  .option("--at <datetime>", "Schedule date/time for approved post")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    try {
      const post = approvePost(id, opts.at);
      if (!post) {
        console.error(`Post '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(post, null, 2));
      } else {
        console.log(`Post ${post.id} approved and scheduled for ${post.scheduled_at}`);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

postCmd
  .command("delete")
  .description("Delete a post")
  .argument("<id>", "Post ID")
  .action((id) => {
    const deleted = deletePost(id);
    if (deleted) {
      console.log(`Deleted post ${id}`);
    } else {
      console.error(`Post '${id}' not found.`);
      process.exit(1);
    }
  });

postCmd
  .command("create-thread")
  .description("Create a thread of multiple posts")
  .requiredOption("--content <texts...>", "Content for each post in the thread")
  .requiredOption("--account <id>", "Account ID")
  .option("--schedule <datetime>", "Schedule date/time")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    try {
      const result = createThread(opts.content, opts.account, {
        scheduledAt: opts.schedule,
        tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Created thread ${result.threadId} with ${result.posts.length} post(s)`);
        for (const post of result.posts) {
          const preview = post.content.substring(0, 60) + (post.content.length > 60 ? "..." : "");
          console.log(`  [${post.thread_position}] ${preview}`);
        }
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

postCmd
  .command("get-thread")
  .description("Get all posts in a thread")
  .argument("<thread-id>", "Thread ID")
  .option("--json", "Output as JSON", false)
  .action((threadId, opts) => {
    try {
      const posts = getThread(threadId);

      if (opts.json) {
        console.log(JSON.stringify({ threadId, posts, count: posts.length }, null, 2));
      } else {
        console.log(`Thread ${threadId} (${posts.length} post(s)):`);
        for (const post of posts) {
          const preview = post.content.substring(0, 60) + (post.content.length > 60 ? "..." : "");
          console.log(`  [${post.thread_position}] [${post.status}] ${preview}`);
        }
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

postCmd
  .command("publish-thread")
  .description("Publish a thread to the platform API")
  .argument("<thread-id>", "Thread ID")
  .option("--live", "Publish via platform API", false)
  .option("--json", "Output as JSON", false)
  .action(async (threadId, opts) => {
    try {
      if (opts.live) {
        const result = await publishThread(threadId);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Published thread ${result.threadId} (${result.posts.length} post(s))`);
          for (const post of result.posts) {
            console.log(`  [${post.thread_position}] platform ID: ${post.platform_post_id}`);
          }
        }
      } else {
        // Local publish — mark all posts as published
        const posts = getThread(threadId);
        for (const post of posts) {
          publishPost(post.id);
        }
        if (opts.json) {
          const updated = getThread(threadId);
          console.log(JSON.stringify({ threadId, posts: updated }, null, 2));
        } else {
          console.log(`Locally published thread ${threadId} (${posts.length} post(s))`);
        }
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

postCmd
  .command("create-carousel")
  .description("Create a carousel post with multiple images")
  .requiredOption("--images <urls>", "Comma-separated image URLs")
  .requiredOption("--account <id>", "Account ID")
  .option("--captions <texts>", "Comma-separated captions")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    try {
      const images = opts.images.split(",").map((u: string) => u.trim());
      const captions = opts.captions ? opts.captions.split(",").map((c: string) => c.trim()) : [];
      const post = createCarousel(images, captions, opts.account);

      if (opts.json) {
        console.log(JSON.stringify(post, null, 2));
      } else {
        console.log(`Created carousel post: ${post.id}`);
        console.log(`  Images: ${post.media_urls.length}`);
        if (post.content) console.log(`  Content: ${post.content.substring(0, 80)}${post.content.length > 80 ? "..." : ""}`);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// --- Accounts ---

const accountCmd = program
  .command("account")
  .description("Account management");

accountCmd
  .command("add")
  .description("Add a social media account")
  .requiredOption("--platform <platform>", "Platform (x/linkedin/instagram/threads/bluesky)")
  .requiredOption("--handle <handle>", "Account handle")
  .option("--display-name <name>", "Display name")
  .option("--connected", "Mark as connected", false)
  .option("--token-env <var>", "Environment variable for access token")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const account = createAccount({
      platform: opts.platform as Platform,
      handle: opts.handle,
      display_name: opts.displayName,
      connected: opts.connected,
      access_token_env: opts.tokenEnv,
    });

    if (opts.json) {
      console.log(JSON.stringify(account, null, 2));
    } else {
      console.log(`Added account: @${account.handle} on ${account.platform} (${account.id})`);
    }
  });

accountCmd
  .command("list")
  .description("List accounts")
  .option("--platform <platform>", "Filter by platform")
  .option("--connected", "Show only connected accounts")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const accounts = listAccounts({
      platform: opts.platform as Platform | undefined,
      connected: opts.connected ? true : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(accounts, null, 2));
    } else {
      if (accounts.length === 0) {
        console.log("No accounts found.");
        return;
      }
      for (const a of accounts) {
        const connected = a.connected ? " (connected)" : "";
        const name = a.display_name ? ` - ${a.display_name}` : "";
        console.log(`  [${a.platform}] @${a.handle}${name}${connected}`);
      }
      console.log(`\n${accounts.length} account(s)`);
    }
  });

accountCmd
  .command("remove")
  .description("Remove an account")
  .argument("<id>", "Account ID")
  .action((id) => {
    const deleted = deleteAccount(id);
    if (deleted) {
      console.log(`Removed account ${id}`);
    } else {
      console.error(`Account '${id}' not found.`);
      process.exit(1);
    }
  });

// --- Calendar ---

program
  .command("calendar")
  .description("View scheduled posts by date")
  .option("--start <date>", "Start date (YYYY-MM-DD)")
  .option("--end <date>", "End date (YYYY-MM-DD)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const calendar = getCalendar(opts.start, opts.end);

    if (opts.json) {
      console.log(JSON.stringify(calendar, null, 2));
    } else {
      const dates = Object.keys(calendar).sort();
      if (dates.length === 0) {
        console.log("No scheduled posts.");
        return;
      }
      for (const date of dates) {
        console.log(`\n${date}:`);
        for (const post of calendar[date]) {
          const preview = post.content.substring(0, 50) + (post.content.length > 50 ? "..." : "");
          console.log(`  ${post.scheduled_at} — ${preview}`);
        }
      }
    }
  });

// --- Analytics ---

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

// --- Templates ---

const templateCmd = program
  .command("template")
  .description("Post template management");

templateCmd
  .command("create")
  .description("Create a post template")
  .requiredOption("--name <name>", "Template name")
  .requiredOption("--content <content>", "Template content (use {{var}} for variables)")
  .option("--variables <vars>", "Comma-separated variable names")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const template = createTemplate({
      name: opts.name,
      content: opts.content,
      variables: opts.variables ? opts.variables.split(",").map((v: string) => v.trim()) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(template, null, 2));
    } else {
      console.log(`Created template: ${template.name} (${template.id})`);
    }
  });

templateCmd
  .command("list")
  .description("List templates")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const templates = listTemplates();

    if (opts.json) {
      console.log(JSON.stringify(templates, null, 2));
    } else {
      if (templates.length === 0) {
        console.log("No templates found.");
        return;
      }
      for (const t of templates) {
        const vars = t.variables.length ? ` (vars: ${t.variables.join(", ")})` : "";
        console.log(`  ${t.name}${vars}`);
      }
      console.log(`\n${templates.length} template(s)`);
    }
  });

templateCmd
  .command("use")
  .description("Create a post from a template")
  .argument("<template-id>", "Template ID")
  .requiredOption("--account <id>", "Account ID")
  .option("--values <json>", "JSON object of variable values")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output as JSON", false)
  .action((templateId, opts) => {
    const values = opts.values ? JSON.parse(opts.values) : {};
    const tags = opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined;

    const post = useTemplate(templateId, opts.account, values, tags);

    if (opts.json) {
      console.log(JSON.stringify(post, null, 2));
    } else {
      console.log(`Created post from template: ${post.id}`);
      console.log(`  Content: ${post.content.substring(0, 80)}${post.content.length > 80 ? "..." : ""}`);
    }
  });

templateCmd
  .command("delete")
  .description("Delete a template")
  .argument("<id>", "Template ID")
  .action((id) => {
    const deleted = deleteTemplate(id);
    if (deleted) {
      console.log(`Deleted template ${id}`);
    } else {
      console.error(`Template '${id}' not found.`);
      process.exit(1);
    }
  });

// --- Stats ---

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

// --- Scheduler ---

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

// --- Media ---

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

// --- Metrics Sync ---

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

// --- Mentions ---

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

// --- AI Content Generation ---

const aiCmd = program
  .command("ai")
  .description("AI-powered content generation");

aiCmd
  .command("generate")
  .description("Generate a post using AI")
  .requiredOption("--topic <topic>", "Topic to write about")
  .requiredOption("--platform <platform>", "Target platform (x/linkedin/instagram/threads/bluesky)")
  .option("--tone <tone>", "Tone: professional, casual, witty", "professional")
  .option("--no-hashtags", "Disable hashtags")
  .option("--emoji", "Include emojis", false)
  .option("--language <lang>", "Language", "English")
  .option("--json", "Output as JSON", false)
  .action(async (opts) => {
    try {
      const result = await aiGeneratePost(opts.topic, opts.platform as Platform, {
        tone: opts.tone as Tone,
        includeHashtags: opts.hashtags,
        includeEmoji: opts.emoji,
        language: opts.language,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log("Generated Post:");
        console.log(`  ${result.content}`);
        if (result.hashtags.length) {
          console.log(`  Hashtags: ${result.hashtags.map((h: string) => "#" + h).join(" ")}`);
        }
        if (result.suggested_media_prompt) {
          console.log(`  Media prompt: ${result.suggested_media_prompt}`);
        }
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

aiCmd
  .command("suggest-hashtags")
  .description("Suggest hashtags for content")
  .requiredOption("--content <text>", "Post content to analyze")
  .requiredOption("--platform <platform>", "Target platform")
  .option("--count <n>", "Number of hashtags", "5")
  .option("--json", "Output as JSON", false)
  .action(async (opts) => {
    try {
      const hashtags = await aiSuggestHashtags(opts.content, opts.platform as Platform, parseInt(opts.count));

      if (opts.json) {
        console.log(JSON.stringify({ hashtags }, null, 2));
      } else {
        console.log("Suggested Hashtags:");
        for (const h of hashtags) {
          console.log(`  #${h}`);
        }
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

aiCmd
  .command("optimize")
  .description("Optimize a post for better engagement")
  .argument("<post-id>", "Post ID to optimize")
  .option("--json", "Output as JSON", false)
  .action(async (postId, opts) => {
    try {
      const post = getPost(postId);
      if (!post) {
        console.error(`Post '${postId}' not found.`);
        process.exit(1);
      }

      const account = getAccount(post.account_id);
      if (!account) {
        console.error(`Account '${post.account_id}' not found.`);
        process.exit(1);
      }

      const result = await aiOptimizePost(post.content, account.platform);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log("Optimized Post:");
        console.log(`  ${result.optimized_content}`);
        if (result.improvements.length) {
          console.log("\nImprovements:");
          for (const imp of result.improvements) {
            console.log(`  - ${imp}`);
          }
        }
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

aiCmd
  .command("generate-thread")
  .description("Generate a multi-tweet thread using AI")
  .requiredOption("--topic <topic>", "Topic to write about")
  .option("--tweets <n>", "Number of tweets in thread", "5")
  .option("--json", "Output as JSON", false)
  .action(async (opts) => {
    try {
      const tweets = await aiGenerateThread(opts.topic, parseInt(opts.tweets));

      if (opts.json) {
        console.log(JSON.stringify({ tweets }, null, 2));
      } else {
        console.log("Generated Thread:");
        for (let i = 0; i < tweets.length; i++) {
          console.log(`\n  [${i + 1}/${tweets.length}] ${tweets[i]}`);
        }
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

aiCmd
  .command("repurpose")
  .description("Repurpose a post for a different platform")
  .argument("<post-id>", "Post ID to repurpose")
  .requiredOption("--to <platform>", "Target platform (x/linkedin/instagram/threads/bluesky)")
  .option("--json", "Output as JSON", false)
  .action(async (postId, opts) => {
    try {
      const post = getPost(postId);
      if (!post) {
        console.error(`Post '${postId}' not found.`);
        process.exit(1);
      }

      const account = getAccount(post.account_id);
      if (!account) {
        console.error(`Account '${post.account_id}' not found.`);
        process.exit(1);
      }

      const result = await aiRepurposePost(post.content, account.platform, opts.to as Platform);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Repurposed for ${opts.to}:`);
        console.log(`  ${result.content}`);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// --- Audience ---

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

// --- Sentiment ---

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

// --- Serve ---

program
  .command("serve")
  .description("Start REST API server with web dashboard")
  .option("--port <port>", "Port to listen on", "19650")
  .action(async (opts) => {
    process.env["PORT"] = opts.port;
    await import("../server/index.js");
  });

program.parse(process.argv);
