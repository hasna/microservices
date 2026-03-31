/**
 * LLM HTTP routes.
 */

import { z } from "zod";
import type { Sql } from "postgres";
import { chat } from "../lib/gateway.js";
import { getWorkspaceUsage } from "../lib/usage.js";
import { getAvailableModels } from "../lib/providers.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const ChatSchema = z.object({
  workspace_id: z.string().uuid(),
  messages: z.array(z.object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string(),
  })).min(1),
  model: z.string().optional(),
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
          return json({ ok: true, service: "microservice-llm", db: true, latency_ms: Date.now() - start });
        } catch (e) {
          return json({ ok: false, service: "microservice-llm", db: false, error: e instanceof Error ? e.message : "db error" }, 503);
        }
      }

      // POST /llm/chat
      if (method === "POST" && path === "/llm/chat") {
        const parsed = await parseBody(req, ChatSchema);
        if ("error" in parsed) return parsed.error;
        const result = await chat(sql, {
          workspaceId: parsed.data.workspace_id,
          messages: parsed.data.messages,
          model: parsed.data.model,
        });
        return json(result);
      }

      // GET /llm/models
      if (method === "GET" && path === "/llm/models") {
        const models = getAvailableModels();
        return json({ models, count: models.length });
      }

      // GET /llm/usage/:workspace_id
      if (method === "GET" && path.startsWith("/llm/usage/")) {
        const workspaceId = path.slice("/llm/usage/".length);
        if (!workspaceId) return apiError("BAD_REQUEST", "workspace_id is required");
        const sinceParam = url.searchParams.get("since");
        const since = sinceParam ? new Date(sinceParam) : undefined;
        const usage = await getWorkspaceUsage(sql, workspaceId, since);
        return json(usage);
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

function apiError(code: string, message: string, fields?: Record<string, string>, status = 400): Response {
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
