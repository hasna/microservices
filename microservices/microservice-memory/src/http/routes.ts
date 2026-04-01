/**
 * Memory HTTP routes.
 */

import type { Sql } from "postgres";
import { z } from "zod";
import { createCollection, listCollections } from "../lib/collections.js";
import {
  deleteMemory,
  getMemory,
  listMemories,
  searchMemories,
  storeMemory,
  updateMemoryImportance,
} from "../lib/memories.js";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export function apiError(
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

const StoreSchema = z.object({
  workspace_id: z.string().min(1),
  user_id: z.string().optional(),
  collection_id: z.string().optional(),
  content: z.string().min(1),
  summary: z.string().optional(),
  importance: z.number().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).optional(),
  expires_at: z.string().datetime().optional(),
});

const SearchSchema = z.object({
  workspace_id: z.string().min(1),
  user_id: z.string().optional(),
  text: z.string().min(1),
  mode: z.enum(["semantic", "text", "hybrid"]).optional(),
  limit: z.number().int().positive().optional(),
  collection_id: z.string().optional(),
});

const CollectionCreateSchema = z.object({
  workspace_id: z.string().min(1),
  user_id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
});

const UpdateImportanceSchema = z.object({
  importance: z.number().min(0).max(1),
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
            service: "microservice-memory",
            db: true,
            latency_ms: Date.now() - start,
          });
        } catch (e) {
          return json(
            {
              ok: false,
              service: "microservice-memory",
              db: false,
              error: e instanceof Error ? e.message : "db error",
            },
            503,
          );
        }
      }

      // POST /memory/store
      if (method === "POST" && path === "/memory/store") {
        const parsed = await parseBody(req, StoreSchema);
        if ("error" in parsed) return parsed.error;
        const {
          workspace_id,
          user_id,
          collection_id,
          content,
          summary,
          importance,
          metadata,
          expires_at,
        } = parsed.data;
        const mem = await storeMemory(sql, {
          workspaceId: workspace_id,
          userId: user_id,
          collectionId: collection_id,
          content,
          summary,
          importance,
          metadata: metadata as any | undefined,
          expiresAt: expires_at ? new Date(expires_at) : undefined,
        });
        return json(mem, 201);
      }

      // POST /memory/search
      if (method === "POST" && path === "/memory/search") {
        const parsed = await parseBody(req, SearchSchema);
        if ("error" in parsed) return parsed.error;
        const { workspace_id, user_id, text, mode, limit, collection_id } =
          parsed.data;
        const results = await searchMemories(sql, {
          workspaceId: workspace_id,
          userId: user_id,
          text,
          mode,
          limit,
          collectionId: collection_id,
        });
        return json({ data: results, count: results.length });
      }

      // GET /memory/list
      if (method === "GET" && path === "/memory/list") {
        const workspaceId = url.searchParams.get("workspace_id");
        if (!workspaceId)
          return apiError("VALIDATION_ERROR", "workspace_id is required");
        const userId = url.searchParams.get("user_id") ?? undefined;
        const limit = url.searchParams.get("limit")
          ? parseInt(url.searchParams.get("limit")!, 10)
          : undefined;
        const mems = await listMemories(sql, workspaceId, userId, limit);
        return json({ data: mems, count: mems.length });
      }

      // GET /memory/collections
      if (method === "GET" && path === "/memory/collections") {
        const workspaceId = url.searchParams.get("workspace_id");
        if (!workspaceId)
          return apiError("VALIDATION_ERROR", "workspace_id is required");
        const userId = url.searchParams.get("user_id") ?? undefined;
        const cols = await listCollections(sql, workspaceId, userId);
        return json({ data: cols, count: cols.length });
      }

      // POST /memory/collections
      if (method === "POST" && path === "/memory/collections") {
        const parsed = await parseBody(req, CollectionCreateSchema);
        if ("error" in parsed) return parsed.error;
        const { workspace_id, user_id, name, description } = parsed.data;
        const col = await createCollection(sql, {
          workspaceId: workspace_id,
          userId: user_id,
          name,
          description,
        });
        return json(col, 201);
      }

      // GET /memory/:id
      if (
        method === "GET" &&
        path.match(/^\/memory\/[^/]+$/) &&
        !path.startsWith("/memory/list") &&
        !path.startsWith("/memory/collections")
      ) {
        const id = path.split("/").pop()!;
        const mem = await getMemory(sql, id);
        if (!mem)
          return apiError("NOT_FOUND", "Memory not found", undefined, 404);
        return json(mem);
      }

      // DELETE /memory/:id
      if (method === "DELETE" && path.match(/^\/memory\/[^/]+$/)) {
        const id = path.split("/").pop()!;
        const ok = await deleteMemory(sql, id);
        return json({ ok });
      }

      // PATCH /memory/:id/importance
      if (method === "PATCH" && path.match(/^\/memory\/[^/]+\/importance$/)) {
        const parts = path.split("/");
        const id = parts[2];
        const parsed = await parseBody(req, UpdateImportanceSchema);
        if ("error" in parsed) return parsed.error;
        await updateMemoryImportance(sql, id, parsed.data.importance);
        return json({ ok: true });
      }

      return apiError("NOT_FOUND", "Not found", undefined, 404);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      return json({ error: msg }, 500);
    }
  };
}
