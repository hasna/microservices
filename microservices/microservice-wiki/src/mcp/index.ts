#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createPage,
  getPage,
  getPageBySlug,
  listPages,
  updatePage,
  deletePage,
  searchPages,
  getPageTree,
  getRecentlyUpdated,
  getByCategory,
  getByTag,
  getPageHistory,
  revertToVersion,
  addLink,
  removeLink,
  getLinksFrom,
  getLinksTo,
} from "../db/wiki.js";

const server = new McpServer({
  name: "microservice-wiki",
  version: "0.0.1",
});

// --- Pages ---

server.registerTool(
  "create_page",
  {
    title: "Create Page",
    description: "Create a new wiki page.",
    inputSchema: {
      title: z.string(),
      slug: z.string().optional(),
      content: z.string().optional(),
      format: z.enum(["markdown", "html"]).optional(),
      category: z.string().optional(),
      parent_id: z.string().optional(),
      author: z.string().optional(),
      status: z.enum(["draft", "published", "archived"]).optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async (params) => {
    const page = createPage(params);
    return { content: [{ type: "text", text: JSON.stringify(page, null, 2) }] };
  }
);

server.registerTool(
  "get_page",
  {
    title: "Get Page",
    description: "Get a wiki page by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const page = getPage(id);
    if (!page) {
      return { content: [{ type: "text", text: `Page '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(page, null, 2) }] };
  }
);

server.registerTool(
  "get_page_by_slug",
  {
    title: "Get Page by Slug",
    description: "Get a wiki page by its URL slug.",
    inputSchema: { slug: z.string() },
  },
  async ({ slug }) => {
    const page = getPageBySlug(slug);
    if (!page) {
      return { content: [{ type: "text", text: `Page with slug '${slug}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(page, null, 2) }] };
  }
);

server.registerTool(
  "list_pages",
  {
    title: "List Pages",
    description: "List wiki pages with optional filters.",
    inputSchema: {
      search: z.string().optional(),
      category: z.string().optional(),
      status: z.enum(["draft", "published", "archived"]).optional(),
      tag: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const pages = listPages(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ pages, count: pages.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_page",
  {
    title: "Update Page",
    description: "Update an existing wiki page. Auto-saves a version snapshot before updating.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      slug: z.string().optional(),
      content: z.string().optional(),
      format: z.enum(["markdown", "html"]).optional(),
      category: z.string().optional(),
      parent_id: z.string().optional(),
      author: z.string().optional(),
      status: z.enum(["draft", "published", "archived"]).optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async ({ id, ...input }) => {
    const page = updatePage(id, input);
    if (!page) {
      return { content: [{ type: "text", text: `Page '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(page, null, 2) }] };
  }
);

server.registerTool(
  "delete_page",
  {
    title: "Delete Page",
    description: "Delete a wiki page by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deletePage(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "search_pages",
  {
    title: "Search Pages",
    description: "Search wiki pages by title or content.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const results = searchPages(query);
    return {
      content: [
        { type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_page_tree",
  {
    title: "Get Page Tree",
    description: "Get hierarchical page tree organized by parent-child relationships.",
    inputSchema: {},
  },
  async () => {
    const tree = getPageTree();
    return { content: [{ type: "text", text: JSON.stringify(tree, null, 2) }] };
  }
);

server.registerTool(
  "get_recently_updated",
  {
    title: "Get Recently Updated Pages",
    description: "Get the most recently updated wiki pages.",
    inputSchema: { limit: z.number().optional() },
  },
  async ({ limit }) => {
    const pages = getRecentlyUpdated(limit);
    return {
      content: [
        { type: "text", text: JSON.stringify({ pages, count: pages.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_pages_by_category",
  {
    title: "Get Pages by Category",
    description: "Get all wiki pages in a specific category.",
    inputSchema: { category: z.string() },
  },
  async ({ category }) => {
    const pages = getByCategory(category);
    return {
      content: [
        { type: "text", text: JSON.stringify({ pages, count: pages.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_pages_by_tag",
  {
    title: "Get Pages by Tag",
    description: "Get all wiki pages with a specific tag.",
    inputSchema: { tag: z.string() },
  },
  async ({ tag }) => {
    const pages = getByTag(tag);
    return {
      content: [
        { type: "text", text: JSON.stringify({ pages, count: pages.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_page_history",
  {
    title: "Get Page History",
    description: "Get the version history of a wiki page.",
    inputSchema: { page_id: z.string() },
  },
  async ({ page_id }) => {
    const history = getPageHistory(page_id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ versions: history, count: history.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "revert_page",
  {
    title: "Revert Page",
    description: "Revert a wiki page to a previous version.",
    inputSchema: {
      page_id: z.string(),
      version: z.number(),
    },
  },
  async ({ page_id, version }) => {
    const page = revertToVersion(page_id, version);
    if (!page) {
      return { content: [{ type: "text", text: `Page '${page_id}' or version ${version} not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(page, null, 2) }] };
  }
);

server.registerTool(
  "add_page_link",
  {
    title: "Add Page Link",
    description: "Create a link between two wiki pages.",
    inputSchema: {
      source_id: z.string(),
      target_id: z.string(),
    },
  },
  async ({ source_id, target_id }) => {
    const link = addLink(source_id, target_id);
    return { content: [{ type: "text", text: JSON.stringify(link, null, 2) }] };
  }
);

server.registerTool(
  "remove_page_link",
  {
    title: "Remove Page Link",
    description: "Remove a link between two wiki pages.",
    inputSchema: {
      source_id: z.string(),
      target_id: z.string(),
    },
  },
  async ({ source_id, target_id }) => {
    const removed = removeLink(source_id, target_id);
    return { content: [{ type: "text", text: JSON.stringify({ source_id, target_id, removed }) }] };
  }
);

server.registerTool(
  "get_links_from",
  {
    title: "Get Outgoing Links",
    description: "Get all links from a wiki page to other pages.",
    inputSchema: { page_id: z.string() },
  },
  async ({ page_id }) => {
    const links = getLinksFrom(page_id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ links, count: links.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_links_to",
  {
    title: "Get Incoming Links",
    description: "Get all links to a wiki page from other pages.",
    inputSchema: { page_id: z.string() },
  },
  async ({ page_id }) => {
    const links = getLinksTo(page_id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ links, count: links.length }, null, 2) },
      ],
    };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-wiki MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
