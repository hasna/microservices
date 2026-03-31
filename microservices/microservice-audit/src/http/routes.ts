/**
 * Audit HTTP routes.
 */

import { z } from "zod";
import type { Sql } from "postgres";
import { logEvent, queryEvents, countEvents, getEvent, exportEvents } from "../lib/events.js";
import { setRetentionPolicy } from "../lib/retention.js";
import { getAuditStats } from "../lib/stats.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const LogEventSchema = z.object({
  actor_id: z.string().optional(),
  actor_type: z.enum(["user", "system", "api_key"]).optional(),
  action: z.string().min(1),
  resource_type: z.string().min(1),
  resource_id: z.string().optional(),
  workspace_id: z.string().optional(),
  ip: z.string().optional(),
  user_agent: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  severity: z.enum(["debug", "info", "warning", "error", "critical"]).optional(),
});

const RetentionSchema = z.object({
  workspace_id: z.string(),
  retain_days: z.number().int().positive().min(1).max(3650),
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
          return json({ ok: true, service: "microservice-audit", db: true, latency_ms: Date.now() - start });
        } catch (e) {
          return json({ ok: false, service: "microservice-audit", db: false, error: e instanceof Error ? e.message : "db error" }, 503);
        }
      }

      // POST /audit/events — log a new event
      if (method === "POST" && path === "/audit/events") {
        const parsed = await parseBody(req, LogEventSchema);
        if ("error" in parsed) return parsed.error;
        const body = parsed.data;
        const event = await logEvent(sql, {
          actorId: body.actor_id,
          actorType: body.actor_type,
          action: body.action,
          resourceType: body.resource_type,
          resourceId: body.resource_id,
          workspaceId: body.workspace_id,
          ip: body.ip ?? req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined,
          userAgent: body.user_agent ?? req.headers.get("user-agent") ?? undefined,
          metadata: body.metadata,
          severity: body.severity,
        });
        return json(event, 201);
      }

      // POST /audit/retention — set retention policy
      if (method === "POST" && path === "/audit/retention") {
        const parsed = await parseBody(req, RetentionSchema);
        if ("error" in parsed) return parsed.error;
        const { workspace_id, retain_days } = parsed.data;
        const policy = await setRetentionPolicy(sql, workspace_id, retain_days);
        return json(policy, 201);
      }

      // GET /audit/events — query events with filters
      if (method === "GET" && path === "/audit/events") {
        const filters = parseFilters(url.searchParams);
        const items = await queryEvents(sql, filters);
        return json({ data: items, count: items.length });
      }

      // GET /audit/events/:id — get single event
      if (method === "GET" && path.match(/^\/audit\/events\/[^/]+$/)) {
        const id = path.split("/").pop()!;
        const event = await getEvent(sql, id);
        if (!event) return apiError("NOT_FOUND", "Event not found", undefined, 404);
        return json(event);
      }

      // GET /audit/export — export events as JSON or CSV
      if (method === "GET" && path === "/audit/export") {
        const format = (url.searchParams.get("format") ?? "json") as "json" | "csv";
        if (format !== "json" && format !== "csv") {
          return apiError("INVALID_PARAM", "format must be json or csv");
        }
        const filters = parseFilters(url.searchParams);
        const output = await exportEvents(sql, filters, format);
        const contentType = format === "csv" ? "text/csv" : "application/json";
        return new Response(output, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Content-Disposition": `attachment; filename="audit-export.${format}"`,
            ...corsHeaders,
          },
        });
      }

      // GET /audit/count — count events with filters
      if (method === "GET" && path === "/audit/count") {
        const filters = parseFilters(url.searchParams);
        const count = await countEvents(sql, filters);
        return json({ count });
      }

      // GET /audit/stats — stats for a workspace
      if (method === "GET" && path === "/audit/stats") {
        const workspaceId = url.searchParams.get("workspace_id");
        if (!workspaceId) return apiError("MISSING_PARAM", "workspace_id is required");
        const days = url.searchParams.get("days") ? parseInt(url.searchParams.get("days")!, 10) : 30;
        const stats = await getAuditStats(sql, workspaceId, days);
        return json(stats);
      }

      return apiError("NOT_FOUND", "Not found", undefined, 404);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      return apiError("INTERNAL_ERROR", msg, undefined, 500);
    }
  };
}

function parseFilters(params: URLSearchParams) {
  return {
    workspaceId: params.get("workspace_id") ?? undefined,
    actorId: params.get("actor_id") ?? undefined,
    action: params.get("action") ?? undefined,
    resourceType: params.get("resource_type") ?? undefined,
    resourceId: params.get("resource_id") ?? undefined,
    severity: params.get("severity") as "debug" | "info" | "warning" | "error" | "critical" | undefined,
    from: params.get("from") ? new Date(params.get("from")!) : undefined,
    to: params.get("to") ? new Date(params.get("to")!) : undefined,
    limit: params.get("limit") ? parseInt(params.get("limit")!, 10) : undefined,
    offset: params.get("offset") ? parseInt(params.get("offset")!, 10) : undefined,
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
