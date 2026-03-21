#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
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
  getTemplate,
  listTemplates,
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
  PLATFORM_LIMITS,
} from "../db/social.js";
import {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  runOnce as runSchedulerOnce,
} from "../lib/scheduler.js";
import {
  validateMedia,
  getSupportedFormats,
  uploadMedia,
} from "../lib/media.js";

const PlatformEnum = z.enum(["x", "linkedin", "instagram", "threads", "bluesky"]);
const PostStatusEnum = z.enum(["draft", "scheduled", "published", "failed", "pending_review"]);
const RecurrenceEnum = z.enum(["daily", "weekly", "biweekly", "monthly"]);

const server = new McpServer({
  name: "microservice-social",
  version: "0.0.1",
});

// --- Accounts ---

server.registerTool(
  "create_account",
  {
    title: "Create Social Account",
    description: "Add a social media account.",
    inputSchema: {
      platform: PlatformEnum,
      handle: z.string(),
      display_name: z.string().optional(),
      connected: z.boolean().optional(),
      access_token_env: z.string().optional(),
    },
  },
  async (params) => {
    const account = createAccount(params);
    return { content: [{ type: "text", text: JSON.stringify(account, null, 2) }] };
  }
);

server.registerTool(
  "get_account",
  {
    title: "Get Social Account",
    description: "Get a social media account by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const account = getAccount(id);
    if (!account) {
      return { content: [{ type: "text", text: `Account '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(account, null, 2) }] };
  }
);

server.registerTool(
  "list_accounts",
  {
    title: "List Social Accounts",
    description: "List social media accounts with optional filters.",
    inputSchema: {
      platform: PlatformEnum.optional(),
      connected: z.boolean().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const accounts = listAccounts(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ accounts, count: accounts.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_account",
  {
    title: "Update Social Account",
    description: "Update a social media account.",
    inputSchema: {
      id: z.string(),
      platform: PlatformEnum.optional(),
      handle: z.string().optional(),
      display_name: z.string().optional(),
      connected: z.boolean().optional(),
      access_token_env: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const account = updateAccount(id, input);
    if (!account) {
      return { content: [{ type: "text", text: `Account '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(account, null, 2) }] };
  }
);

server.registerTool(
  "delete_account",
  {
    title: "Delete Social Account",
    description: "Delete a social media account by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteAccount(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Posts ---

server.registerTool(
  "create_post",
  {
    title: "Create Post",
    description: "Create a new social media post.",
    inputSchema: {
      account_id: z.string(),
      content: z.string(),
      media_urls: z.array(z.string()).optional(),
      status: PostStatusEnum.optional(),
      scheduled_at: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async (params) => {
    const post = createPost(params);
    return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
  }
);

server.registerTool(
  "get_post",
  {
    title: "Get Post",
    description: "Get a post by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const post = getPost(id);
    if (!post) {
      return { content: [{ type: "text", text: `Post '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
  }
);

server.registerTool(
  "list_posts",
  {
    title: "List Posts",
    description: "List posts with optional filters.",
    inputSchema: {
      account_id: z.string().optional(),
      status: PostStatusEnum.optional(),
      tag: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const posts = listPosts(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ posts, count: posts.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_post",
  {
    title: "Update Post",
    description: "Update an existing post.",
    inputSchema: {
      id: z.string(),
      content: z.string().optional(),
      media_urls: z.array(z.string()).optional(),
      status: PostStatusEnum.optional(),
      scheduled_at: z.string().optional(),
      published_at: z.string().optional(),
      platform_post_id: z.string().optional(),
      engagement: z.object({
        likes: z.number().optional(),
        shares: z.number().optional(),
        comments: z.number().optional(),
        impressions: z.number().optional(),
        clicks: z.number().optional(),
      }).optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async ({ id, ...input }) => {
    const post = updatePost(id, input);
    if (!post) {
      return { content: [{ type: "text", text: `Post '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
  }
);

server.registerTool(
  "delete_post",
  {
    title: "Delete Post",
    description: "Delete a post by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deletePost(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "schedule_post",
  {
    title: "Schedule Post",
    description: "Schedule a post for a specific date/time.",
    inputSchema: {
      id: z.string(),
      scheduled_at: z.string(),
    },
  },
  async ({ id, scheduled_at }) => {
    const post = schedulePost(id, scheduled_at);
    if (!post) {
      return { content: [{ type: "text", text: `Post '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
  }
);

server.registerTool(
  "publish_post",
  {
    title: "Publish Post",
    description: "Publish a post. Set live=true to send via platform API (X, Meta), otherwise marks as published locally.",
    inputSchema: {
      id: z.string(),
      platform_post_id: z.string().optional(),
      live: z.boolean().optional().describe("If true, publish via the platform API instead of just marking locally"),
    },
  },
  async ({ id, platform_post_id, live }) => {
    try {
      let post;
      if (live) {
        const { publishToApi } = await import("../lib/publisher.js");
        post = await publishToApi(id);
      } else {
        post = publishPost(id, platform_post_id);
      }
      if (!post) {
        return { content: [{ type: "text", text: `Post '${id}' not found.` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// --- Threads ---

server.registerTool(
  "create_thread",
  {
    title: "Create Thread",
    description: "Create a thread of multiple posts linked by thread_id, ordered sequentially.",
    inputSchema: {
      contents: z.array(z.string()).describe("Content for each post in the thread"),
      account_id: z.string(),
      scheduled_at: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async ({ contents, account_id, scheduled_at, tags }) => {
    try {
      const { createThread } = await import("../lib/threads.js");
      const result = createThread(contents, account_id, { scheduledAt: scheduled_at, tags });
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
  "get_thread",
  {
    title: "Get Thread",
    description: "Get all posts in a thread ordered by position.",
    inputSchema: {
      thread_id: z.string(),
    },
  },
  async ({ thread_id }) => {
    try {
      const { getThread } = await import("../lib/threads.js");
      const posts = getThread(thread_id);
      return {
        content: [
          { type: "text", text: JSON.stringify({ thread_id, posts, count: posts.length }, null, 2) },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "publish_thread",
  {
    title: "Publish Thread",
    description: "Publish a thread sequentially via platform APIs. X chains tweets as replies; Meta posts first then comments.",
    inputSchema: {
      thread_id: z.string(),
    },
  },
  async ({ thread_id }) => {
    try {
      const { publishThread } = await import("../lib/threads.js");
      const result = await publishThread(thread_id);
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
  "create_carousel",
  {
    title: "Create Carousel",
    description: "Create a carousel post with multiple images (Instagram/LinkedIn format).",
    inputSchema: {
      images: z.array(z.string()).describe("Image URLs for the carousel"),
      captions: z.array(z.string()).optional().describe("Captions for the images"),
      account_id: z.string(),
    },
  },
  async ({ images, captions, account_id }) => {
    try {
      const { createCarousel } = await import("../lib/threads.js");
      const post = createCarousel(images, captions || [], account_id);
      return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// --- Templates ---

server.registerTool(
  "create_template",
  {
    title: "Create Template",
    description: "Create a post template with variables.",
    inputSchema: {
      name: z.string(),
      content: z.string(),
      variables: z.array(z.string()).optional(),
    },
  },
  async (params) => {
    const template = createTemplate(params);
    return { content: [{ type: "text", text: JSON.stringify(template, null, 2) }] };
  }
);

server.registerTool(
  "list_templates",
  {
    title: "List Templates",
    description: "List all post templates.",
    inputSchema: {},
  },
  async () => {
    const templates = listTemplates();
    return {
      content: [
        { type: "text", text: JSON.stringify({ templates, count: templates.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_template",
  {
    title: "Get Template",
    description: "Get a template by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const template = getTemplate(id);
    if (!template) {
      return { content: [{ type: "text", text: `Template '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(template, null, 2) }] };
  }
);

server.registerTool(
  "delete_template",
  {
    title: "Delete Template",
    description: "Delete a template by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteTemplate(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "use_template",
  {
    title: "Use Template",
    description: "Create a post from a template by replacing variables.",
    inputSchema: {
      template_id: z.string(),
      account_id: z.string(),
      values: z.record(z.string()).optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async ({ template_id, account_id, values, tags }) => {
    try {
      const post = useTemplate(template_id, account_id, values || {}, tags);
      return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// --- Analytics ---

server.registerTool(
  "get_engagement_stats",
  {
    title: "Get Engagement Stats",
    description: "Get engagement analytics for published posts.",
    inputSchema: {
      account_id: z.string().optional(),
    },
  },
  async ({ account_id }) => {
    const stats = getEngagementStats(account_id);
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

server.registerTool(
  "get_stats_by_platform",
  {
    title: "Get Stats By Platform",
    description: "Get analytics grouped by social media platform.",
    inputSchema: {},
  },
  async () => {
    const stats = getStatsByPlatform();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

server.registerTool(
  "get_calendar",
  {
    title: "Get Calendar",
    description: "View scheduled posts grouped by date.",
    inputSchema: {
      start_date: z.string().optional(),
      end_date: z.string().optional(),
    },
  },
  async ({ start_date, end_date }) => {
    const calendar = getCalendar(start_date, end_date);
    return { content: [{ type: "text", text: JSON.stringify(calendar, null, 2) }] };
  }
);

server.registerTool(
  "get_overall_stats",
  {
    title: "Get Overall Stats",
    description: "Get overall social media management statistics.",
    inputSchema: {},
  },
  async () => {
    const stats = getOverallStats();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

// --- Batch Schedule ---

server.registerTool(
  "batch_schedule_posts",
  {
    title: "Batch Schedule Posts",
    description: "Schedule multiple posts at once from an array of post definitions.",
    inputSchema: {
      posts: z.array(z.object({
        account_id: z.string(),
        content: z.string(),
        scheduled_at: z.string(),
        media_urls: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        recurrence: RecurrenceEnum.optional(),
      })),
    },
  },
  async ({ posts }) => {
    const result = batchSchedule(posts);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Cross-Post ---

server.registerTool(
  "crosspost",
  {
    title: "Cross-Post",
    description: "Create identical post on multiple platform accounts.",
    inputSchema: {
      content: z.string(),
      platforms: z.array(PlatformEnum),
      media_urls: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      scheduled_at: z.string().optional(),
    },
  },
  async ({ content, platforms, ...options }) => {
    try {
      const result = crossPost(content, platforms, options);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// --- Best Time to Post ---

server.registerTool(
  "best_time_to_post",
  {
    title: "Best Time to Post",
    description: "Analyze historical engagement to find the best hours and days to post.",
    inputSchema: {
      account_id: z.string(),
    },
  },
  async ({ account_id }) => {
    const result = getBestTimeToPost(account_id);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Reschedule Post ---

server.registerTool(
  "reschedule_post",
  {
    title: "Reschedule Post",
    description: "Update the scheduled date/time of a post without delete/recreate.",
    inputSchema: {
      id: z.string(),
      new_date: z.string(),
    },
  },
  async ({ id, new_date }) => {
    try {
      const post = reschedulePost(id, new_date);
      if (!post) {
        return { content: [{ type: "text", text: `Post '${id}' not found.` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// --- Approval Workflow ---

server.registerTool(
  "submit_post_for_review",
  {
    title: "Submit Post for Review",
    description: "Submit a draft post for review (draft → pending_review).",
    inputSchema: {
      id: z.string(),
    },
  },
  async ({ id }) => {
    try {
      const post = submitPostForReview(id);
      if (!post) {
        return { content: [{ type: "text", text: `Post '${id}' not found.` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "approve_post",
  {
    title: "Approve Post",
    description: "Approve a post pending review (pending_review → scheduled).",
    inputSchema: {
      id: z.string(),
      scheduled_at: z.string().optional(),
    },
  },
  async ({ id, scheduled_at }) => {
    try {
      const post = approvePost(id, scheduled_at);
      if (!post) {
        return { content: [{ type: "text", text: `Post '${id}' not found.` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// --- Platform Limits ---

server.registerTool(
  "get_platform_limits",
  {
    title: "Get Platform Limits",
    description: "Get character limits for all supported platforms.",
    inputSchema: {},
  },
  async () => {
    return { content: [{ type: "text", text: JSON.stringify(PLATFORM_LIMITS, null, 2) }] };
  }
);

// --- Recurring Posts ---

server.registerTool(
  "create_recurring_post",
  {
    title: "Create Recurring Post",
    description: "Create a post that recurs on a schedule (daily, weekly, biweekly, monthly).",
    inputSchema: {
      account_id: z.string(),
      content: z.string(),
      scheduled_at: z.string(),
      recurrence: RecurrenceEnum,
      media_urls: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async (params) => {
    try {
      const post = createRecurringPost(params);
      return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// --- Hashtag Analytics ---

server.registerTool(
  "hashtag_analytics",
  {
    title: "Hashtag Analytics",
    description: "Extract hashtags from published posts and correlate with engagement metrics.",
    inputSchema: {
      account_id: z.string(),
    },
  },
  async ({ account_id }) => {
    const stats = getHashtagStats(account_id);
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

// --- Publisher Bridge ---

server.registerTool(
  "check_providers",
  {
    title: "Check Providers",
    description: "Check which platform API providers have env vars configured (X, Meta).",
    inputSchema: {},
  },
  async () => {
    const { checkProviders } = await import("../lib/publisher.js");
    const providers = checkProviders();
    return { content: [{ type: "text", text: JSON.stringify(providers, null, 2) }] };
  }
);

server.registerTool(
  "sync_post_metrics",
  {
    title: "Sync Post Metrics",
    description: "Fetch engagement metrics from the platform API and update the post in DB.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    try {
      const { syncPostMetrics } = await import("../lib/publisher.js");
      const post = await syncPostMetrics(id);
      return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// --- Scheduler ---

server.registerTool(
  "start_scheduler",
  {
    title: "Start Scheduler",
    description: "Start the auto-publish scheduler that checks for due posts at a regular interval.",
    inputSchema: {
      interval_ms: z.number().optional(),
    },
  },
  async ({ interval_ms }) => {
    try {
      startScheduler(interval_ms || 60000);
      const status = getSchedulerStatus();
      return { content: [{ type: "text", text: JSON.stringify({ message: "Scheduler started", ...status }, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "stop_scheduler",
  {
    title: "Stop Scheduler",
    description: "Stop the auto-publish scheduler.",
    inputSchema: {},
  },
  async () => {
    stopScheduler();
    const status = getSchedulerStatus();
    return { content: [{ type: "text", text: JSON.stringify({ message: "Scheduler stopped", ...status }, null, 2) }] };
  }
);

server.registerTool(
  "scheduler_status",
  {
    title: "Scheduler Status",
    description: "Get the current status of the auto-publish scheduler.",
    inputSchema: {},
  },
  async () => {
    const status = getSchedulerStatus();
    return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
  }
);

// --- Media ---

server.registerTool(
  "upload_media",
  {
    title: "Upload Media",
    description: "Upload a media file to a social media platform.",
    inputSchema: {
      file_path: z.string(),
      platform: PlatformEnum,
      page_id: z.string().optional(),
    },
  },
  async ({ file_path, platform, page_id }) => {
    try {
      const validation = validateMedia(file_path, platform);
      if (!validation.valid) {
        return {
          content: [{ type: "text", text: JSON.stringify({ valid: false, errors: validation.errors }, null, 2) }],
          isError: true,
        };
      }

      const result = await uploadMedia(file_path, platform, page_id);
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
  "validate_media",
  {
    title: "Validate Media",
    description: "Validate a media file for a specific platform without uploading.",
    inputSchema: {
      file_path: z.string(),
      platform: PlatformEnum,
    },
  },
  async ({ file_path, platform }) => {
    const result = validateMedia(file_path, platform);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "get_supported_formats",
  {
    title: "Get Supported Formats",
    description: "Get supported media formats for a platform.",
    inputSchema: {
      platform: PlatformEnum,
    },
  },
  async ({ platform }) => {
    const formats = getSupportedFormats(platform);
    return { content: [{ type: "text", text: JSON.stringify({ platform, formats }, null, 2) }] };
  }
);

// --- Metrics Sync ---

server.registerTool(
  "sync_all_metrics",
  {
    title: "Sync All Metrics",
    description: "Sync engagement metrics for all published posts from the last 7 days via platform APIs.",
    inputSchema: {},
  },
  async () => {
    try {
      const { syncAllMetrics } = await import("../lib/metrics-sync.js");
      const report = await syncAllMetrics();
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "sync_account_metrics",
  {
    title: "Sync Account Metrics",
    description: "Pull follower count and profile data from platform API for a specific account.",
    inputSchema: {
      account_id: z.string(),
    },
  },
  async ({ account_id }) => {
    try {
      const { syncAccountMetrics } = await import("../lib/metrics-sync.js");
      const account = await syncAccountMetrics(account_id);
      if (!account) {
        return { content: [{ type: "text", text: `Account '${account_id}' not found.` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(account, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "metrics_sync_status",
  {
    title: "Metrics Sync Status",
    description: "Get the current status of the metrics sync worker, including sync report.",
    inputSchema: {},
  },
  async () => {
    const { getMetricsSyncStatus, getSyncReport } = await import("../lib/metrics-sync.js");
    const status = getMetricsSyncStatus();
    const report = getSyncReport();
    return { content: [{ type: "text", text: JSON.stringify({ status, report }, null, 2) }] };
  }
);

// --- Mentions ---

const MentionTypeEnum = z.enum(["mention", "reply", "quote", "dm"]);

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
    const { listMentions } = await import("../lib/mentions.js");
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
      const { replyToMention } = await import("../lib/mentions.js");
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
    const { markRead, markAllRead } = await import("../lib/mentions.js");
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
    const { pollMentions, stopPolling, isPolling } = await import("../lib/mentions.js");
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
    const { getMentionStats } = await import("../lib/mentions.js");
    const stats = getMentionStats(account_id);
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

// --- AI Content Generation ---

const ToneEnum = z.enum(["professional", "casual", "witty"]);

server.registerTool(
  "generate_post",
  {
    title: "Generate Post with AI",
    description: "Generate a social media post using AI. Provide a topic and platform; get back content, hashtags, and a suggested media prompt.",
    inputSchema: {
      topic: z.string(),
      platform: PlatformEnum,
      tone: ToneEnum.optional(),
      includeHashtags: z.boolean().optional(),
      includeEmoji: z.boolean().optional(),
      language: z.string().optional(),
    },
  },
  async ({ topic, platform, ...options }) => {
    try {
      const { generatePost } = await import("../lib/content-ai.js");
      const result = await generatePost(topic, platform, options);
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
  "suggest_hashtags",
  {
    title: "Suggest Hashtags",
    description: "Analyze post content and suggest relevant hashtags using AI.",
    inputSchema: {
      content: z.string(),
      platform: PlatformEnum,
      count: z.number().optional(),
    },
  },
  async ({ content, platform, count }) => {
    try {
      const { suggestHashtags } = await import("../lib/content-ai.js");
      const hashtags = await suggestHashtags(content, platform, count || 5);
      return { content: [{ type: "text", text: JSON.stringify({ hashtags }, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "optimize_post",
  {
    title: "Optimize Post",
    description: "Rewrite a post for better engagement using AI. Returns optimized content and a list of improvements.",
    inputSchema: {
      content: z.string(),
      platform: PlatformEnum,
    },
  },
  async ({ content, platform }) => {
    try {
      const { optimizePost } = await import("../lib/content-ai.js");
      const result = await optimizePost(content, platform);
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
  "generate_thread",
  {
    title: "Generate Thread",
    description: "Generate a multi-tweet thread using AI. Each tweet stays within 280 chars.",
    inputSchema: {
      topic: z.string(),
      tweet_count: z.number().optional(),
    },
  },
  async ({ topic, tweet_count }) => {
    try {
      const { generateThread } = await import("../lib/content-ai.js");
      const tweets = await generateThread(topic, tweet_count || 5);
      return { content: [{ type: "text", text: JSON.stringify({ tweets, count: tweets.length }, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "repurpose_post",
  {
    title: "Repurpose Post",
    description: "Adapt a post from one platform's style to another using AI (e.g., X to LinkedIn).",
    inputSchema: {
      content: z.string(),
      source_platform: PlatformEnum,
      target_platform: PlatformEnum,
    },
  },
  async ({ content, source_platform, target_platform }) => {
    try {
      const { repurposePost } = await import("../lib/content-ai.js");
      const result = await repurposePost(content, source_platform, target_platform);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// --- Audience ---

server.registerTool(
  "sync_followers",
  {
    title: "Sync Followers",
    description: "Sync followers from the platform API for an account. Returns sync results including new and unfollowed counts.",
    inputSchema: {
      account_id: z.string(),
    },
  },
  async ({ account_id }) => {
    try {
      const { syncFollowers } = await import("../lib/audience.js");
      const result = syncFollowers(account_id);
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
  "audience_insights",
  {
    title: "Audience Insights",
    description: "Get audience insights for an account: total followers, growth rates, new/lost followers, and top followers.",
    inputSchema: {
      account_id: z.string(),
    },
  },
  async ({ account_id }) => {
    try {
      const { getAudienceInsights } = await import("../lib/audience.js");
      const insights = getAudienceInsights(account_id);
      return { content: [{ type: "text", text: JSON.stringify(insights, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "follower_growth",
  {
    title: "Follower Growth Chart",
    description: "Get follower growth data points over a number of days for charting.",
    inputSchema: {
      account_id: z.string(),
      days: z.number().optional(),
    },
  },
  async ({ account_id, days }) => {
    try {
      const { getFollowerGrowthChart } = await import("../lib/audience.js");
      const chart = getFollowerGrowthChart(account_id, days || 30);
      return { content: [{ type: "text", text: JSON.stringify(chart, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "top_followers",
  {
    title: "Top Followers",
    description: "Get top followers for an account, sorted by their follower count (most influential first).",
    inputSchema: {
      account_id: z.string(),
      limit: z.number().optional(),
    },
  },
  async ({ account_id, limit }) => {
    try {
      const { getTopFollowers } = await import("../lib/audience.js");
      const followers = getTopFollowers(account_id, limit || 10);
      return { content: [{ type: "text", text: JSON.stringify({ followers, count: followers.length }, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// --- Sentiment Analysis ---

server.registerTool(
  "analyze_sentiment",
  {
    title: "Analyze Sentiment",
    description: "Analyze the sentiment of a text using AI. Returns sentiment label (positive/neutral/negative), score (0-1), and emotional keywords.",
    inputSchema: {
      text: z.string().describe("The text to analyze for sentiment"),
    },
  },
  async ({ text }) => {
    try {
      const { analyzeSentiment } = await import("../lib/sentiment.js");
      const result = await analyzeSentiment(text);
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
  "sentiment_report",
  {
    title: "Sentiment Report",
    description: "Get an aggregated sentiment report for an account's mentions. Shows positive/neutral/negative percentages, trending keywords, and most positive/negative mentions.",
    inputSchema: {
      account_id: z.string(),
      days: z.number().optional().describe("Number of days to look back (default: all time)"),
    },
  },
  async ({ account_id, days }) => {
    try {
      const { getSentimentReport } = await import("../lib/sentiment.js");
      const report = getSentimentReport(account_id, days);
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "auto_analyze_mention",
  {
    title: "Auto-Analyze Mention Sentiment",
    description: "Analyze a mention's content for sentiment and store the result in the mention record. Returns the sentiment analysis result.",
    inputSchema: {
      mention_id: z.string(),
    },
  },
  async ({ mention_id }) => {
    try {
      const { autoAnalyzeMention } = await import("../lib/sentiment.js");
      const result = await autoAnalyzeMention(mention_id);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-social MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
