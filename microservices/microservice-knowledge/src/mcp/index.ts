#!/usr/bin/env bun
/**
 * MCP server for microservice-knowledge.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { createCollection, listCollections, deleteCollection } from "../lib/collections.js";
import { listDocuments, deleteDocument } from "../lib/documents.js";
import { ingestDocument } from "../lib/ingest.js";
import { retrieve } from "../lib/retrieve.js";
import { getCollectionStats } from "../lib/stats.js";

const server = new Server(
  { name: "microservice-knowledge", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "knowledge_create_collection",
      description: "Create a new knowledge collection for storing and retrieving documents",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          name: { type: "string", description: "Collection name" },
          description: { type: "string", description: "Collection description" },
          chunk_size: { type: "number", description: "Characters per chunk (default 1000)" },
          chunk_overlap: { type: "number", description: "Overlap between chunks (default 200)" },
          chunking_strategy: { type: "string", enum: ["fixed", "paragraph", "sentence", "recursive"], description: "Chunking strategy (default recursive)" },
          embedding_model: { type: "string", description: "Embedding model (default text-embedding-3-small)" },
        },
        required: ["workspace_id", "name"],
      },
    },
    {
      name: "knowledge_ingest",
      description: "Ingest a document into a collection: chunk, embed, and index for retrieval",
      inputSchema: {
        type: "object",
        properties: {
          collection_id: { type: "string", description: "Collection ID" },
          title: { type: "string", description: "Document title" },
          content: { type: "string", description: "Document content" },
          source_type: { type: "string", enum: ["text", "url", "file"], description: "Source type (default text)" },
          source_url: { type: "string", description: "Source URL if applicable" },
          metadata: { type: "object", description: "Additional metadata" },
        },
        required: ["collection_id", "title", "content"],
      },
    },
    {
      name: "knowledge_retrieve",
      description: "Retrieve relevant chunks from a collection using semantic, text, or hybrid search",
      inputSchema: {
        type: "object",
        properties: {
          collection_id: { type: "string", description: "Collection ID" },
          query: { type: "string", description: "Search query" },
          mode: { type: "string", enum: ["semantic", "text", "hybrid"], description: "Search mode (default text)" },
          limit: { type: "number", description: "Max results (default 10)" },
          min_score: { type: "number", description: "Minimum relevance score" },
        },
        required: ["collection_id", "query"],
      },
    },
    {
      name: "knowledge_list_collections",
      description: "List all knowledge collections in a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "knowledge_list_documents",
      description: "List all documents in a collection",
      inputSchema: {
        type: "object",
        properties: {
          collection_id: { type: "string", description: "Collection ID" },
        },
        required: ["collection_id"],
      },
    },
    {
      name: "knowledge_delete_document",
      description: "Delete a document and its chunks from a collection",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Document ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "knowledge_get_stats",
      description: "Get statistics for a collection (doc count, chunk count, avg chunks, total tokens)",
      inputSchema: {
        type: "object",
        properties: {
          collection_id: { type: "string", description: "Collection ID" },
        },
        required: ["collection_id"],
      },
    },
    {
      name: "knowledge_reindex",
      description: "Re-chunk and re-embed all documents in a collection",
      inputSchema: {
        type: "object",
        properties: {
          collection_id: { type: "string", description: "Collection ID" },
        },
        required: ["collection_id"],
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

  if (name === "knowledge_create_collection") {
    return text(await createCollection(sql, {
      workspaceId: String(a.workspace_id),
      name: String(a.name),
      description: a.description ? String(a.description) : undefined,
      chunkSize: a.chunk_size !== undefined ? Number(a.chunk_size) : undefined,
      chunkOverlap: a.chunk_overlap !== undefined ? Number(a.chunk_overlap) : undefined,
      chunkingStrategy: a.chunking_strategy as "fixed" | "paragraph" | "sentence" | "recursive" | undefined,
      embeddingModel: a.embedding_model ? String(a.embedding_model) : undefined,
    }));
  }

  if (name === "knowledge_ingest") {
    return text(await ingestDocument(sql, String(a.collection_id), {
      title: String(a.title),
      content: String(a.content),
      sourceType: a.source_type as "text" | "url" | "file" | undefined,
      sourceUrl: a.source_url ? String(a.source_url) : undefined,
      metadata: a.metadata as Record<string, unknown> | undefined,
    }));
  }

  if (name === "knowledge_retrieve") {
    return text(await retrieve(sql, String(a.collection_id), String(a.query), {
      mode: a.mode as "semantic" | "text" | "hybrid" | undefined,
      limit: a.limit !== undefined ? Number(a.limit) : undefined,
      minScore: a.min_score !== undefined ? Number(a.min_score) : undefined,
    }));
  }

  if (name === "knowledge_list_collections") {
    return text(await listCollections(sql, String(a.workspace_id)));
  }

  if (name === "knowledge_list_documents") {
    return text(await listDocuments(sql, String(a.collection_id)));
  }

  if (name === "knowledge_delete_document") {
    return text({ deleted: await deleteDocument(sql, String(a.id)) });
  }

  if (name === "knowledge_get_stats") {
    return text(await getCollectionStats(sql, String(a.collection_id)));
  }

  if (name === "knowledge_reindex") {
    const collectionId = String(a.collection_id);
    const { getCollection } = await import("../lib/collections.js");
    const { chunkText, estimateTokens } = await import("../lib/chunking.js");
    const { generateEmbedding } = await import("../lib/embeddings.js");

    const collection = await getCollection(sql, collectionId);
    if (!collection) throw new Error(`Collection not found: ${collectionId}`);

    await sql`DELETE FROM knowledge.chunks WHERE collection_id = ${collectionId}`;
    await sql`UPDATE knowledge.collections SET chunk_count = 0 WHERE id = ${collectionId}`;

    const docs = await listDocuments(sql, collectionId);
    let totalChunks = 0;

    for (const doc of docs) {
      try {
        await sql`UPDATE knowledge.documents SET status = 'pending', chunk_count = 0, error = NULL WHERE id = ${doc.id}`;

        const chunks = chunkText(doc.content, {
          strategy: collection.chunking_strategy,
          chunkSize: collection.chunk_size,
          chunkOverlap: collection.chunk_overlap,
        });

        const hasPgvector = await checkPgvector(sql);

        for (let i = 0; i < chunks.length; i++) {
          const chunkContent = chunks[i]!;
          const tokenCount = estimateTokens(chunkContent);
          const embedding = await generateEmbedding(chunkContent);
          const chunkMeta = { ...(doc.metadata ?? {}), chunk_index: i, total_chunks: chunks.length, document_title: doc.title };

          if (hasPgvector && embedding) {
            await sql`
              INSERT INTO knowledge.chunks (document_id, collection_id, content, chunk_index, token_count, metadata, embedding)
              VALUES (${doc.id}, ${collectionId}, ${chunkContent}, ${i}, ${tokenCount}, ${sql.json(chunkMeta)}, ${`[${embedding.join(",")}]`})
            `;
          } else {
            await sql`
              INSERT INTO knowledge.chunks (document_id, collection_id, content, chunk_index, token_count, metadata)
              VALUES (${doc.id}, ${collectionId}, ${chunkContent}, ${i}, ${tokenCount}, ${sql.json(chunkMeta)})
            `;
          }
        }

        await sql`UPDATE knowledge.documents SET status = 'ready', chunk_count = ${chunks.length} WHERE id = ${doc.id}`;
        totalChunks += chunks.length;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await sql`UPDATE knowledge.documents SET status = 'error', error = ${errorMsg} WHERE id = ${doc.id}`;
      }
    }

    await sql`UPDATE knowledge.collections SET chunk_count = ${totalChunks} WHERE id = ${collectionId}`;
    return text({ ok: true, documents: docs.length, chunks: totalChunks });
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function checkPgvector(sql: ReturnType<typeof getDb>): Promise<boolean> {
  try {
    const [row] = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'knowledge' AND table_name = 'chunks' AND column_name = 'embedding'
    `;
    return !!row;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const sql = getDb();
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
