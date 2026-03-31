/**
 * Usage HTTP routes.
 */

import { z } from "zod";
import type { Sql } from "postgres";
import { track } from "../lib/track.js";
import { getUsageSummary, checkQuota, getQuota, setQuota } from "../lib/query.js";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const TrackSchema = z.object({
  workspace_id: z.string().min(1),
  metric: z.string().min(1),
  quantity: z.number(),
  unit: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const SetQuotaSchema = z.object({
  workspace_id: z.string().min(1),
  metric: z.string().min(1),
  limit_value: z.number(),
  period: z.enum(["hour", "day", "month", "total"]).optional(),
  hard_limit: z.boolean().optional(),
});

export function makeRouter(sql: Sql) {
  return async function router(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    if (method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    try {
      // GET /health
      if (method === "GET" && path === "/health") {
        try {
          const start = Date.now();
          await sql`SELECT 1`;
          return json({ ok: true, service: "microservice-usage", db: true, latency_ms: Date.now() - start });
        } catch (e) {
          return json({ ok: false, service: "microservice-usage", db: false, error: e instanceof Error ? e.message : "db error" }, 503);
        }
      }

      // POST /usage/track
      if (method === "POST" && path === "/usage/track") {
        const parsed = await parseBody(req, TrackSchema);
        if ("error" in parsed) return parsed.error;
        const { workspace_id, metric, quantity, unit, metadata } = parsed.data;
        await track(sql, { workspaceId: workspace_id, metric, quantity, unit, metadata });
        return json({ ok: true }, 201);
      }

      // GET /usage/summary?workspace_id=X&metric=Y&since=Z
      if (method === "GET" && path === "/usage/summary") {
        const workspaceId = url.searchParams.get("workspace_id");
        if (!workspaceId) return apiError("MISSING_PARAM", "workspace_id is required");
        const metric = url.searchParams.get("metric") ?? undefined;
        const sinceParam = url.searchParams.get("since");
        const since = sinceParam ? new Date(sinceParam) : undefined;
        const data = await getUsageSummary(sql, workspaceId, metric, since);
        return json({ data });
      }

      // GET /usage/quota/:workspace_id/:metric
      if (method === "GET" && path.match(/^\/usage\/quota\/[^/]+\/[^/]+$/)) {
        const parts = path.split("/");
        const workspaceId = parts[3];
        const metric = parts[4];
        const periodParam = url.searchParams.get("period") ?? "month";
        const result = await checkQuota(sql, workspaceId, metric, periodParam);
        return json(result);
      }

      // POST /usage/quotas
      if (method === "POST" && path === "/usage/quotas") {
        const parsed = await parseBody(req, SetQuotaSchema);
        if ("error" in parsed) return parsed.error;
        const { workspace_id, metric, limit_value, period, hard_limit } = parsed.data;
        await setQuota(sql, workspace_id, metric, limit_value, period, hard_limit);
        const quota = await getQuota(sql, workspace_id, metric);
        return json(quota, 201);
      }

      return apiError("NOT_FOUND", "Not found", undefined, 404);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      return apiError("INTERNAL_ERROR", msg, undefined, 500);
    }
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export function apiError(code: string, message: string, fields?: Record<string, string>, status = 400): Response {
  return json({ error: { code, message, ...(fields ? { fields } : {}) } }, status);
}

export async function parseBody<T>(req: Request, schema: z.ZodSchema<T>): Promise<{ data: T } | { error: Response }> {
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
