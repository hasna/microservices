import { z } from "zod";
import type { Sql } from "postgres";
import { createPrompt, getPromptById, listPrompts, deletePrompt } from "../lib/prompts_crud.js";
import { updatePrompt, listVersions, rollback, diffVersions, getVersion } from "../lib/versions.js";
import { resolvePrompt } from "../lib/resolve.js";
import { setOverride, removeOverride, listOverrides } from "../lib/overrides.js";
import { createExperiment, startExperiment, stopExperiment, listExperiments } from "../lib/experiments.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const CreatePromptSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  content: z.string().min(1),
  description: z.string().optional(),
  model: z.string().optional(),
  variables: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  created_by: z.string().optional(),
});

const UpdateContentSchema = z.object({
  content: z.string().min(1),
  change_note: z.string().optional(),
  created_by: z.string().optional(),
  model: z.string().optional(),
});

const RollbackSchema = z.object({
  version_number: z.number().int().positive(),
});

const OverrideSchema = z.object({
  prompt_id: z.string().min(1),
  scope_type: z.enum(["workspace", "user", "agent"]),
  scope_id: z.string().min(1),
  content: z.string().min(1),
});

const CreateExperimentSchema = z.object({
  prompt_id: z.string().min(1),
  name: z.string().min(1),
  variants: z.array(z.object({ name: z.string(), version_id: z.string(), weight: z.number() })),
  traffic_pct: z.number().min(0).max(100).optional(),
});

const ExperimentStatusSchema = z.object({
  status: z.enum(["running", "completed"]),
});

export function makeRouter(sql: Sql) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url); const p = url.pathname; const m = req.method;
    if (m === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    try {
      // Health
      if (m === "GET" && p === "/health") {
        try {
          const start = Date.now();
          await sql`SELECT 1`;
          return json({ ok: true, service: "microservice-prompts", db: true, latency_ms: Date.now() - start });
        } catch (e) {
          return json({ ok: false, service: "microservice-prompts", db: false, error: e instanceof Error ? e.message : "db error" }, 503);
        }
      }

      // POST /prompts
      if (m === "POST" && p === "/prompts") {
        const parsed = await parseBody(req, CreatePromptSchema);
        if ("error" in parsed) return parsed.error;
        const d = parsed.data;
        return json(await createPrompt(sql, { workspaceId: d.workspace_id, name: d.name, content: d.content, description: d.description, model: d.model, variables: d.variables, tags: d.tags, createdBy: d.created_by }), 201);
      }

      // GET /prompts?workspace_id&tags&search
      if (m === "GET" && p === "/prompts") {
        const wsId = url.searchParams.get("workspace_id");
        if (!wsId) return json({ error: "workspace_id required" }, 400);
        const tags = url.searchParams.get("tags")?.split(",").filter(Boolean);
        const search = url.searchParams.get("search") ?? undefined;
        const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!, 10) : undefined;
        const items = await listPrompts(sql, wsId, { tags, search, limit });
        return json({ data: items, count: items.length });
      }

      // GET /prompts/resolve?workspace_id&name&user_id&agent_id
      if (m === "GET" && p === "/prompts/resolve") {
        const wsId = url.searchParams.get("workspace_id");
        const name = url.searchParams.get("name");
        if (!wsId || !name) return json({ error: "workspace_id and name required" }, 400);
        const variables: Record<string, string> = {};
        for (const [k, v] of url.searchParams.entries()) {
          if (!["workspace_id", "name", "user_id", "agent_id"].includes(k)) variables[k] = v;
        }
        const result = await resolvePrompt(sql, wsId, name, {
          userId: url.searchParams.get("user_id") ?? undefined,
          agentId: url.searchParams.get("agent_id") ?? undefined,
          variables,
        });
        return json(result);
      }

      // GET /prompts/:id
      if (m === "GET" && p.match(/^\/prompts\/[^/]+$/) && !p.includes("resolve") && !p.includes("overrides") && !p.includes("experiments")) {
        const id = p.split("/")[2];
        const prompt = await getPromptById(sql, id);
        return prompt ? json(prompt) : json({ error: "Not found" }, 404);
      }

      // DELETE /prompts/:id
      if (m === "DELETE" && p.match(/^\/prompts\/[^/]+$/) && !p.includes("overrides")) {
        return json({ deleted: await deletePrompt(sql, p.split("/")[2]) });
      }

      // POST /prompts/:id/versions (update content)
      if (m === "POST" && p.match(/^\/prompts\/[^/]+\/versions$/)) {
        const id = p.split("/")[2];
        const parsed = await parseBody(req, UpdateContentSchema);
        if ("error" in parsed) return parsed.error;
        const d = parsed.data;
        return json(await updatePrompt(sql, id, { content: d.content, changeNote: d.change_note, createdBy: d.created_by, model: d.model }), 201);
      }

      // GET /prompts/:id/versions
      if (m === "GET" && p.match(/^\/prompts\/[^/]+\/versions$/)) {
        const id = p.split("/")[2];
        const versions = await listVersions(sql, id);
        return json({ data: versions, count: versions.length });
      }

      // POST /prompts/:id/rollback
      if (m === "POST" && p.match(/^\/prompts\/[^/]+\/rollback$/)) {
        const id = p.split("/")[2];
        const parsed = await parseBody(req, RollbackSchema);
        if ("error" in parsed) return parsed.error;
        await rollback(sql, id, parsed.data.version_number);
        return json({ ok: true, rolled_back_to: parsed.data.version_number });
      }

      // POST /prompts/overrides
      if (m === "POST" && p === "/prompts/overrides") {
        const parsed = await parseBody(req, OverrideSchema);
        if ("error" in parsed) return parsed.error;
        const d = parsed.data;
        return json(await setOverride(sql, d.prompt_id, d.scope_type, d.scope_id, d.content), 201);
      }

      // DELETE /prompts/overrides/:id
      if (m === "DELETE" && p.match(/^\/prompts\/overrides\/[^/]+$/)) {
        return json({ deleted: await removeOverride(sql, p.split("/")[3]) });
      }

      // POST /prompts/experiments
      if (m === "POST" && p === "/prompts/experiments") {
        const parsed = await parseBody(req, CreateExperimentSchema);
        if ("error" in parsed) return parsed.error;
        const d = parsed.data;
        return json(await createExperiment(sql, { promptId: d.prompt_id, name: d.name, variants: d.variants, trafficPct: d.traffic_pct }), 201);
      }

      // PATCH /prompts/experiments/:id/status
      if (m === "PATCH" && p.match(/^\/prompts\/experiments\/[^/]+\/status$/)) {
        const id = p.split("/")[3];
        const parsed = await parseBody(req, ExperimentStatusSchema);
        if ("error" in parsed) return parsed.error;
        if (parsed.data.status === "running") await startExperiment(sql, id);
        else await stopExperiment(sql, id);
        return json({ ok: true });
      }

      return json({ error: "Not found" }, 404);
    } catch (e) { return json({ error: e instanceof Error ? e.message : "Server error" }, 500); }
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
