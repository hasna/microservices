import type { Sql } from "postgres";
import { sql } from "postgres";

export interface WorkflowNode {
  id: string;
  type: string; // "task" | "branch" | "parallel" | "wait" | "end"
  config: Record<string, any>;
  retryPolicy?: { maxAttempts: number; backoffMs: number };
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: string; // JMESPath-like conditional expression
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface Workflow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  definition: WorkflowDefinition;
  version: number;
  is_latest: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateWorkflowInput {
  workspaceId: string;
  name: string;
  description?: string;
  definition: WorkflowDefinition;
  createdBy?: string;
}

export async function createWorkflow(
  sql: Sql,
  data: CreateWorkflowInput,
): Promise<Workflow> {
  // Validate DAG — no cycles, all `to` nodes exist
  validateDAG(data.definition);

  const [w] = await sql<Workflow[]>`
    INSERT INTO workflows.workflows (workspace_id, name, description, definition, created_by)
    VALUES (${data.workspaceId}, ${data.name}, ${data.description ?? null}, ${JSON.stringify(data.definition)}, ${data.createdBy ?? null})
    RETURNING *`;
  return w;
}

export async function getWorkflow(
  sql: Sql,
  workspaceId: string,
  name: string,
): Promise<Workflow | null> {
  const [w] = await sql<Workflow[]>`
    SELECT * FROM workflows.workflows
    WHERE workspace_id = ${workspaceId} AND name = ${name} AND is_latest = true`;
  return w ?? null;
}

export async function getWorkflowVersion(
  sql: Sql,
  id: string,
  version: number,
): Promise<Workflow | null> {
  const [w] = await sql<Workflow[]>`
    SELECT * FROM workflows.workflows WHERE id = ${id} AND version = ${version}`;
  return w ?? null;
}

export async function listWorkflows(
  sql: Sql,
  workspaceId: string,
): Promise<Workflow[]> {
  return sql<Workflow[]>`
    SELECT * FROM workflows.workflows
    WHERE workspace_id = ${workspaceId} AND is_latest = true
    ORDER BY name ASC`;
}

export async function updateWorkflow(
  sql: Sql,
  id: string,
  data: Partial<{ description: string; definition: WorkflowDefinition }>,
): Promise<Workflow | null> {
  const [w] = await sql<Workflow[]>`
    UPDATE workflows.workflows SET
      description = COALESCE(${data.description ?? null}, description),
      definition = COALESCE(${data.definition ? JSON.stringify(data.definition) : null}::jsonb, definition),
      updated_at = NOW()
    WHERE id = ${id} RETURNING *`;
  return w ?? null;
}

export async function publishWorkflow(
  sql: Sql,
  workspaceId: string,
  name: string,
  definition: WorkflowDefinition,
  createdBy?: string,
): Promise<Workflow> {
  // Bump version, mark previous as not latest
  await sql`
    UPDATE workflows.workflows SET is_latest = false
    WHERE workspace_id = ${workspaceId} AND name = ${name} AND is_latest = true`;

  const [latest] = await sql<{ version: number }[]>`
    SELECT COALESCE(MAX(version), 0) as version FROM workflows.workflows
    WHERE workspace_id = ${workspaceId} AND name = ${name}`;
  const nextVersion = (latest?.version ?? 0) + 1;

  const [w] = await sql<Workflow[]>`
    INSERT INTO workflows.workflows (workspace_id, name, description, definition, version, is_latest, created_by)
    VALUES (
      ${workspaceId}, ${name}, null,
      ${JSON.stringify(definition)}, ${nextVersion}, true, ${createdBy ?? null}
    ) RETURNING *`;
  return w;
}

function validateDAG(def: WorkflowDefinition): void {
  const nodeIds = new Set(def.nodes.map((n) => n.id));
  for (const edge of def.edges) {
    if (!nodeIds.has(edge.from)) throw new Error(`Invalid edge: from="${edge.from}" does not exist`);
    if (!nodeIds.has(edge.to)) throw new Error(`Invalid edge: to="${edge.to}" does not exist`);
  }
  // Detect cycles via Kahn's algorithm
  const inDegree: Record<string, number> = {};
  for (const id of nodeIds) inDegree[id] = 0;
  for (const edge of def.edges) inDegree[edge.to]++;
  const queue: string[] = [];
  for (const [id, deg] of Object.entries(inDegree)) if (deg === 0) queue.push(id);
  let visited = 0;
  while (queue.length) {
    const curr = queue.shift()!;
    visited++;
    for (const edge of def.edges) {
      if (edge.from === curr) {
        inDegree[edge.to]--;
        if (inDegree[edge.to] === 0) queue.push(edge.to);
      }
    }
  }
  if (visited !== nodeIds.size) throw new Error("Workflow definition contains a cycle");
}

export async function listWorkflowVersions(
  sql: Sql,
  workflowId: string,
): Promise<Workflow[]> {
  return sql<Workflow[]>`
    SELECT * FROM workflows.workflows
    WHERE id = ${workflowId}
    ORDER BY version DESC`;
}

export async function diffWorkflowVersions(
  sql: Sql,
  workflowId: string,
  versionA: number,
  versionB: number,
): Promise<{ added: string[]; removed: string[]; changed: string[] }> {
  const [wA] = await sql<Workflow[]>`SELECT * FROM workflows.workflows WHERE id = ${workflowId} AND version = ${versionA}`;
  const [wB] = await sql<Workflow[]>`SELECT * FROM workflows.workflows WHERE id = ${workflowId} AND version = ${versionB}`;

  if (!wA || !wB) throw new Error("One or both versions not found");

  const nodesA = new Map(wA.definition.nodes.map((n) => [n.id, n]));
  const nodesB = new Map(wB.definition.nodes.map((n) => [n.id, n]));

  const idsA = new Set(nodesA.keys());
  const idsB = new Set(nodesB.keys());

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const id of idsB) {
    if (!idsA.has(id)) added.push(id);
    else if (JSON.stringify(nodesA.get(id)) !== JSON.stringify(nodesB.get(id))) changed.push(id);
  }
  for (const id of idsA) {
    if (!idsB.has(id)) removed.push(id);
  }

  return { added, removed, changed };
}
