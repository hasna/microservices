/**
 * Search HTTP routes.
 */

import type { Sql } from "postgres";
import { z } from "zod";
import {
  deleteCollection,
  deleteDocument,
  getDocument,
  indexDocument,
  listCollections,
} from "../lib/index_ops.js";
import { search, countDocuments } from "../lib/search_ops.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

const IndexSchema = z.object({
  collection: z.string().min(1),
  doc_id: z.string().min(1),
  content: z.string().min(1),
  workspace_id: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const QuerySchema = z.object({
  text: z.string().min(1),
  collection: z.string().optional(),
  workspace_id: z.string().uuid().optional(),
  mode: z.enum(["text", "semantic", "hybrid"]).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const DeleteDocSchema = z.object({
  collection: z.string().min(1),
  doc_id: z.string().min(1),
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
          return json({
            ok: true,
            service: "microservice-search",
            db: true,
            latency_ms: Date.now() - start,
          });
        } catch (e) {
          return json(
            {
              ok: false,
              service: "microservice-search",
              db: false,
              error: e instanceof Error ? e.message : "db error",
            },
            503,
          );
        }
      }

      // POST /search/index
      if (method === "POST" && path === "/search/index") {
        const parsed = await parseBody(req, IndexSchema);
        if ("error" in parsed) return parsed.error;
        await indexDocument(sql, {
          collection: parsed.data.collection,
          docId: parsed.data.doc_id,
          content: parsed.data.content,
          workspaceId: parsed.data.workspace_id,
          metadata: parsed.data.metadata,
        });
        return json({ ok: true });
      }

      // POST /search/query
      if (method === "POST" && path === "/search/query") {
        const parsed = await parseBody(req, QuerySchema);
        if ("error" in parsed) return parsed.error;
        const results = await search(sql, {
          text: parsed.data.text,
          collection: parsed.data.collection,
          workspaceId: parsed.data.workspace_id,
          mode: parsed.data.mode,
          limit: parsed.data.limit,
        });
        return json({ results, count: results.length });
      }

      // DELETE /search/documents
      if (method === "DELETE" && path === "/search/documents") {
        const parsed = await parseBody(req, DeleteDocSchema);
        if ("error" in parsed) return parsed.error;
        const deleted = await deleteDocument(
          sql,
          parsed.data.collection,
          parsed.data.doc_id,
        );
        return json({ ok: deleted, deleted });
      }

      // DELETE /search/collections/:name
      if (method === "DELETE" && path.startsWith("/search/collections/")) {
        const name = decodeURIComponent(
          path.slice("/search/collections/".length),
        );
        const workspaceId = url.searchParams.get("workspace_id") ?? undefined;
        const count = await deleteCollection(sql, name, workspaceId);
        return json({ ok: true, deleted: count });
      }

      // GET /search/collections
      if (method === "GET" && path === "/search/collections") {
        const workspaceId = url.searchParams.get("workspace_id") ?? undefined;
        const collections = await listCollections(sql, workspaceId);
        return json({ collections, count: collections.length });
      }

      // GET /search/collections/:name/count
      if (method === "GET" && path.match(/^\/search\/collections\/[^/]+\/count$/)) {
        const collection = decodeURIComponent(path.split("/")[3]);
        const workspaceId = url.searchParams.get("workspace_id") ?? undefined;
        const count = await countDocuments(sql, collection, workspaceId);
        return json({ collection, count });
      }

      // GET /search/documents/:collection/:doc_id
      if (method === "GET" && path.match(/^\/search\/documents\/[^/]+\/[^/]+$/)) {
        const segments = path.split("/");
        const collection = decodeURIComponent(segments[3]);
        const docId = decodeURIComponent(segments[4]);
        const doc = await getDocument(sql, collection, docId);
        if (!doc) return apiError("NOT_FOUND", "Document not found", undefined, 404);
        return json({ found: true, document: doc });
      }

      // GET /health/full — comprehensive health report
      if (method === "GET" && path === "/health/full") {
        const start = Date.now();
        let dbOk = false;
        try {
          await sql`SELECT 1`;
          dbOk = true;
        } catch {}
        return json({
          ok: dbOk,
          service: "microservice-search",
          db: dbOk,
          latency_ms: Date.now() - start,
          version: "0.0.1",
        });
      }

      // GET /health/ready — readiness probe
      if (method === "GET" && path === "/health/ready") {
        let ready = false;
        try {
          await sql`SELECT 1`;
          ready = true;
        } catch {}
        return json({ ready, service: "microservice-search" }, ready ? 200 : 503);
      }

      // GET /health/live — liveness probe
      if (method === "GET" && path === "/health/live") {
        return json({ alive: true, service: "microservice-search" });
      }

      return apiError("NOT_FOUND", "Not found", undefined, 404);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      return json({ error: msg }, 500);
    }
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function apiError(
  code: string,
  message: string,
  fields?: Record<string, string>,
  status = 400,
): Response {
  return json(
    { error: { code, message, ...(fields ? { fields } : {}) } },
    status,
  );
}

async function parseBody<T>(
  req: Request,
  schema: z.ZodSchema<T>,
): Promise<{ data: T } | { error: Response }> {
  try {
    const raw = await req.json();
    const result = schema.safeParse(raw);
    if (!result.success) {
      const fields = Object.fromEntries(
        result.error.errors.map((e) => [e.path.join(".") || "body", e.message]),
      );
      return {
        error: apiError("VALIDATION_ERROR", "Invalid request body", fields),
      };
    }
    return { data: result.data };
  } catch {
    return {
      error: apiError("INVALID_JSON", "Request body must be valid JSON"),
    };
  }
}
