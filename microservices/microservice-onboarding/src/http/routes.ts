/**
 * Onboarding HTTP routes.
 */

import type { Sql } from "postgres";
import { z } from "zod";
import { createFlow, getFlow, listFlows } from "../lib/flows.js";
import {
  getProgress,
  getUserFlows,
  markStep,
  resetProgress,
  startFlow,
} from "../lib/progress.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const CreateFlowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      description: z.string().optional(),
      required: z.boolean().optional(),
    }),
  ),
});

const StartFlowSchema = z.object({
  user_id: z.string().uuid(),
  flow_id: z.string().uuid(),
  workspace_id: z.string().uuid().optional(),
});

const MarkStepSchema = z.object({
  user_id: z.string().uuid(),
  flow_id: z.string().uuid(),
  step_id: z.string().min(1),
});

const ResetProgressSchema = z.object({
  user_id: z.string().uuid(),
  flow_id: z.string().uuid(),
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
            service: "microservice-onboarding",
            db: true,
            latency_ms: Date.now() - start,
          });
        } catch (e) {
          return json(
            {
              ok: false,
              service: "microservice-onboarding",
              db: false,
              error: e instanceof Error ? e.message : "db error",
            },
            503,
          );
        }
      }

      // POST /onboarding/flows
      if (method === "POST" && path === "/onboarding/flows") {
        const parsed = await parseBody(req, CreateFlowSchema);
        if ("error" in parsed) return parsed.error;
        const flow = await createFlow(sql, parsed.data);
        return json(flow, 201);
      }

      // GET /onboarding/flows
      if (method === "GET" && path === "/onboarding/flows") {
        const activeOnly = url.searchParams.get("active") === "true";
        const flows = await listFlows(sql, activeOnly);
        return json({ data: flows, count: flows.length });
      }

      // GET /onboarding/flows/:id
      if (method === "GET" && path.startsWith("/onboarding/flows/")) {
        const id = path.split("/")[3];
        if (!id) return apiError("BAD_REQUEST", "Flow ID required");
        const flow = await getFlow(sql, id);
        if (!flow)
          return apiError("NOT_FOUND", "Flow not found", undefined, 404);
        return json(flow);
      }

      // POST /onboarding/progress/start
      if (method === "POST" && path === "/onboarding/progress/start") {
        const parsed = await parseBody(req, StartFlowSchema);
        if ("error" in parsed) return parsed.error;
        const progress = await startFlow(
          sql,
          parsed.data.user_id,
          parsed.data.flow_id,
          parsed.data.workspace_id,
        );
        return json(progress, 201);
      }

      // POST /onboarding/progress/mark
      if (method === "POST" && path === "/onboarding/progress/mark") {
        const parsed = await parseBody(req, MarkStepSchema);
        if ("error" in parsed) return parsed.error;
        const progress = await markStep(
          sql,
          parsed.data.user_id,
          parsed.data.flow_id,
          parsed.data.step_id,
        );
        return json(progress);
      }

      // POST /onboarding/progress/reset
      if (method === "POST" && path === "/onboarding/progress/reset") {
        const parsed = await parseBody(req, ResetProgressSchema);
        if ("error" in parsed) return parsed.error;
        await resetProgress(sql, parsed.data.user_id, parsed.data.flow_id);
        return json({ ok: true });
      }

      // GET /onboarding/progress/:user_id/:flow_id
      const progressDetailMatch = path.match(
        /^\/onboarding\/progress\/([^/]+)\/([^/]+)$/,
      );
      if (method === "GET" && progressDetailMatch) {
        const userId = progressDetailMatch[1];
        const flowId = progressDetailMatch[2];
        const summary = await getProgress(sql, userId!, flowId!);
        if (!summary)
          return apiError("NOT_FOUND", "Flow not found", undefined, 404);
        return json(summary);
      }

      // GET /onboarding/progress/:user_id
      const progressUserMatch = path.match(/^\/onboarding\/progress\/([^/]+)$/);
      if (method === "GET" && progressUserMatch) {
        const userId = progressUserMatch[1];
        const userFlows = await getUserFlows(sql, userId!);
        return json({ data: userFlows, count: userFlows.length });
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
