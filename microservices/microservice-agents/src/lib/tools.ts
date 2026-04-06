import type { Sql } from "postgres";

export interface AgentTool {
  id: string;
  agent_id: string;
  name: string;
  description: string | null;
  schema: Record<string, any>; // JSON Schema for the tool's input
  config: Record<string, any>;
  tags: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RegisterToolInput {
  agentId: string;
  name: string;
  description?: string;
  schema?: Record<string, any>;
  config?: Record<string, any>;
  tags?: string[];
}

export async function registerTool(
  sql: Sql,
  data: RegisterToolInput,
): Promise<AgentTool> {
  const [t] = await sql<AgentTool[]>`
    INSERT INTO agents.agent_tools (agent_id, name, description, schema, config, tags)
    VALUES (
      ${data.agentId}, ${data.name}, ${data.description ?? null},
      ${JSON.stringify(data.schema ?? {})}, ${JSON.stringify(data.config ?? {})},
      ${sql.array(data.tags ?? [])}
    )
    RETURNING *`;
  return t;
}

export async function deregisterTool(
  sql: Sql,
  id: string,
): Promise<boolean> {
  const r = await sql`DELETE FROM agents.agent_tools WHERE id = ${id}`;
  return r.count > 0;
}

export async function getTool(
  sql: Sql,
  id: string,
): Promise<AgentTool | null> {
  const [t] = await sql<AgentTool[]>`SELECT * FROM agents.agent_tools WHERE id = ${id}`;
  return t ?? null;
}

export async function getToolByName(
  sql: Sql,
  agentId: string,
  name: string,
): Promise<AgentTool | null> {
  const [t] = await sql<AgentTool[]>`
    SELECT * FROM agents.agent_tools WHERE agent_id = ${agentId} AND name = ${name}`;
  return t ?? null;
}

export async function listToolsForAgent(
  sql: Sql,
  agentId: string,
  opts?: { activeOnly?: boolean; tag?: string },
): Promise<AgentTool[]> {
  let query = sql<AgentTool[]>`SELECT * FROM agents.agent_tools WHERE agent_id = ${agentId}`;
  if (opts?.activeOnly) {
    query = sql<AgentTool[]>`SELECT * FROM agents.agent_tools WHERE agent_id = ${agentId} AND is_active = true`;
  }
  if (opts?.tag) {
    query = sql<AgentTool[]>`SELECT * FROM agents.agent_tools WHERE agent_id = ${agentId} AND ${opts.tag} = ANY(tags)`;
  }
  return query`ORDER BY created_at DESC`;
}

export async function listToolsByTag(
  sql: Sql,
  workspaceId: string,
  tag: string,
): Promise<AgentTool[]> {
  return sql<AgentTool[]>`
    SELECT t.* FROM agents.agent_tools t
    JOIN agents.agents a ON t.agent_id = a.id
    WHERE a.workspace_id = ${workspaceId} AND t.is_active = true AND ${tag} = ANY(t.tags)
    ORDER BY t.created_at DESC`;
}

export async function updateTool(
  sql: Sql,
  id: string,
  data: Partial<{
    name: string;
    description: string;
    schema: Record<string, any>;
    config: Record<string, any>;
    tags: string[];
    isActive: boolean;
  }>,
): Promise<AgentTool | null> {
  const [t] = await sql<AgentTool[]>`
    UPDATE agents.agent_tools SET
      name = COALESCE(${data.name ?? null}, name),
      description = COALESCE(${data.description ?? null}, description),
      schema = COALESCE(${data.schema ? JSON.stringify(data.schema) : null}::jsonb, schema),
      config = COALESCE(${data.config ? JSON.stringify(data.config) : null}::jsonb, config),
      tags = COALESCE(${data.tags ? sql.array(data.tags) : null}, tags),
      is_active = COALESCE(${data.isActive ?? null}, is_active),
      updated_at = NOW()
    WHERE id = ${id} RETURNING *`;
  return t ?? null;
}

export async function activateTool(
  sql: Sql,
  id: string,
): Promise<AgentTool | null> {
  return updateTool(sql, id, { isActive: true });
}

export async function deactivateTool(
  sql: Sql,
  id: string,
): Promise<AgentTool | null> {
  return updateTool(sql, id, { isActive: false });
}

export async function searchTools(
  sql: Sql,
  workspaceId: string,
  query: string,
): Promise<AgentTool[]> {
  // Full-text-ish search across name, description, tags
  return sql<AgentTool[]>`
    SELECT DISTINCT t.* FROM agents.agent_tools t
    JOIN agents.agents a ON t.agent_id = a.id
    WHERE a.workspace_id = ${workspaceId}
      AND t.is_active = true
      AND (
        t.name ILIKE ${'%' + query + '%'}
        OR t.description ILIKE ${'%' + query + '%'}
      )
    ORDER BY t.created_at DESC
    LIMIT 50`;
}

export async function discoverToolsForCapability(
  sql: Sql,
  workspaceId: string,
  capability: string,
): Promise<AgentTool[]> {
  // Find all active tools on agents that have a given capability
  return sql<AgentTool[]>`
    SELECT t.*, a.capabilities as agent_capabilities FROM agents.agent_tools t
    JOIN agents.agents a ON t.agent_id = a.id
    WHERE a.workspace_id = ${workspaceId}
      AND t.is_active = true
      AND ${capability} = ANY(a.capabilities)
    ORDER BY t.created_at DESC`;
}
