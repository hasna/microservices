/**
 * Knowledge HTTP routes.
 */

import { z } from "zod";
import type { Sql } from "postgres";
import { createCollection, getCollection, listCollections, deleteCollection } from "../lib/collections.js";
import { listDocuments, deleteDocument } from "../lib/documents.js";
import { ingestDocument } from "../lib/ingest.js";
import { retrieve } from "../lib/retrieve.js";
import { getCollectionStats } from "../lib/stats.js";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export function apiError(code: string, message: string, fields?: Record<string, string>, status = 400): Response {
  return json({ error: { code, message, ...(fields ? { fields } : {}) } }, status);
}

async function parseBody<T>(req: Request, schema: z.ZodSchema<T>): Promise<{ data: T } | { error: Response }> {
  try {
    const raw = await req.json();
    const result = schema.safeParse(raw);
    if (!result.success) {
      const fields = Object.fromEntries(result.error.errors.map(e => [e.path.join(".") || "body", e.message]));
      return { error: apiError("VALIDATION_ERROR", "Invalid request body", fields) };
    }
    return { data: result.data };
  } catch {
    return { error: apiError("INVALID_JSON", "Request body must be valid JSON") };
  }
}

const CreateCollectionSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  chunk_size: z.number().int().positive().optional(),
  chunk_overlap: z.number().int().min(0).optional(),
  chunking_strategy: z.enum(["fixed", "paragraph", "sentence", "recursive"]).optional(),
  embedding_model: z.string().optional(),
});

const IngestSchema = z.object({
  collection_id: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
  source_type: z.enum(["text", "url", "file"]).optional(),
  source_url: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const RetrieveSchema = z.object({
  collection_id: z.string().min(1),
  query: z.string().min(1),
  mode: z.enum(["semantic", "text", "hybrid"]).optional(),
  limit: z.number().int().positive().optional(),
  min_score: z.number().optional(),
});

export function makeRouter(sql: Sql) {
  return async function router(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      // GET /health
      if (method === "GET" && path === "/health") {
        try {
          const start = Date.now();
          await sql`SELECT 1`;
          return json({ ok: true, service: "microservice-knowledge", db: true, latency_ms: Date.now() - start });
        } catch (e) {
          return json({ ok: false, service: "microservice-knowledge", db: false, error: e instanceof Error ? e.message : "db error" }, 503);
        }
      }

      // POST /knowledge/collections
      if (method === "POST" && path === "/knowledge/collections") {
        const parsed = await parseBody(req, CreateCollectionSchema);
        if ("error" in parsed) return parsed.error;
        const { workspace_id, name, description, chunk_size, chunk_overlap, chunking_strategy, embedding_model } = parsed.data;
        const col = await createCollection(sql, {
          workspaceId: workspace_id,
          name,
          description,
          chunkSize: chunk_size,
          chunkOverlap: chunk_overlap,
          chunkingStrategy: chunking_strategy,
          embeddingModel: embedding_model,
        });
        return json(col, 201);
      }

      // GET /knowledge/collections?workspace_id=
      if (method === "GET" && path === "/knowledge/collections") {
        const workspaceId = url.searchParams.get("workspace_id");
        if (!workspaceId) return apiError("VALIDATION_ERROR", "workspace_id is required");
        const cols = await listCollections(sql, workspaceId);
        return json({ data: cols, count: cols.length });
      }

      // GET /knowledge/collections/:id/stats
      if (method === "GET" && path.match(/^\/knowledge\/collections\/[^/]+\/stats$/)) {
        const parts = path.split("/");
        const id = parts[3]!;
        const stats = await getCollectionStats(sql, id);
        return json(stats);
      }

      // POST /knowledge/collections/:id/reindex
      if (method === "POST" && path.match(/^\/knowledge\/collections\/[^/]+\/reindex$/)) {
        const parts = path.split("/");
        const id = parts[3]!;
        const collection = await getCollection(sql, id);
        if (!collection) return apiError("NOT_FOUND", "Collection not found", undefined, 404);

        // Delete all chunks and re-ingest all documents
        await sql`DELETE FROM knowledge.chunks WHERE collection_id = ${id}`;
        await sql`UPDATE knowledge.collections SET chunk_count = 0 WHERE id = ${id}`;

        const docs = await listDocuments(sql, id);
        let totalChunks = 0;
        for (const doc of docs) {
          try {
            // Reset document chunk count
            await sql`UPDATE knowledge.documents SET status = 'pending', chunk_count = 0, error = NULL WHERE id = ${doc.id}`;
            // Delete existing chunks for this doc (already done above)
            // Re-ingest by inserting chunks directly
            const { chunkText, estimateTokens } = await import("../lib/chunking.js");
            const { generateEmbedding } = await import("../lib/embeddings.js");

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
                  VALUES (${doc.id}, ${id}, ${chunkContent}, ${i}, ${tokenCount}, ${sql.json(chunkMeta)}, ${`[${embedding.join(",")}]`})
                `;
              } else {
                await sql`
                  INSERT INTO knowledge.chunks (document_id, collection_id, content, chunk_index, token_count, metadata)
                  VALUES (${doc.id}, ${id}, ${chunkContent}, ${i}, ${tokenCount}, ${sql.json(chunkMeta)})
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

        await sql`UPDATE knowledge.collections SET chunk_count = ${totalChunks} WHERE id = ${id}`;
        return json({ ok: true, documents: docs.length, chunks: totalChunks });
      }

      // GET /knowledge/collections/:id
      if (method === "GET" && path.match(/^\/knowledge\/collections\/[^/]+$/) && !path.includes("/stats") && !path.includes("/reindex")) {
        const id = path.split("/").pop()!;
        const col = await getCollection(sql, id);
        if (!col) return apiError("NOT_FOUND", "Collection not found", undefined, 404);
        return json(col);
      }

      // DELETE /knowledge/collections/:id
      if (method === "DELETE" && path.match(/^\/knowledge\/collections\/[^/]+$/)) {
        const id = path.split("/").pop()!;
        const ok = await deleteCollection(sql, id);
        return json({ ok });
      }

      // POST /knowledge/ingest
      if (method === "POST" && path === "/knowledge/ingest") {
        const parsed = await parseBody(req, IngestSchema);
        if ("error" in parsed) return parsed.error;
        const { collection_id, title, content, source_type, source_url, metadata } = parsed.data;
        const doc = await ingestDocument(sql, collection_id, {
          title,
          content,
          sourceType: source_type,
          sourceUrl: source_url,
          metadata,
        });
        return json(doc, 201);
      }

      // GET /knowledge/documents?collection_id=
      if (method === "GET" && path === "/knowledge/documents") {
        const collectionId = url.searchParams.get("collection_id");
        if (!collectionId) return apiError("VALIDATION_ERROR", "collection_id is required");
        const docs = await listDocuments(sql, collectionId);
        return json({ data: docs, count: docs.length });
      }

      // DELETE /knowledge/documents/:id
      if (method === "DELETE" && path.match(/^\/knowledge\/documents\/[^/]+$/)) {
        const id = path.split("/").pop()!;
        const ok = await deleteDocument(sql, id);
        return json({ ok });
      }

      // POST /knowledge/retrieve
      if (method === "POST" && path === "/knowledge/retrieve") {
        const parsed = await parseBody(req, RetrieveSchema);
        if ("error" in parsed) return parsed.error;
        const { collection_id, query, mode, limit, min_score } = parsed.data;
        const results = await retrieve(sql, collection_id, query, {
          mode,
          limit,
          minScore: min_score,
        });
        return json({ data: results, count: results.length });
      }

      return apiError("NOT_FOUND", "Not found", undefined, 404);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      return json({ error: msg }, 500);
    }
  };
}

async function checkPgvector(sql: Sql): Promise<boolean> {
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
