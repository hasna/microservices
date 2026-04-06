import { getDb } from "../db/client.js";
import {
  createWorkflow, getWorkflow, listWorkflows, publishWorkflow,
  type CreateWorkflowInput,
} from "../lib/definitions.js";
import {
  startExecution, getExecution, listExecutions, cancelExecution,
  type StartExecutionInput,
} from "../lib/executions.js";

export async function router(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { method, pathname } = { method: req.method, pathname: url.pathname };
  const sql = getDb();

  try {
    if (method === "GET" && pathname === "/health") {
      return json({ ok: true, service: "microservice-workflows" });
    }

    // Workflows CRUD
    if (method === "POST" && pathname === "/workflows") {
      const body = await req.json() as CreateWorkflowInput;
      const w = await createWorkflow(sql, body);
      return json(w, 201);
    }
    if (method === "GET" && pathname === "/workflows") {
      const wsId = url.searchParams.get("workspace_id");
      if (!wsId) return json({ error: "workspace_id required" }, 400);
      const workflows = await listWorkflows(sql, wsId);
      return json(workflows);
    }
    if (method === "GET" && pathname.startsWith("/workflows/")) {
      const parts = pathname.split("/");
      const wsId = url.searchParams.get("workspace_id");
      const name = decodeURIComponent(parts[2]);
      if (!wsId) return json({ error: "workspace_id required" }, 400);
      const w = await getWorkflow(sql, wsId, name);
      return w ? json(w) : json({ error: "Not found" }, 404);
    }
    if (method === "POST" && pathname === "/workflows/publish") {
      const body = await req.json();
      const w = await publishWorkflow(sql, body.workspaceId, body.name, body.definition, body.createdBy);
      return json(w, 201);
    }

    // Executions
    if (method === "POST" && pathname === "/executions") {
      const body = await req.json() as StartExecutionInput;
      const exec = await startExecution(sql, body);
      return json(exec, 201);
    }
    if (method === "GET" && pathname === "/executions") {
      const wsId = url.searchParams.get("workspace_id");
      if (!wsId) return json({ error: "workspace_id required" }, 400);
      const opts: any = { status: url.searchParams.get("status") || undefined, limit: Number(url.searchParams.get("limit") ?? 50) };
      if (url.searchParams.get("workflow_id")) opts.workflowId = url.searchParams.get("workflow_id")!;
      const execs = await listExecutions(sql, wsId, opts);
      return json(execs);
    }
    if (method === "GET" && pathname.startsWith("/executions/")) {
      const id = pathname.split("/")[2];
      const exec = await getExecution(sql, id);
      return exec ? json(exec) : json({ error: "Not found" }, 404);
    }
    if (method === "DELETE" && pathname.startsWith("/executions/")) {
      const id = pathname.split("/")[2];
      const exec = await cancelExecution(sql, id);
      return exec ? json(exec) : json({ error: "Not found or cannot cancel" }, 404);
    }

    return json({ error: "Not found" }, 404);
  } catch (err: any) {
    console.error(err);
    return json({ error: err.message ?? "Internal server error" }, 500);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
