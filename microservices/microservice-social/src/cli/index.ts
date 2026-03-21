#!/usr/bin/env bun

import { Command } from "commander";
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
  type Platform,
  type PostStatus,
} from "../db/social.js";

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
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const post = createPost({
      account_id: opts.account,
      content: opts.content,
      media_urls: opts.media ? opts.media.split(",").map((u: string) => u.trim()) : undefined,
      status: opts.status as PostStatus,
      scheduled_at: opts.scheduledAt,
      tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
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
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const post = schedulePost(id, opts.at);
    if (!post) {
      console.error(`Post '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(post, null, 2));
    } else {
      console.log(`Scheduled post ${post.id} for ${post.scheduled_at}`);
    }
  });

postCmd
  .command("publish")
  .description("Mark a post as published")
  .argument("<id>", "Post ID")
  .option("--platform-id <id>", "Platform post ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const post = publishPost(id, opts.platformId);
    if (!post) {
      console.error(`Post '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(post, null, 2));
    } else {
      console.log(`Published post ${post.id} at ${post.published_at}`);
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

program
  .command("analytics")
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

program.parse(process.argv);
