#!/usr/bin/env bun
/**
 * MCP server for microservice-search.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import {
  deleteDocument,
  indexDocument,
  listCollections,
} from "../lib/index_ops.js";
import { countDocuments, search } from "../lib/search_ops.js";

const server = new Server(
  { name: "microservice-search", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_index",
      description: "Index a document for search (upserts by collection+doc_id)",
      inputSchema: {
        type: "object",
        properties: {
          collection: {
            type: "string",
            description: "Collection/namespace for the document",
          },
          doc_id: {
            type: "string",
            description: "Unique document ID within the collection",
          },
          content: {
            type: "string",
            description: "Document text content to index",
          },
          workspace_id: {
            type: "string",
            description: "Optional workspace UUID for multi-tenant isolation",
          },
          metadata: {
            type: "object",
            description: "Optional arbitrary metadata",
          },
        },
        required: ["collection", "doc_id", "content"],
      },
    },
    {
      name: "search_query",
      description:
        "Search indexed documents using full-text, semantic, or hybrid mode",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Search query text" },
          collection: {
            type: "string",
            description: "Limit search to this collection",
          },
          workspace_id: {
            type: "string",
            description: "Limit search to this workspace",
          },
          mode: {
            type: "string",
            enum: ["text", "semantic", "hybrid"],
            description: "Search mode (default: text)",
          },
          limit: {
            type: "number",
            description: "Maximum results to return (default: 10)",
          },
        },
        required: ["text"],
      },
    },
    {
      name: "search_delete_document",
      description: "Delete a single document from the search index",
      inputSchema: {
        type: "object",
        properties: {
          collection: { type: "string" },
          doc_id: { type: "string" },
        },
        required: ["collection", "doc_id"],
      },
    },
    {
      name: "search_list_collections",
      description: "List all indexed collections with document counts",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: {
            type: "string",
            description: "Filter by workspace UUID",
          },
        },
        required: [],
      },
    },
    {
      name: "search_count_documents",
      description: "Count documents in a collection",
      inputSchema: {
        type: "object",
        properties: {
          collection: { type: "string" },
          workspace_id: { type: "string" },
        },
        required: ["collection"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb();
  const { name, arguments: args } = req.params;
  const a = args as any;

  const text = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  if (name === "search_index") {
    await indexDocument(sql, {
      collection: String(a.collection),
      docId: String(a.doc_id),
      content: String(a.content),
      workspaceId: a.workspace_id ? String(a.workspace_id) : undefined,
      metadata: a.metadata as any | undefined,
    });
    return text({ ok: true });
  }

  if (name === "search_query") {
    const results = await search(sql, {
      text: String(a.text),
      collection: a.collection ? String(a.collection) : undefined,
      workspaceId: a.workspace_id ? String(a.workspace_id) : undefined,
      mode: a.mode as "text" | "semantic" | "hybrid" | undefined,
      limit: a.limit ? Number(a.limit) : undefined,
    });
    return text({ results, count: results.length });
  }

  if (name === "search_delete_document") {
    const deleted = await deleteDocument(
      sql,
      String(a.collection),
      String(a.doc_id),
    );
    return text({ ok: deleted, deleted });
  }

  if (name === "search_list_collections") {
    const collections = await listCollections(
      sql,
      a.workspace_id ? String(a.workspace_id) : undefined,
    );
    return text({ collections, count: collections.length });
  }

  if (name === "search_count_documents") {
    const count = await countDocuments(
      sql,
      String(a.collection),
      a.workspace_id ? String(a.workspace_id) : undefined,
    );
    return text({ collection: a.collection, count });
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
