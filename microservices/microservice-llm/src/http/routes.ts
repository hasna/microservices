/**
 * LLM HTTP routes.
 */

import type { Sql } from "postgres";
import { z } from "zod";
import { chat } from "../lib/gateway.js";
import { getAvailableModels } from "../lib/providers.js";
import { getWorkspaceUsage } from "../lib/usage.js";
import { listPromptTemplates } from "../lib/prompt-templates.js";
import { listWebhooks } from "../lib/webhook-notifier.js";
import { getCacheStats } from "../lib/semantic-cache.js";
import { getWorkspaceModels, listProviders } from "../lib/model-registry.js";
import { getWorkspaceBudget } from "../lib/costs.js";
import { listProviderHealth } from "../lib/provider-health.js";
import { getCircuitBreakerStats } from "../lib/circuit-breaker.js";
import { listBudgetSchedules } from "../lib/budget-scheduler.js";
import { calculateCost } from "../lib/costs.js";
import { countTokens } from "../lib/providers.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const ChatSchema = z.object({
  workspace_id: z.string().uuid(),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string(),
      }),
    )
    .min(1),
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
          return json({
            ok: true,
            service: "microservice-llm",
            db: true,
            latency_ms: Date.now() - start,
          });
        } catch (e) {
          return json(
            {
              ok: false,
              service: "microservice-llm",
              db: false,
              error: e instanceof Error ? e.message : "db error",
            },
            503,
          );
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
        if (!workspaceId)
          return apiError("BAD_REQUEST", "workspace_id is required");
        const sinceParam = url.searchParams.get("since");
        const since = sinceParam ? new Date(sinceParam) : undefined;
        const usage = await getWorkspaceUsage(sql, workspaceId, since);
        return json(usage);
      }

      // GET /llm/templates/:workspace_id
      if (method === "GET" && path.startsWith("/llm/templates/")) {
        const workspaceId = path.slice("/llm/templates/".length);
        if (!workspaceId) return apiError("BAD_REQUEST", "workspace_id is required");
        const templates = await listPromptTemplates(sql, workspaceId);
        return json({ templates, count: templates.length });
      }

      // GET /llm/webhooks/:workspace_id
      if (method === "GET" && path.startsWith("/llm/webhooks/")) {
        const workspaceId = path.slice("/llm/webhooks/".length);
        if (!workspaceId) return apiError("BAD_REQUEST", "workspace_id is required");
        const webhooks = await listWebhooks(sql, workspaceId);
        return json({ webhooks, count: webhooks.length });
      }

      // GET /llm/cache/:workspace_id
      if (method === "GET" && path.startsWith("/llm/cache/")) {
        const workspaceId = path.slice("/llm/cache/".length);
        if (!workspaceId) return apiError("BAD_REQUEST", "workspace_id is required");
        const stats = await getCacheStats(sql, workspaceId);
        return json(stats);
      }

      // GET /llm/models/:workspace_id
      if (method === "GET" && path.startsWith("/llm/models/")) {
        const workspaceId = path.slice("/llm/models/".length);
        if (!workspaceId) return apiError("BAD_REQUEST", "workspace_id is required");
        const models = await getWorkspaceModels(sql, workspaceId);
        return json({ models, count: models.length });
      }

      // GET /llm/providers
      if (method === "GET" && path === "/llm/providers") {
        const providers = await listProviders(sql);
        return json({ providers, count: providers.length });
      }

      // GET /llm/providers/health
      if (method === "GET" && path === "/llm/providers/health") {
        const hours = parseInt(url.searchParams.get("period_hours") ?? "24", 10);
        const health = await listProviderHealth(sql, { periodHours: hours });
        return json({ providers: health, count: health.length });
      }

      // GET /llm/budget/:workspace_id
      if (method === "GET" && path.startsWith("/llm/budget/")) {
        const workspaceId = path.slice("/llm/budget/".length);
        if (!workspaceId) return apiError("BAD_REQUEST", "workspace_id is required");
        const budget = await getWorkspaceBudget(sql, workspaceId);
        return json(budget);
      }

      // GET /llm/budget/:workspace_id/schedules
      if (method === "GET" && path.match(/^\/llm\/budget\/[^/]+\/schedules$/)) {
        const workspaceId = path.split("/")[3];
        if (!workspaceId) return apiError("BAD_REQUEST", "workspace_id is required");
        const schedules = await listBudgetSchedules(sql, workspaceId);
        return json({ schedules, count: schedules.length });
      }

      // GET /llm/circuit-breakers
      if (method === "GET" && path === "/llm/circuit-breakers") {
        const providerParam = url.searchParams.get("providers");
        const providers = providerParam ? providerParam.split(",") : [];
        const stats = getCircuitBreakerStats(providers);
        const result = Array.from(stats.entries()).map(([p, s]) => ({
          provider: p,
          state: s.state,
          failures: s.failures,
          successes: s.successes,
          lastFailure: s.lastFailure,
          lastSuccess: s.lastSuccess,
          openedAt: s.openedAt,
        }));
        return json({ circuit_breakers: result, count: result.length });
      }

      // GET /llm/cost-estimate
      if (method === "GET" && path === "/llm/cost-estimate") {
        const text = url.searchParams.get("text") ?? "";
        const model = url.searchParams.get("model") ?? "gpt-4o";
        if (!text) return apiError("BAD_REQUEST", "text query parameter is required");
        const tokens = countTokens(text);
        const cost = calculateCost(model, tokens, Math.round(tokens * 0.4));
        return json({ model, text_length: text.length, estimated_tokens: tokens, estimated_cost_usd: cost });
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
