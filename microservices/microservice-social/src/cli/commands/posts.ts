import { Command } from "commander";
import { readFileSync } from "node:fs";
import {
  createPost,
  getPost,
  listPosts,
  updatePost,
  deletePost,
  schedulePost,
  publishPost,
  batchSchedule,
  crossPost,
  reschedulePost,
  submitPostForReview,
  approvePost,
  getAccount,
  checkPlatformLimit,
  type Platform,
  type PostStatus,
  type Recurrence,
} from "../../db/social.js";
import { getThread, createThread, publishThread, createCarousel } from "../../lib/threads.js";

export function registerPostCommands(program: Command): void {
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
          const { publishToApi } = await import("../../lib/publisher.js");
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
}
