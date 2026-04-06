import type { Sql } from "postgres";
import type { Workflow, WorkflowDefinition } from "./definitions.js";
import { getWorkflowVersion } from "./definitions.js";
import { executeNode, NodeExecutor } from "./executor.js";

export interface Execution {
  id: string;
  workspace_id: string;
  workflow_id: string;
  workflow_version: number;
  status: "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  trigger_type: string;
  trigger_payload: Record<string, any>;
  context: Record<string, any>;
  result: Record<string, any> | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface StartExecutionInput {
  workspaceId: string;
  workflowName: string;
  triggerType?: string;
  triggerPayload?: Record<string, any>;
  context?: Record<string, any>;
  executor?: NodeExecutor;
}

export async function startExecution(
  sql: Sql,
  input: StartExecutionInput,
): Promise<Execution> {
  const workflow = await getWorkflow(sql, input.workspaceId, input.workflowName);
  if (!workflow) throw new Error(`Workflow "${input.workspaceId}/${input.workspaceId}" not found`);

  const [exec] = await sql<Execution[]>`
    INSERT INTO workflows.executions (workspace_id, workflow_id, workflow_version, trigger_type, trigger_payload, context, status, started_at)
    VALUES (
      ${input.workspaceId}, ${workflow.id}, ${workflow.version},
      ${input.triggerType ?? "manual"}, ${JSON.stringify(input.triggerPayload ?? {})},
      ${JSON.stringify(input.context ?? {})}, 'running', NOW()
    ) RETURNING *`;

  // Kick off the DAG — find root nodes (no incoming edges)
  const def = workflow.definition as WorkflowDefinition;
  const nodeIds = new Set(def.nodes.map((n) => n.id));
  const hasIncoming: Record<string, boolean> = {};
  for (const id of nodeIds) hasIncoming[id] = false;
  for (const edge of def.edges) hasIncoming[edge.to] = true;
  const roots = def.nodes.filter((n) => !hasIncoming[n.id]);

  // Schedule root nodes
  for (const root of roots) {
    await sql`
      INSERT INTO workflows.node_executions (execution_id, node_id, status, input, started_at)
      VALUES (${exec.id}, ${root.id}, 'running', ${JSON.stringify(input.context ?? {})}, NOW())`;
  }

  // Process the DAG synchronously for now (non-blocking via worker in production)
  await processExecution(sql, exec.id, def, input.executor);

  const [updated] = await sql<Execution[]>`SELECT * FROM workflows.executions WHERE id = ${exec.id}`;
  return updated;
}

export async function getExecution(sql: Sql, id: string): Promise<Execution | null> {
  const [e] = await sql<Execution[]>`SELECT * FROM workflows.executions WHERE id = ${id}`;
  return e ?? null;
}

export async function listExecutions(
  sql: Sql,
  workspaceId: string,
  opts?: { workflowId?: string; status?: string; limit?: number },
): Promise<Execution[]> {
  let query = sql<Execution[]>`
    SELECT * FROM workflows.executions WHERE workspace_id = ${workspaceId}`;
  if (opts?.workflowId) query = sql<Execution[]>`SELECT * FROM workflows.executions WHERE workspace_id = ${workspaceId} AND workflow_id = ${opts.workflowId}`;
  if (opts?.status) query = sql<Execution[]>`SELECT * FROM workflows.executions WHERE workspace_id = ${workspaceId} AND status = ${opts.status}`;
  if (opts?.workflowId && opts?.status) query = sql<Execution[]>`SELECT * FROM workflows.executions WHERE workspace_id = ${workspaceId} AND workflow_id = ${opts.workflowId} AND status = ${opts.status}`;
  return query`ORDER BY created_at DESC LIMIT ${opts?.limit ?? 50}`;
}

export async function cancelExecution(sql: Sql, id: string): Promise<Execution | null> {
  const [e] = await sql<Execution[]>`
    UPDATE workflows.executions SET status = 'cancelled', completed_at = NOW()
    WHERE id = ${id} AND status IN ('pending', 'running', 'waiting') RETURNING *`;
  return e ?? null;
}

export async function advanceExecution(
  sql: Sql,
  executionId: string,
  nodeId: string,
  output: Record<string, any>,
  executor?: NodeExecutor,
): Promise<void> {
  // Mark node as completed
  await sql`
    UPDATE workflows.node_executions SET status = 'completed', output = ${JSON.stringify(output)}, completed_at = NOW()
    WHERE execution_id = ${executionId} AND node_id = ${nodeId}`;

  // Find downstream nodes that are now ready (all upstream completed)
  const [exec] = await sql<Execution[]>`SELECT * FROM workflows.executions WHERE id = ${executionId}`;
  if (!exec) return;
  const def = JSON.parse(exec.result ? JSON.stringify(exec.result) : "{}") as WorkflowDefinition;
  // Reload definition
  const wf = await getWorkflowVersion(sql, exec.workflow_id, exec.workflow_version);
  if (!wf) return;

  const doneNodes = new Set<string>();
  const completed = await sql<{ node_id: string }[]>`
    SELECT node_id FROM workflows.node_executions
    WHERE execution_id = ${executionId} AND status = 'completed'`;
  for (const c of completed) doneNodes.add(c.node_id);

  const ready: string[] = [];
  for (const edge of wf.definition.edges) {
    if (doneNodes.has(edge.from) && !doneNodes.has(edge.to)) {
      // Check all upstream of edge.to are done
      const allUpstreamDone = wf.definition.edges
        .filter((e) => e.to === edge.to)
        .every((e) => doneNodes.has(e.from));
      if (allUpstreamDone) ready.push(edge.to);
    }
  }

  for (const nid of ready) {
    await sql`
      INSERT INTO workflows.node_executions (execution_id, node_id, status, input, started_at)
      VALUES (${executionId}, ${nid}, 'running', ${JSON.stringify(output)}, NOW())`;
    await processNode(sql, executionId, nid, wf.definition, output, executor);
  }

  // Check if execution is done
  const allDone = await sql<{ total: number; completed: number }[]>`
    SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'completed') as completed
    FROM workflows.node_executions WHERE execution_id = ${executionId}`;
  if (allDone[0].total === allDone[0].completed) {
    await sql`UPDATE workflows.executions SET status = 'completed', completed_at = NOW() WHERE id = ${executionId}`;
  }
}

async function processExecution(sql: Sql, executionId: string, def: WorkflowDefinition, executor?: NodeExecutor): Promise<void> {
  const running = await sql<{ node_id: string; input: Record<string, any> }[]>`
    SELECT node_id, input FROM workflows.node_executions
    WHERE execution_id = ${executionId} AND status = 'running'`;
  for (const node of running) {
    await processNode(sql, executionId, node.node_id, def, node.input, executor);
  }
}

async function processNode(
  sql: Sql,
  executionId: string,
  nodeId: string,
  def: WorkflowDefinition,
  input: Record<string, any>,
  executor?: NodeExecutor,
): Promise<void> {
  const node = def.nodes.find((n) => n.id === nodeId);
  if (!node) {
    await sql`UPDATE workflows.node_executions SET status = 'failed', error = 'Node not found' WHERE execution_id = ${executionId} AND node_id = ${nodeId}`;
    return;
  }
  try {
    if (executor) {
      const result = await executor({ nodeId, nodeType: node.type, config: node.config, input });
      await advanceExecution(sql, executionId, nodeId, result, executor);
    } else {
      // Default: just mark completed and pass through
      await advanceExecution(sql, executionId, nodeId, { ...input, nodeId }, executor);
    }
  } catch (err: any) {
    await sql`UPDATE workflows.node_executions SET status = 'failed', error = ${err.message} WHERE execution_id = ${executionId} AND node_id = ${nodeId}`;
    await sql`UPDATE workflows.executions SET status = 'failed', error = ${err.message} WHERE id = ${executionId}`;
  }
}

export async function pauseExecution(sql: Sql, executionId: string, reason?: string): Promise<Execution | null> {
  const [e] = await sql<Execution[]>`
    UPDATE workflows.executions
    SET status = 'waiting', result = ${JSON.stringify({ reason: reason ?? "paused" })}
    WHERE id = ${executionId} AND status = 'running'
    RETURNING *`;
  return e ?? null;
}

export async function resumeExecution(sql: Sql, executionId: string): Promise<Execution | null> {
  const [e] = await sql<Execution[]>`
    UPDATE workflows.executions
    SET status = 'running'
    WHERE id = ${executionId} AND status = 'waiting'
    RETURNING *`;
  if (e) {
    // Resume processing pending nodes
    const def = JSON.parse(e.result ? JSON.stringify(e.result) : "{}") as WorkflowDefinition;
    const wf = await getWorkflowVersion(sql, e.workflow_id, e.workflow_version);
    if (wf) {
      await processExecution(sql, executionId, wf.definition);
    }
  }
  return e ?? null;
}

export async function signalExecution(
  sql: Sql,
  executionId: string,
  signal: string,
  payload?: Record<string, any>,
): Promise<Execution | null> {
  const [e] = await sql<Execution[]>`
    UPDATE workflows.executions
    SET context = context || ${JSON.stringify({ [signal]: payload ?? {} })}
    WHERE id = ${executionId}
    RETURNING *`;
  return e ?? null;
}

export async function getActiveExecutions(sql: Sql, workspaceId: string): Promise<Execution[]> {
  return sql<Execution[]>`
    SELECT * FROM workflows.executions
    WHERE workspace_id = ${workspaceId}
    AND status IN ('running', 'waiting', 'pending')
    ORDER BY started_at DESC`;
}

export async function bulkCancelExecutions(sql: Sql, executionIds: string[]): Promise<{ cancelled: number }> {
  const result = await sql`UPDATE workflows.executions
    SET status = 'cancelled', completed_at = NOW()
    WHERE id IN (${sql(executionIds)})
    AND status IN ('pending', 'running', 'waiting')
    RETURNING id`;
  return { cancelled: result.length };
}

export async function bulkRetryFailures(sql: Sql, workflowId: string): Promise<{ retried: number }> {
  const failed = await sql<Execution[]>`
    SELECT * FROM workflows.executions
    WHERE workflow_id = ${workflowId} AND status = 'failed'`;
  let retried = 0;
  for (const f of failed) {
    await sql`UPDATE workflows.executions
      SET status = 'pending', error = NULL, started_at = NOW(), completed_at = NULL
      WHERE id = ${f.id}`;
    retried++;
  }
  return { retried };
}

export async function getExecutionTimeline(sql: Sql, executionId: string): Promise<Record<string, any>> {
  const steps = await sql`
    SELECT node_id, status, started_at, completed_at, elapsed_ms
    FROM workflows.node_executions
    WHERE execution_id = ${executionId}
    ORDER BY started_at ASC`;
  const exec = await sql`SELECT * FROM workflows.executions WHERE id = ${executionId}`;
  return {
    execution: exec[0] ?? null,
    steps,
    total_duration_ms: exec[0]?.completed_at && exec[0]?.started_at
      ? new Date(exec[0].completed_at).getTime() - new Date(exec[0].started_at).getTime()
      : null,
  };
}
