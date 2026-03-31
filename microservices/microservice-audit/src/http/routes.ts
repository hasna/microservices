/**
 * Audit HTTP routes.
 */

import type { Sql } from "postgres";
import { logEvent, queryEvents, countEvents, getEvent, exportEvents } from "../lib/events.js";
import { setRetentionPolicy } from "../lib/retention.js";

export function makeRouter(sql: Sql) {
  return async function router(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      // GET /health
      if (method === "GET" && path === "/health") {
        return json({ ok: true, service: "microservice-audit" });
      }

      // POST /audit/events — log a new event
      if (method === "POST" && path === "/audit/events") {
        const body = await req.json();
        const { action, resource_type } = body;
        if (!action || !resource_type) {
          return json({ error: "action and resource_type are required" }, 400);
        }
        const event = await logEvent(sql, {
          actorId: body.actor_id,
          actorType: body.actor_type,
          action,
          resourceType: resource_type,
          resourceId: body.resource_id,
          workspaceId: body.workspace_id,
          ip: body.ip ?? req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined,
          userAgent: body.user_agent ?? req.headers.get("user-agent") ?? undefined,
          metadata: body.metadata,
          severity: body.severity,
        });
        return json(event, 201);
      }

      // GET /audit/events — query events with filters
      if (method === "GET" && path === "/audit/events") {
        const filters = parseFilters(url.searchParams);
        const events = await queryEvents(sql, filters);
        return json({ events, count: events.length });
      }

      // GET /audit/events/:id — get single event
      if (method === "GET" && path.match(/^\/audit\/events\/[^/]+$/)) {
        const id = path.split("/").pop()!;
        const event = await getEvent(sql, id);
        if (!event) return json({ error: "Event not found" }, 404);
        return json(event);
      }

      // GET /audit/export — export events as JSON or CSV
      if (method === "GET" && path === "/audit/export") {
        const format = (url.searchParams.get("format") ?? "json") as "json" | "csv";
        if (format !== "json" && format !== "csv") {
          return json({ error: "format must be json or csv" }, 400);
        }
        const filters = parseFilters(url.searchParams);
        const output = await exportEvents(sql, filters, format);
        const contentType = format === "csv" ? "text/csv" : "application/json";
        return new Response(output, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Content-Disposition": `attachment; filename="audit-export.${format}"`,
          },
        });
      }

      // GET /audit/count — count events with filters
      if (method === "GET" && path === "/audit/count") {
        const filters = parseFilters(url.searchParams);
        const count = await countEvents(sql, filters);
        return json({ count });
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      return json({ error: msg }, 500);
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
    headers: { "Content-Type": "application/json" },
  });
}
