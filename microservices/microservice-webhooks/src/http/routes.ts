import type { Sql } from "postgres";
import { z } from "zod";
import {
  listDeliveries,
  replayDelivery,
  triggerWebhook,
} from "../lib/deliver.js";
import {
  createEndpoint,
  deleteEndpoint,
  listWorkspaceEndpoints,
  updateEndpoint,
} from "../lib/endpoints.js";

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

const RegisterEndpointSchema = z.object({
  workspace_id: z.string().uuid(),
  url: z.string().url(),
  secret: z.string().optional(),
  events: z.array(z.string()).optional(),
});

const UpdateEndpointSchema = z.object({
  url: z.string().url().optional(),
  secret: z.string().nullable().optional(),
  events: z.array(z.string()).optional(),
  active: z.boolean().optional(),
});

const TriggerSchema = z.object({
  workspace_id: z.string().uuid(),
  event: z.string().min(1),
  payload: z.record(z.unknown()),
});

export function makeRouter(sql: Sql) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const p = url.pathname;
    const m = req.method;

    if (m === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders });

    try {
      // Health check
      if (m === "GET" && p === "/health") {
        try {
          const start = Date.now();
          await sql`SELECT 1`;
          return json({
            ok: true,
            service: "microservice-webhooks",
            db: true,
            latency_ms: Date.now() - start,
          });
        } catch (e) {
          return json(
            {
              ok: false,
              service: "microservice-webhooks",
              db: false,
              error: e instanceof Error ? e.message : "db error",
            },
            503,
          );
        }
      }

      // POST /webhooks/endpoints — register endpoint
      if (m === "POST" && p === "/webhooks/endpoints") {
        const parsed = await parseBody(req, RegisterEndpointSchema);
        if ("error" in parsed) return parsed.error;
        const ep = await createEndpoint(sql, parsed.data);
        return json(ep, 201);
      }

      // GET /webhooks/endpoints?workspace_id=X
      if (m === "GET" && p === "/webhooks/endpoints") {
        const workspaceId = url.searchParams.get("workspace_id");
        if (!workspaceId)
          return apiError("MISSING_PARAM", "workspace_id is required");
        const endpoints = await listWorkspaceEndpoints(sql, workspaceId);
        return json({ data: endpoints, count: endpoints.length });
      }

      // PATCH /webhooks/endpoints/:id
      if (m === "PATCH" && p.match(/^\/webhooks\/endpoints\/[^/]+$/)) {
        const id = p.split("/")[3];
        const parsed = await parseBody(req, UpdateEndpointSchema);
        if ("error" in parsed) return parsed.error;
        const ep = await updateEndpoint(sql, id, parsed.data);
        if (!ep) return json({ error: "Not found" }, 404);
        return json(ep);
      }

      // DELETE /webhooks/endpoints/:id
      if (m === "DELETE" && p.match(/^\/webhooks\/endpoints\/[^/]+$/)) {
        const id = p.split("/")[3];
        const deleted = await deleteEndpoint(sql, id);
        return json({ deleted });
      }

      // POST /webhooks/trigger
      if (m === "POST" && p === "/webhooks/trigger") {
        const parsed = await parseBody(req, TriggerSchema);
        if ("error" in parsed) return parsed.error;
        await triggerWebhook(
          sql,
          parsed.data.workspace_id,
          parsed.data.event,
          parsed.data.payload,
        );
        return json({ ok: true }, 202);
      }

      // GET /webhooks/deliveries?workspace_id=X&status=Y
      if (m === "GET" && p === "/webhooks/deliveries") {
        const workspaceId = url.searchParams.get("workspace_id") ?? undefined;
        const status = url.searchParams.get("status") ?? undefined;
        const deliveries = await listDeliveries(sql, { workspaceId, status });
        return json({ data: deliveries, count: deliveries.length });
      }

      // POST /webhooks/deliveries/:id/replay
      if (m === "POST" && p.match(/^\/webhooks\/deliveries\/[^/]+\/replay$/)) {
        const id = p.split("/")[3];
        await replayDelivery(sql, id);
        return json({ ok: true });
      }

      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json(
        { error: e instanceof Error ? e.message : "Server error" },
        500,
      );
    }
  };
}
