/**
 * Traces HTTP routes.
 */

import type { Sql } from "postgres";
import { z } from "zod";
import { getTrace, getTraceTree, listTraces } from "../lib/query.js";
import { getTraceStats } from "../lib/stats.js";
import { endSpan, endTrace, startSpan, startTrace } from "../lib/tracing.js";
import {
  generateGrafanaDashboard,
  type GrafanaDashboard,
} from "../lib/grafana-dashboard.js";
import {
  exportPrometheusMetrics,
  toPrometheusTextFormat,
} from "../lib/prometheus-export.js";
import { getDatadogStatsForWorkspace } from "../lib/datadog-export.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const StartTraceSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const EndTraceSchema = z.object({
  status: z.enum(["running", "completed", "error"]),
  output: z.unknown().optional(),
  error: z.string().optional(),
});

const StartSpanSchema = z.object({
  trace_id: z.string().min(1),
  parent_span_id: z.string().optional(),
  name: z.string().min(1),
  type: z.enum([
    "llm",
    "tool",
    "retrieval",
    "guardrail",
    "embedding",
    "custom",
  ]),
  input: z.unknown().optional(),
  model: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const EndSpanSchema = z.object({
  status: z.enum(["running", "completed", "error"]),
  output: z.unknown().optional(),
  error: z.string().optional(),
  tokens_in: z.number().int().optional(),
  tokens_out: z.number().int().optional(),
  cost_usd: z.number().optional(),
});

export function makeRouter(sql: Sql) {
  return async function router(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    if (method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders });

    try {
      // GET /health
      if (method === "GET" && path === "/health") {
        try {
          const start = Date.now();
          await sql`SELECT 1`;
          return json({
            ok: true,
            service: "microservice-traces",
            db: true,
            latency_ms: Date.now() - start,
          });
        } catch (e) {
          return json(
            {
              ok: false,
              service: "microservice-traces",
              db: false,
              error: e instanceof Error ? e.message : "db error",
            },
            503,
          );
        }
      }

      // POST /traces — start a trace
      if (method === "POST" && path === "/traces") {
        const parsed = await parseBody(req, StartTraceSchema);
        if ("error" in parsed) return parsed.error;
        const body = parsed.data;
        const trace = await startTrace(sql, {
          workspaceId: body.workspace_id,
          name: body.name,
          input: body.input,
          metadata: body.metadata,
        });
        return json(trace, 201);
      }

      // PATCH /traces/:id — end a trace
      if (
        method === "PATCH" &&
        path.match(/^\/traces\/[^/]+$/) &&
        !path.includes("/spans")
      ) {
        const id = path.split("/").pop()!;
        const parsed = await parseBody(req, EndTraceSchema);
        if ("error" in parsed) return parsed.error;
        const body = parsed.data;
        const trace = await endTrace(sql, id, {
          status: body.status,
          output: body.output,
          error: body.error,
        });
        return json(trace);
      }

      // GET /traces/:id/tree — get trace with nested span tree
      if (method === "GET" && path.match(/^\/traces\/[^/]+\/tree$/)) {
        const id = path.split("/")[2];
        const trace = await getTraceTree(sql, id);
        if (!trace)
          return apiError("NOT_FOUND", "Trace not found", undefined, 404);
        return json(trace);
      }

      // GET /traces/:id — get trace with flat spans
      if (
        method === "GET" &&
        path.match(/^\/traces\/[^/]+$/) &&
        !path.includes("/spans") &&
        !path.includes("/stats")
      ) {
        const id = path.split("/").pop()!;
        const trace = await getTrace(sql, id);
        if (!trace)
          return apiError("NOT_FOUND", "Trace not found", undefined, 404);
        return json(trace);
      }

      // GET /traces — list traces
      if (method === "GET" && path === "/traces") {
        const workspaceId = url.searchParams.get("workspace_id");
        if (!workspaceId)
          return apiError("MISSING_PARAM", "workspace_id is required");
        const traces = await listTraces(sql, workspaceId, {
          status: url.searchParams.get("status") ?? undefined,
          name: url.searchParams.get("name") ?? undefined,
          since: url.searchParams.get("since")
            ? new Date(url.searchParams.get("since")!)
            : undefined,
          until: url.searchParams.get("until")
            ? new Date(url.searchParams.get("until")!)
            : undefined,
          limit: url.searchParams.get("limit")
            ? parseInt(url.searchParams.get("limit")!, 10)
            : undefined,
          offset: url.searchParams.get("offset")
            ? parseInt(url.searchParams.get("offset")!, 10)
            : undefined,
        });
        return json({ data: traces, count: traces.length });
      }

      // POST /traces/:id/spans — start a span
      if (method === "POST" && path.match(/^\/traces\/[^/]+\/spans$/)) {
        const traceId = path.split("/")[2];
        const parsed = await parseBody(
          req,
          StartSpanSchema.omit({ trace_id: true }),
        );
        if ("error" in parsed) return parsed.error;
        const body = parsed.data;
        const span = await startSpan(sql, {
          traceId,
          parentSpanId: body.parent_span_id,
          name: body.name,
          type: body.type,
          input: body.input,
          model: body.model,
          metadata: body.metadata,
        });
        return json(span, 201);
      }

      // PATCH /traces/spans/:id — end a span
      if (method === "PATCH" && path.match(/^\/traces\/spans\/[^/]+$/)) {
        const id = path.split("/").pop()!;
        const parsed = await parseBody(req, EndSpanSchema);
        if ("error" in parsed) return parsed.error;
        const body = parsed.data;
        const span = await endSpan(sql, id, {
          status: body.status,
          output: body.output,
          error: body.error,
          tokens_in: body.tokens_in,
          tokens_out: body.tokens_out,
          cost_usd: body.cost_usd,
        });
        return json(span);
      }

      // GET /traces/stats — get trace statistics
      if (method === "GET" && path === "/traces/stats") {
        const workspaceId = url.searchParams.get("workspace_id");
        if (!workspaceId)
          return apiError("MISSING_PARAM", "workspace_id is required");
        const since = url.searchParams.get("since")
          ? new Date(url.searchParams.get("since")!)
          : undefined;
        const stats = await getTraceStats(sql, workspaceId, since);
        return json(stats);
      }

      // GET /traces/export/grafana/:workspace_id — generate Grafana dashboard JSON
      if (
        method === "GET" &&
        path.match(/^\/traces\/export\/grafana\/[^/]+$/)
      ) {
        const workspaceId = path.split("/")[4];
        const title = url.searchParams.get("title") ?? "Hasna Traces Overview";
        const uid = url.searchParams.get("uid") ?? undefined;
        const refreshInterval = url.searchParams.get("refresh_interval") ?? "5m";
        const dashboard: GrafanaDashboard = generateGrafanaDashboard({
          workspaceId,
          title,
          uid,
          refreshInterval,
        });
        return new Response(JSON.stringify(dashboard, null, 2), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="grafana-traces-${workspaceId}.json"`,
            ...corsHeaders,
          },
        });
      }

      // GET /traces/metrics/prometheus/:workspace_id — Prometheus text format metrics
      if (
        method === "GET" &&
        path.match(/^\/traces\/metrics\/prometheus\/[^/]+$/)
      ) {
        const workspaceId = path.split("/")[4];
        const since = url.searchParams.get("since")
          ? new Date(url.searchParams.get("since")!)
          : undefined;
        const promMetrics = await exportPrometheusMetrics(sql, workspaceId, since);
        const text = toPrometheusTextFormat(promMetrics.metrics);
        return new Response(text, {
          status: 200,
          headers: {
            "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
            ...corsHeaders,
          },
        });
      }

      // GET /traces/export/datadog/:workspace_id — Datadog APM stats
      if (
        method === "GET" &&
        path.match(/^\/traces\/export\/datadog\/[^/]+$/)
      ) {
        const workspaceId = path.split("/")[4];
        const since = url.searchParams.get("since")
          ? new Date(url.searchParams.get("since")!)
          : undefined;
        const stats = await getDatadogStatsForWorkspace(sql, workspaceId, since);
        return json({
          workspace_id: workspaceId,
          stats,
          period: since
            ? { since: since.toISOString(), until: new Date().toISOString() }
            : { since: "7d ago", until: "now" },
        });
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
