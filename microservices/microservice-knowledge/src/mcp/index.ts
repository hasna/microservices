#!/usr/bin/env bun
/**
 * MCP server for microservice-knowledge.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { createCollection, listCollections } from "../lib/collections.js";
import { deleteDocument, listDocuments } from "../lib/documents.js";
import { ingestDocument } from "../lib/ingest.js";
import { retrieve } from "../lib/retrieve.js";
import { getCollectionStats } from "../lib/stats.js";

const server = new McpServer({
  name: "microservice-knowledge",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

server.tool(
  "knowledge_create_collection",
  "Create a new knowledge collection for storing and retrieving documents",
  {
    workspace_id: z.string().describe("Workspace ID"),
    name: z.string().describe("Collection name"),
    description: z.string().optional().describe("Collection description"),
    chunk_size: z.number().optional().default(1000).describe("Characters per chunk"),
    chunk_overlap: z.number().optional().default(200).describe("Overlap between chunks"),
    chunking_strategy: z.enum(["fixed", "paragraph", "sentence", "recursive"]).optional().default("recursive").describe("Chunking strategy"),
    embedding_model: z.string().optional().default("text-embedding-3-small").describe("Embedding model"),
  },
  async ({ workspace_id, name, chunk_size, chunk_overlap, chunking_strategy, embedding_model, ...rest }) =>
    text(
      await createCollection(sql, {
        workspaceId: workspace_id,
        name,
        chunkSize: chunk_size,
        chunkOverlap: chunk_overlap,
        chunkingStrategy: chunking_strategy,
        embeddingModel: embedding_model,
        ...rest,
      }),
    ),
);

server.tool(
  "knowledge_ingest",
  "Ingest a document into a collection: chunk, embed, and index for retrieval",
  {
    collection_id: z.string().describe("Collection ID"),
    title: z.string().describe("Document title"),
    content: z.string().describe("Document content"),
    source_type: z.enum(["text", "url", "file"]).optional().default("text").describe("Source type"),
    source_url: z.string().optional().describe("Source URL if applicable"),
    metadata: z.record(z.any()).optional().describe("Additional metadata"),
  },
  async ({ collection_id, title, content, source_type, source_url, metadata }) =>
    text(
      await ingestDocument(sql, collection_id, {
        title,
        content,
        sourceType: source_type,
        sourceUrl: source_url,
        metadata,
      }),
    ),
);

server.tool(
  "knowledge_retrieve",
  "Retrieve relevant chunks from a collection using semantic, text, or hybrid search",
  {
    collection_id: z.string().describe("Collection ID"),
    query: z.string().describe("Search query"),
    mode: z.enum(["semantic", "text", "hybrid"]).optional().default("text").describe("Search mode"),
    limit: z.number().optional().default(10).describe("Max results"),
    min_score: z.number().optional().describe("Minimum relevance score"),
  },
  async ({ collection_id, query, ...opts }) =>
    text(await retrieve(sql, collection_id, query, opts)),
);

server.tool(
  "knowledge_list_collections",
  "List all knowledge collections in a workspace",
  { workspace_id: z.string().describe("Workspace ID") },
  async ({ workspace_id }) => text(await listCollections(sql, workspace_id)),
);

server.tool(
  "knowledge_list_documents",
  "List all documents in a collection",
  { collection_id: z.string().describe("Collection ID") },
  async ({ collection_id }) => text(await listDocuments(sql, collection_id)),
);

server.tool(
  "knowledge_delete_document",
  "Delete a document and its chunks from a collection",
  { id: z.string().describe("Document ID") },
  async ({ id }) => text({ deleted: await deleteDocument(sql, id) }),
);

server.tool(
  "knowledge_get_stats",
  "Get statistics for a collection (doc count, chunk count, avg chunks, total tokens)",
  { collection_id: z.string().describe("Collection ID") },
  async ({ collection_id }) => text(await getCollectionStats(sql, collection_id)),
);

server.tool(
  "knowledge_reindex",
  "Re-chunk and re-embed all documents in a collection",
  { collection_id: z.string().describe("Collection ID") },
  async ({ collection_id }) => {
    const { getCollection } = await import("../lib/collections.js");
    const { chunkText, estimateTokens } = await import("../lib/chunking.js");
    const { generateEmbedding } = await import("../lib/embeddings.js");

    const collection = await getCollection(sql, collection_id);
    if (!collection) throw new Error(`Collection not found: ${collection_id}`);

    await sql`DELETE FROM knowledge.chunks WHERE collection_id = ${collection_id}`;
    await sql`UPDATE knowledge.collections SET chunk_count = 0 WHERE id = ${collection_id}`;

    const docs = await listDocuments(sql, collection_id);
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
          const chunkMeta = {
            ...(doc.metadata ?? {}),
            chunk_index: i,
            total_chunks: chunks.length,
            document_title: doc.title,
          };

          if (hasPgvector && embedding) {
            await sql`
              INSERT INTO knowledge.chunks (document_id, collection_id, content, chunk_index, token_count, metadata, embedding)
              VALUES (${doc.id}, ${collection_id}, ${chunkContent}, ${i}, ${tokenCount}, ${sql.json(chunkMeta)}, ${`[${embedding.join(",")}]`})
            `;
          } else {
            await sql`
              INSERT INTO knowledge.chunks (document_id, collection_id, content, chunk_index, token_count, metadata)
              VALUES (${doc.id}, ${collection_id}, ${chunkContent}, ${i}, ${tokenCount}, ${sql.json(chunkMeta)})
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

    await sql`UPDATE knowledge.collections SET chunk_count = ${totalChunks} WHERE id = ${collection_id}`;
    return text({ ok: true, documents: docs.length, chunks: totalChunks });
  },
);

async function checkPgvector(sql: any): Promise<boolean> {
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
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
