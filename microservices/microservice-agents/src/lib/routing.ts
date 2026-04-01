import type { Sql } from "postgres";
import type { Agent } from "./registry.js";

export async function findAgentByCapability(
  sql: Sql,
  workspaceId: string,
  capability: string,
  opts?: { preferIdle?: boolean },
): Promise<Agent | null> {
  if (opts?.preferIdle) {
    // Prefer idle agents, then active, exclude at-capacity
    const [a] = await sql<Agent[]>`
      SELECT * FROM agents.agents
      WHERE workspace_id = ${workspaceId}
        AND ${capability} = ANY(capabilities)
        AND status IN ('active', 'idle')
        AND current_load < max_concurrent
      ORDER BY
        CASE WHEN status = 'idle' THEN 0 ELSE 1 END,
        current_load ASC
      LIMIT 1`;
    return a ?? null;
  }
  // Prefer active agents (already warmed up), then idle
  const [a] = await sql<Agent[]>`
    SELECT * FROM agents.agents
    WHERE workspace_id = ${workspaceId}
      AND ${capability} = ANY(capabilities)
      AND status IN ('active', 'idle')
      AND current_load < max_concurrent
    ORDER BY
      CASE WHEN status = 'active' THEN 0 ELSE 1 END,
      current_load ASC
    LIMIT 1`;
  return a ?? null;
}

export async function routeTask(
  sql: Sql,
  workspaceId: string,
  type: string,
  payload: any,
  requiredCapability?: string,
): Promise<{ taskId: string; agentId: string | null }> {
  // Create the task first
  const [task] = await sql<[{ id: string }]>`
    INSERT INTO agents.tasks (workspace_id, type, payload, required_capability)
    VALUES (${workspaceId}, ${type}, ${JSON.stringify(payload)}, ${requiredCapability ?? null})
    RETURNING id`;

  if (!requiredCapability) return { taskId: task.id, agentId: null };

  // Try to find a matching agent
  const agent = await findAgentByCapability(
    sql,
    workspaceId,
    requiredCapability,
  );
  if (!agent) return { taskId: task.id, agentId: null };

  // Assign task to agent
  await sql`
    UPDATE agents.tasks SET assigned_to = ${agent.id}, status = 'assigned' WHERE id = ${task.id}`;
  await sql`
    UPDATE agents.agents SET current_load = current_load + 1, updated_at = NOW() WHERE id = ${agent.id}`;

  return { taskId: task.id, agentId: agent.id };
}
