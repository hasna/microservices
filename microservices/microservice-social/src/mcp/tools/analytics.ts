import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
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
} from "../../db/social.js";

const PlatformEnum = z.enum(["x", "linkedin", "instagram", "threads", "bluesky"]);
const RecurrenceEnum = z.enum(["daily", "weekly", "biweekly", "monthly"]);

export function registerAnalyticsTools(server: McpServer) {
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
}
