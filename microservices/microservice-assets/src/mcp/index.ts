#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createAsset,
  getAsset,
  listAssets,
  updateAsset,
  deleteAsset,
  searchAssets,
  listByType,
  listByTag,
  listByCategory,
  getAssetStats,
} from "../db/assets.js";
import {
  createCollection,
  getCollection,
  listCollections,
  deleteCollection,
  addToCollection,
  removeFromCollection,
  getCollectionAssets,
} from "../db/assets.js";

const server = new McpServer({
  name: "microservice-assets",
  version: "0.0.1",
});

// --- Assets ---

server.registerTool(
  "create_asset",
  {
    title: "Create Asset",
    description: "Create a new digital asset.",
    inputSchema: {
      name: z.string(),
      description: z.string().optional(),
      type: z.enum(["image", "video", "document", "audio", "template", "logo", "font", "other"]).optional(),
      file_path: z.string().optional(),
      file_size: z.number().optional(),
      mime_type: z.string().optional(),
      dimensions: z.string().optional(),
      tags: z.array(z.string()).optional(),
      category: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
      uploaded_by: z.string().optional(),
    },
  },
  async (params) => {
    const asset = createAsset(params);
    return { content: [{ type: "text", text: JSON.stringify(asset, null, 2) }] };
  }
);

server.registerTool(
  "get_asset",
  {
    title: "Get Asset",
    description: "Get an asset by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const asset = getAsset(id);
    if (!asset) {
      return { content: [{ type: "text", text: `Asset '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(asset, null, 2) }] };
  }
);

server.registerTool(
  "list_assets",
  {
    title: "List Assets",
    description: "List assets with optional filters.",
    inputSchema: {
      search: z.string().optional(),
      type: z.string().optional(),
      category: z.string().optional(),
      tag: z.string().optional(),
      uploaded_by: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const assets = listAssets(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ assets, count: assets.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_asset",
  {
    title: "Update Asset",
    description: "Update an existing asset.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      type: z.enum(["image", "video", "document", "audio", "template", "logo", "font", "other"]).optional(),
      file_path: z.string().optional(),
      file_size: z.number().optional(),
      mime_type: z.string().optional(),
      dimensions: z.string().optional(),
      tags: z.array(z.string()).optional(),
      category: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
      uploaded_by: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const asset = updateAsset(id, input);
    if (!asset) {
      return { content: [{ type: "text", text: `Asset '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(asset, null, 2) }] };
  }
);

server.registerTool(
  "delete_asset",
  {
    title: "Delete Asset",
    description: "Delete an asset by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteAsset(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "search_assets",
  {
    title: "Search Assets",
    description: "Search assets by name, description, or tags.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const results = searchAssets(query);
    return {
      content: [
        { type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "list_assets_by_type",
  {
    title: "List Assets by Type",
    description: "List all assets of a specific type.",
    inputSchema: { type: z.string() },
  },
  async ({ type }) => {
    const assets = listByType(type);
    return {
      content: [
        { type: "text", text: JSON.stringify({ assets, count: assets.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "list_assets_by_tag",
  {
    title: "List Assets by Tag",
    description: "List all assets with a specific tag.",
    inputSchema: { tag: z.string() },
  },
  async ({ tag }) => {
    const assets = listByTag(tag);
    return {
      content: [
        { type: "text", text: JSON.stringify({ assets, count: assets.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "list_assets_by_category",
  {
    title: "List Assets by Category",
    description: "List all assets in a specific category.",
    inputSchema: { category: z.string() },
  },
  async ({ category }) => {
    const assets = listByCategory(category);
    return {
      content: [
        { type: "text", text: JSON.stringify({ assets, count: assets.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_asset_stats",
  {
    title: "Get Asset Stats",
    description: "Get asset statistics — totals, size, breakdown by type and category.",
    inputSchema: {},
  },
  async () => {
    const stats = getAssetStats();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

// --- Collections ---

server.registerTool(
  "create_collection",
  {
    title: "Create Collection",
    description: "Create a new asset collection.",
    inputSchema: {
      name: z.string(),
      description: z.string().optional(),
    },
  },
  async (params) => {
    const collection = createCollection(params);
    return { content: [{ type: "text", text: JSON.stringify(collection, null, 2) }] };
  }
);

server.registerTool(
  "get_collection",
  {
    title: "Get Collection",
    description: "Get a collection by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const collection = getCollection(id);
    if (!collection) {
      return { content: [{ type: "text", text: `Collection '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(collection, null, 2) }] };
  }
);

server.registerTool(
  "list_collections",
  {
    title: "List Collections",
    description: "List all asset collections.",
    inputSchema: {},
  },
  async () => {
    const collections = listCollections();
    return {
      content: [
        { type: "text", text: JSON.stringify({ collections, count: collections.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "delete_collection",
  {
    title: "Delete Collection",
    description: "Delete a collection by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteCollection(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "add_asset_to_collection",
  {
    title: "Add Asset to Collection",
    description: "Add an asset to a collection.",
    inputSchema: {
      collection_id: z.string(),
      asset_id: z.string(),
    },
  },
  async ({ collection_id, asset_id }) => {
    const added = addToCollection(collection_id, asset_id);
    return { content: [{ type: "text", text: JSON.stringify({ collection_id, asset_id, added }) }] };
  }
);

server.registerTool(
  "remove_asset_from_collection",
  {
    title: "Remove Asset from Collection",
    description: "Remove an asset from a collection.",
    inputSchema: {
      collection_id: z.string(),
      asset_id: z.string(),
    },
  },
  async ({ collection_id, asset_id }) => {
    const removed = removeFromCollection(collection_id, asset_id);
    return { content: [{ type: "text", text: JSON.stringify({ collection_id, asset_id, removed }) }] };
  }
);

server.registerTool(
  "get_collection_assets",
  {
    title: "Get Collection Assets",
    description: "List all assets in a collection.",
    inputSchema: { collection_id: z.string() },
  },
  async ({ collection_id }) => {
    const assets = getCollectionAssets(collection_id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ assets, count: assets.length }, null, 2) },
      ],
    };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-assets MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
