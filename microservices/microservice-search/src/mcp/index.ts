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
  deleteCollection,
  deleteDocument,
  getDocument,
  batchIndexDocuments,
  indexDocument,
  listCollections,
  updateDocument,
} from "../lib/index_ops.js";
import { countDocuments, facetedSearch, multiCollectionSearch, autocomplete, search, similarByEmbedding } from "../lib/search_ops.js";
import { generateEmbedding } from "../lib/embeddings.js";

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
    {
      name: "search_delete_collection",
      description: "Delete an entire collection and all its documents",
      inputSchema: {
        type: "object",
        properties: {
          collection: { type: "string" },
          workspace_id: { type: "string" },
        },
        required: ["collection"],
      },
    },
    {
      name: "search_generate_embedding",
      description: "Generate an embedding vector for a text string (for debugging/development)",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          model: { type: "string" },
        },
        required: ["text"],
      },
    },
    {
      name: "search_reindex_collection",
      "description": "Re-index all documents in a collection by deleting and recreating (use with caution)",
      inputSchema: {
        type: "object",
        properties: {
          collection: { type: "string" },
          workspace_id: { type: "string" },
        },
        required: ["collection"],
      },
    },
    {
      name: "search_get_document",
      "description": "Get a specific document by collection and doc_id",
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
      name: "search_batch_index",
      "description": "Index multiple documents in a single batch operation",
      inputSchema: {
        type: "object",
        properties: {
          documents: {
            type: "array",
            items: {
              type: "object",
              properties: {
                collection: { type: "string" },
                doc_id: { type: "string" },
                content: { type: "string" },
                workspace_id: { type: "string" },
                metadata: { type: "object" },
              },
              required: ["collection", "doc_id", "content"],
            },
          },
        },
        required: ["documents"],
      },
    },
    {
      name: "search_similar_by_embedding",
      "description": "Find documents similar to a given embedding vector (for reverse-image/audio search patterns)",
      inputSchema: {
        type: "object",
        properties: {
          embedding: {
            type: "array",
            items: { type: "number" },
            description: "Embedding vector (e.g. from search_generate_embedding)",
          },
          collection: { type: "string" },
          workspace_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["embedding"],
      },
    },
    {
      name: "search_delete_documents_by_query",
      description: "Delete all documents matching a text query within a collection/workspace — useful for bulk cleanup",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text query to match documents by content" },
          collection: { type: "string" },
          workspace_id: { type: "string" },
        },
        required: ["text"],
      },
    },
    {
      name: "search_workspace_stats",
      description: "Get search statistics for a workspace: document counts and sizes per collection",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "search_reroot_collection",
      description: "Rename/re-root all documents in a collection to a new collection name (move documents atomically)",
      inputSchema: {
        type: "object",
        properties: {
          from_collection: { type: "string" },
          to_collection: { type: "string" },
          workspace_id: { type: "string" },
        },
        required: ["from_collection", "to_collection"],
      },
    },
    {
      name: "search_update_document",
      description: "Update specific fields of an existing document (fails if document does not exist — use search_index for upsert)",
      inputSchema: {
        type: "object",
        properties: {
          collection: { type: "string", description: "Collection name" },
          doc_id: { type: "string", description: "Document ID" },
          content: { type: "string", description: "New content (omit to leave unchanged)" },
          workspace_id: { type: "string", description: "New workspace ID (omit to leave unchanged)" },
          metadata: { type: "object", description: "New metadata (omit to leave unchanged)" },
        },
        required: ["collection", "doc_id"],
      },
    },
    {
      name: "search_faceted",
      description: "Search with aggregated facet counts grouped by a metadata field — useful for building filter UI",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Search query text" },
          collection: { type: "string", description: "Limit to this collection" },
          workspace_id: { type: "string", description: "Limit to this workspace" },
          mode: { type: "string", enum: ["text", "semantic", "hybrid"], description: "Search mode (default: text)" },
          limit: { type: "number", description: "Max results to return (default: 10)" },
          facet_field: { type: "string", description: "Metadata JSONB field to group counts by (e.g. 'category')" },
          facet_limit: { type: "number", description: "Max facet values to return (default: 20)" },
        },
        required: ["text", "facet_field"],
      },
    },
    {
      name: "search_multi_collection",
      description: "Search across multiple collections simultaneously and merge results by score",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Search query text" },
          collections: { type: "array", items: { type: "string" }, description: "List of collection names to search" },
          workspace_id: { type: "string", description: "Limit to this workspace" },
          mode: { type: "string", enum: ["text", "semantic", "hybrid"], description: "Search mode (default: text)" },
          limit: { type: "number", description: "Max results to return (default: 10)" },
        },
        required: ["text", "collections"],
      },
    },
    {
      name: "search_autocomplete",
      description: "Prefix-based document completion (ILIKE prefix match) — useful for typeahead/autocomplete UI",
      inputSchema: {
        type: "object",
        properties: {
          prefix: { type: "string", description: "Prefix string to match against document content" },
          collection: { type: "string", description: "Limit to this collection" },
          workspace_id: { type: "string", description: "Limit to this workspace" },
          limit: { type: "number", description: "Max suggestions to return (default: 10)" },
        },
        required: ["prefix"],
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

  if (name === "search_delete_collection") {
    const deleted = await deleteCollection(
      sql,
      String(a.collection),
      a.workspace_id ? String(a.workspace_id) : undefined,
    );
    return text({ deleted });
  }

  if (name === "search_generate_embedding") {
    const embedding = await generateEmbedding(
      String(a.text),
      a.model ? String(a.model) : undefined,
    );
    return text({ text: a.text, model: embedding.model, embedding: embedding.vector, dimension: embedding.vector.length });
  }

  if (name === "search_reindex_collection") {
    const deleted = await deleteCollection(
      sql,
      String(a.collection),
      a.workspace_id ? String(a.workspace_id) : undefined,
    );
    return text({ collection_deleted: deleted, message: "Re-indexing must be done by re-calling search_index with original documents" });
  }

  if (name === "search_get_document") {
    const doc = await getDocument(sql, String(a.collection), String(a.doc_id));
    if (!doc) return text({ found: false, message: "Document not found" });
    return text({ found: true, document: doc });
  }

  if (name === "search_batch_index") {
    const results = await batchIndexDocuments(sql, (a.documents as any[]).map((d: any) => ({
      collection: String(d.collection),
      docId: String(d.doc_id),
      content: String(d.content),
      workspaceId: d.workspace_id ? String(d.workspace_id) : undefined,
      metadata: d.metadata as any | undefined,
    })));
    return text({ batch_indexed: results.indexed, failed: results.failed });
  }

  if (name === "search_similar_by_embedding") {
    const results = await similarByEmbedding(
      sql,
      a.embedding as number[],
      a.collection ? String(a.collection) : undefined,
      a.workspace_id ? String(a.workspace_id) : undefined,
      a.limit ? Number(a.limit) : 10,
    );
    return text({ results, count: results.length });
  }

  if (name === "search_delete_documents_by_query") {
    const results = await search(sql, {
      text: String(a.text),
      collection: a.collection ? String(a.collection) : undefined,
      workspaceId: a.workspace_id ? String(a.workspace_id) : undefined,
      limit: 1000,
    });
    let deleted = 0;
    for (const r of results) {
      const ok = await deleteDocument(sql, r.collection, r.doc_id);
      if (ok) deleted++;
    }
    return text({ query: a.text, matched: results.length, deleted });
  }

  if (name === "search_workspace_stats") {
    const collections = await listCollections(sql, a.workspace_id ? String(a.workspace_id) : undefined);
    const stats = [];
    for (const col of collections) {
      const count = await countDocuments(sql, col);
      stats.push({ collection: col, count });
    }
    return text({ workspace_id: a.workspace_id, collections: stats, total_collections: stats.length });
  }

  if (name === "search_reroot_collection") {
    await sql`UPDATE search.documents SET collection = ${String(a.to_collection)} WHERE collection = ${String(a.from_collection)} AND workspace_id = ${a.workspace_id ? String(a.workspace_id) : null}`;
    return text({ moved: true, from: a.from_collection, to: a.to_collection });
  }

  if (name === "search_update_document") {
    const updated = await updateDocument(sql, String(a.collection), String(a.doc_id), {
      content: a.content ? String(a.content) : undefined,
      workspaceId: a.workspace_id ? String(a.workspace_id) : undefined,
      metadata: a.metadata as any | undefined,
    });
    if (!updated) return text({ ok: false, message: "Document not found or no fields to update" });
    return text({ ok: true, updated: true });
  }

  if (name === "search_faceted") {
    const result = await facetedSearch(sql, {
      text: String(a.text),
      collection: a.collection ? String(a.collection) : undefined,
      workspaceId: a.workspace_id ? String(a.workspace_id) : undefined,
      mode: a.mode as "text" | "semantic" | "hybrid" | undefined,
      limit: a.limit ? Number(a.limit) : 10,
      facet_field: String(a.facet_field),
      facet_limit: a.facet_limit ? Number(a.facet_limit) : 20,
    });
    return text({ results: result.results, facets: result.facets, result_count: result.results.length });
  }

  if (name === "search_multi_collection") {
    const collections = (a.collections as string[]).map(String);
    const results = await multiCollectionSearch(sql, {
      text: String(a.text),
      collections,
      workspaceId: a.workspace_id ? String(a.workspace_id) : undefined,
      mode: a.mode as "text" | "semantic" | "hybrid" | undefined,
      limit: a.limit ? Number(a.limit) : 10,
    });
    return text({ results, count: results.length, searched_collections: collections });
  }

  if (name === "search_autocomplete") {
    const suggestions = await autocomplete(
      sql,
      String(a.prefix),
      a.collection ? String(a.collection) : undefined,
      a.workspace_id ? String(a.workspace_id) : undefined,
      a.limit ? Number(a.limit) : 10,
    );
    return text({ suggestions, count: suggestions.length });
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
