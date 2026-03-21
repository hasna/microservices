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
} from "../db/social.js";

const PlatformEnum = z.enum(["x", "linkedin", "instagram", "threads", "bluesky"]);
const PostStatusEnum = z.enum(["draft", "scheduled", "published", "failed"]);

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
    description: "Mark a post as published.",
    inputSchema: {
      id: z.string(),
      platform_post_id: z.string().optional(),
    },
  },
  async ({ id, platform_post_id }) => {
    const post = publishPost(id, platform_post_id);
    if (!post) {
      return { content: [{ type: "text", text: `Post '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
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
