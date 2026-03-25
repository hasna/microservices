import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createPost,
  getPost,
  listPosts,
  updatePost,
  deletePost,
  schedulePost,
  publishPost,
} from "../../db/social.js";

const PlatformEnum = z.enum(["x", "linkedin", "instagram", "threads", "bluesky"]);
const PostStatusEnum = z.enum(["draft", "scheduled", "published", "failed", "pending_review"]);

export function registerPostTools(server: McpServer) {
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
          const { publishToApi } = await import("../../lib/publisher.js");
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
        const { createThread } = await import("../../lib/threads.js");
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
        const { getThread } = await import("../../lib/threads.js");
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
        const { publishThread } = await import("../../lib/threads.js");
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
        const { createCarousel } = await import("../../lib/threads.js");
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
}
