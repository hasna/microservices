import { z } from "zod";
import type { Sql } from "postgres";
import { registerAgent, deregisterAgent, getAgent, listAgents, updateAgent, heartbeat } from "../lib/registry.js";
import { getAgentHealth } from "../lib/health.js";
import { findAgentByCapability } from "../lib/routing.js";
import { sendMessage, receiveMessages } from "../lib/messaging.js";
import { createTask, listTasks, claimTask, completeTask, failTask } from "../lib/tasks.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const RegisterAgentSchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  model: z.string().optional(),
  version: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  config: z.record(z.unknown()).optional(),
  max_concurrent: z.number().int().min(1).optional(),
});
const UpdateAgentSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  model: z.string().optional(),
  version: z.string().optional(),
  status: z.enum(["active", "idle", "stopped", "error"]).optional(),
  capabilities: z.array(z.string()).optional(),
  config: z.record(z.unknown()).optional(),
  max_concurrent: z.number().int().min(1).optional(),
  last_error: z.string().optional(),
});
const SendMessageSchema = z.object({
  workspace_id: z.string().uuid(),
  from_agent_id: z.string().uuid().optional(),
  to_agent_id: z.string().uuid(),
  type: z.string().min(1),
  payload: z.record(z.unknown()),
});
const CreateTaskSchema = z.object({
  workspace_id: z.string().uuid(),
  type: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
  required_capability: z.string().optional(),
  priority: z.number().int().optional(),
});
const CompleteTaskSchema = z.object({
  status: z.enum(["completed", "failed"]),
  result: z.record(z.unknown()).optional(),
  error: z.string().optional(),
});

export function makeRouter(sql: Sql) {
  return async function router(req: Request): Promise<Response> {
    const url = new URL(req.url); const p = url.pathname; const m = req.method;

    if (m === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      // Health
      if (m === "GET" && p === "/health") {
        try {
          const start = Date.now();
          await sql`SELECT 1`;
          return json({ ok: true, service: "microservice-agents", db: true, latency_ms: Date.now() - start });
        } catch (e) {
          return json({ ok: false, service: "microservice-agents", db: false, error: e instanceof Error ? e.message : "db error" }, 503);
        }
      }

      // POST /agents — register
      if (m === "POST" && p === "/agents") {
        const parsed = await parseBody(req, RegisterAgentSchema);
        if ("error" in parsed) return parsed.error;
        const d = parsed.data;
        return json(await registerAgent(sql, {
          workspaceId: d.workspace_id, name: d.name, description: d.description,
          model: d.model, version: d.version, capabilities: d.capabilities,
          config: d.config, maxConcurrent: d.max_concurrent,
        }), 201);
      }

      // GET /agents?workspace_id&status&capability
      if (m === "GET" && p === "/agents") {
        const wsId = url.searchParams.get("workspace_id");
        if (!wsId) return apiError("VALIDATION_ERROR", "workspace_id query param required");
        const status = url.searchParams.get("status") ?? undefined;
        const capability = url.searchParams.get("capability") ?? undefined;
        const agents = await listAgents(sql, wsId, { status, capability });
        return json({ data: agents, count: agents.length });
      }

      // GET /agents/health?workspace_id
      if (m === "GET" && p === "/agents/health") {
        const wsId = url.searchParams.get("workspace_id");
        if (!wsId) return apiError("VALIDATION_ERROR", "workspace_id query param required");
        return json(await getAgentHealth(sql, wsId));
      }

      // POST /agents/messages — send
      if (m === "POST" && p === "/agents/messages") {
        const parsed = await parseBody(req, SendMessageSchema);
        if ("error" in parsed) return parsed.error;
        const d = parsed.data;
        return json(await sendMessage(sql, {
          workspaceId: d.workspace_id, fromAgentId: d.from_agent_id,
          toAgentId: d.to_agent_id, type: d.type, payload: d.payload,
        }), 201);
      }

      // POST /agents/tasks — create
      if (m === "POST" && p === "/agents/tasks") {
        const parsed = await parseBody(req, CreateTaskSchema);
        if ("error" in parsed) return parsed.error;
        const d = parsed.data;
        return json(await createTask(sql, {
          workspaceId: d.workspace_id, type: d.type, payload: d.payload,
          requiredCapability: d.required_capability, priority: d.priority,
        }), 201);
      }

      // GET /agents/tasks?workspace_id&agent_id&status
      if (m === "GET" && p === "/agents/tasks") {
        const tasks = await listTasks(sql, {
          workspaceId: url.searchParams.get("workspace_id") ?? undefined,
          agentId: url.searchParams.get("agent_id") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
        });
        return json({ data: tasks, count: tasks.length });
      }

      // GET /agents/:id
      if (m === "GET" && p.match(/^\/agents\/[^/]+$/) && !p.includes("/health") && !p.includes("/tasks") && !p.includes("/messages")) {
        const id = p.split("/").pop()!;
        const agent = await getAgent(sql, id);
        return agent ? json(agent) : apiError("NOT_FOUND", "Agent not found", undefined, 404);
      }

      // PATCH /agents/:id
      if (m === "PATCH" && p.match(/^\/agents\/[^/]+$/) && !p.includes("/tasks")) {
        const id = p.split("/").pop()!;
        const parsed = await parseBody(req, UpdateAgentSchema);
        if ("error" in parsed) return parsed.error;
        const d = parsed.data;
        const agent = await updateAgent(sql, id, {
          name: d.name, description: d.description, model: d.model,
          version: d.version, status: d.status, capabilities: d.capabilities,
          config: d.config, maxConcurrent: d.max_concurrent, lastError: d.last_error,
        });
        return agent ? json(agent) : apiError("NOT_FOUND", "Agent not found", undefined, 404);
      }

      // DELETE /agents/:id
      if (m === "DELETE" && p.match(/^\/agents\/[^/]+$/)) {
        const id = p.split("/").pop()!;
        return json({ deleted: await deregisterAgent(sql, id) });
      }

      // POST /agents/:id/heartbeat
      if (m === "POST" && p.match(/^\/agents\/[^/]+\/heartbeat$/)) {
        const id = p.split("/")[2];
        const agent = await heartbeat(sql, id);
        return agent ? json(agent) : apiError("NOT_FOUND", "Agent not found", undefined, 404);
      }

      // GET /agents/:id/messages?unread_only&since&limit
      if (m === "GET" && p.match(/^\/agents\/[^/]+\/messages$/)) {
        const id = p.split("/")[2];
        const msgs = await receiveMessages(sql, id, {
          unreadOnly: url.searchParams.get("unread_only") === "true",
          since: url.searchParams.get("since") ?? undefined,
          limit: url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!) : undefined,
        });
        return json({ data: msgs, count: msgs.length });
      }

      // POST /agents/:id/claim-task
      if (m === "POST" && p.match(/^\/agents\/[^/]+\/claim-task$/)) {
        const id = p.split("/")[2];
        const task = await claimTask(sql, id);
        return task ? json(task) : json({ task: null, message: "No tasks available" });
      }

      // PATCH /agents/tasks/:id — complete or fail
      if (m === "PATCH" && p.match(/^\/agents\/tasks\/[^/]+$/)) {
        const id = p.split("/").pop()!;
        const parsed = await parseBody(req, CompleteTaskSchema);
        if ("error" in parsed) return parsed.error;
        const d = parsed.data;
        if (d.status === "completed") {
          const task = await completeTask(sql, id, d.result);
          return task ? json(task) : apiError("NOT_FOUND", "Task not found", undefined, 404);
        } else {
          const task = await failTask(sql, id, d.error ?? "Unknown error");
          return task ? json(task) : apiError("NOT_FOUND", "Task not found", undefined, 404);
        }
      }

      return apiError("NOT_FOUND", "Not found", undefined, 404);
    } catch (err) { return json({ error: err instanceof Error ? err.message : "Server error" }, 500); }
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
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
