#!/usr/bin/env bun
/**
 * MCP server for microservice-memory.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import {
  storeMemory,
  searchMemories,
  getMemory,
  listMemories,
  deleteMemory,
  updateMemoryImportance,
} from "../lib/memories.js";
import {
  createCollection,
  listCollections,
} from "../lib/collections.js";

const server = new Server(
  { name: "microservice-memory", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "memory_store",
      description: "Store a new memory with optional embedding for semantic search",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          collection_id: { type: "string" },
          content: { type: "string" },
          summary: { type: "string" },
          importance: { type: "number", minimum: 0, maximum: 1 },
          metadata: { type: "object" },
          expires_at: { type: "string", format: "date-time" },
        },
        required: ["workspace_id", "content"],
      },
    },
    {
      name: "memory_search",
      description: "Search memories by text (full-text or semantic if embeddings available)",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          text: { type: "string" },
          mode: { type: "string", enum: ["semantic", "text", "hybrid"] },
          limit: { type: "number" },
          collection_id: { type: "string" },
        },
        required: ["workspace_id", "text"],
      },
    },
    {
      name: "memory_recall",
      description: "Recall memories relevant to a query (alias for search with simpler input)",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          query: { type: "string" },
          user_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["workspace_id", "query"],
      },
    },
    {
      name: "memory_delete",
      description: "Delete a memory by ID",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "memory_list",
      description: "List memories for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "memory_list_collections",
      description: "List collections for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          user_id: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "memory_create_collection",
      description: "Create a new memory collection",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
        },
        required: ["workspace_id", "name"],
      },
    },
    {
      name: "memory_update_importance",
      description: "Update the importance score of a memory (0.0 to 1.0)",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          importance: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["id", "importance"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb();
  const { name, arguments: args } = req.params;
  const a = args as Record<string, unknown>;

  const text = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  if (name === "memory_store") {
    return text(await storeMemory(sql, {
      workspaceId: String(a.workspace_id),
      userId: a.user_id ? String(a.user_id) : undefined,
      collectionId: a.collection_id ? String(a.collection_id) : undefined,
      content: String(a.content),
      summary: a.summary ? String(a.summary) : undefined,
      importance: a.importance !== undefined ? Number(a.importance) : undefined,
      metadata: a.metadata as Record<string, unknown> | undefined,
      expiresAt: a.expires_at ? new Date(String(a.expires_at)) : undefined,
    }));
  }

  if (name === "memory_search") {
    return text(await searchMemories(sql, {
      workspaceId: String(a.workspace_id),
      userId: a.user_id ? String(a.user_id) : undefined,
      text: String(a.text),
      mode: a.mode as "semantic" | "text" | "hybrid" | undefined,
      limit: a.limit !== undefined ? Number(a.limit) : undefined,
      collectionId: a.collection_id ? String(a.collection_id) : undefined,
    }));
  }

  if (name === "memory_recall") {
    return text(await searchMemories(sql, {
      workspaceId: String(a.workspace_id),
      userId: a.user_id ? String(a.user_id) : undefined,
      text: String(a.query),
      mode: "hybrid",
      limit: a.limit !== undefined ? Number(a.limit) : 10,
    }));
  }

  if (name === "memory_delete") {
    return text({ deleted: await deleteMemory(sql, String(a.id)) });
  }

  if (name === "memory_list") {
    return text(await listMemories(
      sql,
      String(a.workspace_id),
      a.user_id ? String(a.user_id) : undefined,
      a.limit !== undefined ? Number(a.limit) : undefined
    ));
  }

  if (name === "memory_list_collections") {
    return text(await listCollections(
      sql,
      String(a.workspace_id),
      a.user_id ? String(a.user_id) : undefined
    ));
  }

  if (name === "memory_create_collection") {
    return text(await createCollection(sql, {
      workspaceId: String(a.workspace_id),
      userId: a.user_id ? String(a.user_id) : undefined,
      name: String(a.name),
      description: a.description ? String(a.description) : undefined,
    }));
  }

  if (name === "memory_update_importance") {
    await updateMemoryImportance(sql, String(a.id), Number(a.importance));
    return text({ ok: true });
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  const sql = getDb();
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
