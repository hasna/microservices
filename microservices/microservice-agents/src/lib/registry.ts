import type { Sql } from "postgres";

export interface Agent {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  model: string | null;
  version: string;
  status: string;
  capabilities: string[];
  config: any;
  max_concurrent: number;
  current_load: number;
  last_heartbeat_at: string | null;
  last_error: string | null;
  total_tasks_completed: number;
  created_at: string;
  updated_at: string;
}

export async function registerAgent(
  sql: Sql,
  data: {
    workspaceId: string;
    name: string;
    description?: string;
    model?: string;
    version?: string;
    capabilities?: string[];
    config?: any;
    maxConcurrent?: number;
  },
): Promise<Agent> {
  const [a] = await sql<Agent[]>`
    INSERT INTO agents.agents (workspace_id, name, description, model, version, capabilities, config, max_concurrent)
    VALUES (
      ${data.workspaceId}, ${data.name}, ${data.description ?? null},
      ${data.model ?? null}, ${data.version ?? "1.0.0"},
      ${sql.array(data.capabilities ?? [])}, ${JSON.stringify(data.config ?? {})},
      ${data.maxConcurrent ?? 1}
    ) RETURNING *`;
  return a;
}

export async function deregisterAgent(sql: Sql, id: string): Promise<boolean> {
  const r = await sql`DELETE FROM agents.agents WHERE id = ${id}`;
  return r.count > 0;
}

export async function getAgent(sql: Sql, id: string): Promise<Agent | null> {
  const [a] = await sql<Agent[]>`SELECT * FROM agents.agents WHERE id = ${id}`;
  return a ?? null;
}

export async function getAgentByName(
  sql: Sql,
  workspaceId: string,
  name: string,
): Promise<Agent | null> {
  const [a] = await sql<
    Agent[]
  >`SELECT * FROM agents.agents WHERE workspace_id = ${workspaceId} AND name = ${name}`;
  return a ?? null;
}

export async function listAgents(
  sql: Sql,
  workspaceId: string,
  opts?: { status?: string; capability?: string },
): Promise<Agent[]> {
  if (opts?.status && opts?.capability) {
    return sql<Agent[]>`
      SELECT * FROM agents.agents
      WHERE workspace_id = ${workspaceId} AND status = ${opts.status} AND ${opts.capability} = ANY(capabilities)
      ORDER BY created_at DESC`;
  }
  if (opts?.status) {
    return sql<Agent[]>`
      SELECT * FROM agents.agents WHERE workspace_id = ${workspaceId} AND status = ${opts.status}
      ORDER BY created_at DESC`;
  }
  if (opts?.capability) {
    return sql<Agent[]>`
      SELECT * FROM agents.agents WHERE workspace_id = ${workspaceId} AND ${opts.capability} = ANY(capabilities)
      ORDER BY created_at DESC`;
  }
  return sql<
    Agent[]
  >`SELECT * FROM agents.agents WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC`;
}

export async function updateAgent(
  sql: Sql,
  id: string,
  data: Partial<{
    name: string;
    description: string;
    model: string;
    version: string;
    status: string;
    capabilities: string[];
    config: any;
    maxConcurrent: number;
    lastError: string;
  }>,
): Promise<Agent | null> {
  const [a] = await sql<Agent[]>`
    UPDATE agents.agents SET
      name = COALESCE(${data.name ?? null}, name),
      description = COALESCE(${data.description ?? null}, description),
      model = COALESCE(${data.model ?? null}, model),
      version = COALESCE(${data.version ?? null}, version),
      status = COALESCE(${data.status ?? null}, status),
      capabilities = COALESCE(${data.capabilities ? sql.array(data.capabilities) : null}, capabilities),
      config = COALESCE(${data.config ? JSON.stringify(data.config) : null}::jsonb, config),
      max_concurrent = COALESCE(${data.maxConcurrent ?? null}, max_concurrent),
      last_error = COALESCE(${data.lastError ?? null}, last_error),
      updated_at = NOW()
    WHERE id = ${id} RETURNING *`;
  return a ?? null;
}

export async function heartbeat(
  sql: Sql,
  agentId: string,
): Promise<Agent | null> {
  const [a] = await sql<Agent[]>`
    UPDATE agents.agents SET
      last_heartbeat_at = NOW(),
      status = CASE WHEN status = 'idle' THEN 'active' ELSE status END,
      updated_at = NOW()
    WHERE id = ${agentId} RETURNING *`;
  return a ?? null;
}
