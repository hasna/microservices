#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createDocument,
  getDocument,
  listDocuments,
  updateDocument,
  deleteDocument,
  countDocuments,
  searchDocuments,
  addVersion,
  listVersions,
} from "../db/documents.js";

const server = new McpServer({
  name: "microservice-documents",
  version: "0.0.1",
});

// --- Documents ---

server.registerTool(
  "create_document",
  {
    title: "Create Document",
    description: "Create a new document.",
    inputSchema: {
      title: z.string(),
      description: z.string().optional(),
      file_path: z.string().optional(),
      file_type: z.string().optional(),
      file_size: z.number().optional(),
      status: z.enum(["draft", "active", "archived"]).optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async (params) => {
    const doc = createDocument(params);
    return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
  }
);

server.registerTool(
  "get_document",
  {
    title: "Get Document",
    description: "Get a document by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const doc = getDocument(id);
    if (!doc) {
      return { content: [{ type: "text", text: `Document '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
  }
);

server.registerTool(
  "list_documents",
  {
    title: "List Documents",
    description: "List documents with optional filters.",
    inputSchema: {
      search: z.string().optional(),
      file_type: z.string().optional(),
      status: z.string().optional(),
      tag: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const docs = listDocuments(params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ documents: docs, count: docs.length }, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "update_document",
  {
    title: "Update Document",
    description: "Update an existing document.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      file_path: z.string().optional(),
      file_type: z.string().optional(),
      file_size: z.number().optional(),
      status: z.enum(["draft", "active", "archived"]).optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async ({ id, ...input }) => {
    const doc = updateDocument(id, input);
    if (!doc) {
      return { content: [{ type: "text", text: `Document '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
  }
);

server.registerTool(
  "delete_document",
  {
    title: "Delete Document",
    description: "Delete a document by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteDocument(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "search_documents",
  {
    title: "Search Documents",
    description: "Search documents by title or description.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const results = searchDocuments(query);
    return {
      content: [
        { type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "count_documents",
  {
    title: "Count Documents",
    description: "Get the total number of documents.",
    inputSchema: {},
  },
  async () => {
    const count = countDocuments();
    return { content: [{ type: "text", text: JSON.stringify({ count }) }] };
  }
);

// --- Versions ---

server.registerTool(
  "add_document_version",
  {
    title: "Add Document Version",
    description: "Add a new version to a document.",
    inputSchema: {
      document_id: z.string(),
      file_path: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async (params) => {
    const ver = addVersion(params);
    return { content: [{ type: "text", text: JSON.stringify(ver, null, 2) }] };
  }
);

server.registerTool(
  "list_document_versions",
  {
    title: "List Document Versions",
    description: "List all versions for a document.",
    inputSchema: { document_id: z.string() },
  },
  async ({ document_id }) => {
    const versions = listVersions(document_id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ versions, count: versions.length }, null, 2) },
      ],
    };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-documents MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
