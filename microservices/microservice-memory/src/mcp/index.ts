#!/usr/bin/env bun
/**
 * MCP server for microservice-memory.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { createCollection, listCollections } from "../lib/collections.js";
import {
  deleteMemory,
  listMemories,
  searchMemories,
  storeMemory,
  updateMemoryImportance,
} from "../lib/memories.js";

const server = new McpServer({
  name: "microservice-memory",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

server.tool(
  "memory_store",
  "Store a new memory with optional embedding for semantic search",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    collection_id: z.string().optional(),
    content: z.string(),
    summary: z.string().optional(),
    importance: z.number().min(0).max(1).optional(),
    metadata: z.record(z.any()).optional(),
    expires_at: z.string().datetime().optional(),
  },
  async ({ workspace_id, user_id, collection_id, content, summary, importance, metadata, expires_at }) =>
    text(
      await storeMemory(sql, {
        workspaceId: workspace_id,
        userId: user_id,
        collectionId: collection_id,
        content,
        summary,
        importance,
        metadata,
        expiresAt: expires_at ? new Date(expires_at) : undefined,
      }),
    ),
);

server.tool(
  "memory_search",
  "Search memories by text (full-text or semantic if embeddings available)",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    text: z.string(),
    mode: z.enum(["semantic", "text", "hybrid"]).optional().default("text"),
    limit: z.number().optional().default(10),
    collection_id: z.string().optional(),
  },
  async ({ workspace_id, user_id, text: searchText, mode, limit, collection_id }) =>
    text(
      await searchMemories(sql, {
        workspaceId: workspace_id,
        userId: user_id,
        text: searchText,
        mode,
        limit,
        collectionId: collection_id,
      }),
    ),
);

server.tool(
  "memory_recall",
  "Recall memories relevant to a query (alias for search with simpler input)",
  {
    workspace_id: z.string(),
    query: z.string(),
    user_id: z.string().optional(),
    limit: z.number().optional().default(10),
  },
  async ({ workspace_id, query, user_id, limit }) =>
    text(
      await searchMemories(sql, {
        workspaceId: workspace_id,
        userId: user_id,
        text: query,
        mode: "hybrid",
        limit,
      }),
    ),
);

server.tool(
  "memory_delete",
  "Delete a memory by ID",
  { id: z.string() },
  async ({ id }) => text({ deleted: await deleteMemory(sql, id) }),
);

server.tool(
  "memory_list",
  "List memories for a workspace",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    limit: z.number().optional().default(50),
  },
  async ({ workspace_id, user_id, limit }) =>
    text(
      await listMemories(sql, workspace_id, user_id, limit),
    ),
);

server.tool(
  "memory_list_collections",
  "List collections for a workspace",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
  },
  async ({ workspace_id, user_id }) =>
    text(
      await listCollections(sql, workspace_id, user_id),
    ),
);

server.tool(
  "memory_create_collection",
  "Create a new memory collection",
  {
    workspace_id: z.string(),
    user_id: z.string().optional(),
    name: z.string(),
    description: z.string().optional(),
  },
  async (collectionData) =>
    text(
      await createCollection(sql, {
        workspaceId: collectionData.workspace_id,
        userId: collectionData.user_id,
        name: collectionData.name,
        description: collectionData.description,
      }),
    ),
);

server.tool(
  "memory_update_importance",
  "Update the importance score of a memory (0.0 to 1.0)",
  {
    id: z.string(),
    importance: z.number().min(0).max(1),
  },
  async ({ id, importance }) => {
    await updateMemoryImportance(sql, id, importance);
    return text({ ok: true });
  },
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
