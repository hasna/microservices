import type { Sql } from "postgres";

export interface Task {
  id: string;
  workspace_id: string;
  type: string;
  payload: any;
  required_capability: string | null;
  assigned_to: string | null;
  status: string;
  result: any | null;
  error: string | null;
  priority: number;
  created_at: string;
  completed_at: string | null;
}

export async function createTask(
  sql: Sql,
  data: {
    workspaceId: string;
    type: string;
    payload?: any;
    requiredCapability?: string;
    priority?: number;
  },
): Promise<Task> {
  const [t] = await sql<Task[]>`
    INSERT INTO agents.tasks (workspace_id, type, payload, required_capability, priority)
    VALUES (${data.workspaceId}, ${data.type}, ${JSON.stringify(data.payload ?? {})}, ${data.requiredCapability ?? null}, ${data.priority ?? 0})
    RETURNING *`;
  return t;
}

export async function getTask(sql: Sql, id: string): Promise<Task | null> {
  const [t] = await sql<Task[]>`SELECT * FROM agents.tasks WHERE id = ${id}`;
  return t ?? null;
}

export async function listTasks(
  sql: Sql,
  opts?: {
    workspaceId?: string;
    agentId?: string;
    status?: string;
    type?: string;
    limit?: number;
  },
): Promise<Task[]> {
  const lim = opts?.limit ?? 50;
  const _conditions: string[] = [];

  // Build query based on provided filters
  if (opts?.workspaceId && opts?.agentId && opts?.status) {
    return sql<Task[]>`
      SELECT * FROM agents.tasks
      WHERE workspace_id = ${opts.workspaceId} AND assigned_to = ${opts.agentId} AND status = ${opts.status}
      ORDER BY priority DESC, created_at ASC LIMIT ${lim}`;
  }
  if (opts?.workspaceId && opts?.status) {
    return sql<Task[]>`
      SELECT * FROM agents.tasks
      WHERE workspace_id = ${opts.workspaceId} AND status = ${opts.status}
      ORDER BY priority DESC, created_at ASC LIMIT ${lim}`;
  }
  if (opts?.agentId && opts?.status) {
    return sql<Task[]>`
      SELECT * FROM agents.tasks
      WHERE assigned_to = ${opts.agentId} AND status = ${opts.status}
      ORDER BY priority DESC, created_at ASC LIMIT ${lim}`;
  }
  if (opts?.workspaceId && opts?.agentId) {
    return sql<Task[]>`
      SELECT * FROM agents.tasks
      WHERE workspace_id = ${opts.workspaceId} AND assigned_to = ${opts.agentId}
      ORDER BY priority DESC, created_at ASC LIMIT ${lim}`;
  }
  if (opts?.workspaceId) {
    return sql<Task[]>`
      SELECT * FROM agents.tasks WHERE workspace_id = ${opts.workspaceId}
      ORDER BY priority DESC, created_at ASC LIMIT ${lim}`;
  }
  if (opts?.agentId) {
    return sql<Task[]>`
      SELECT * FROM agents.tasks WHERE assigned_to = ${opts.agentId}
      ORDER BY priority DESC, created_at ASC LIMIT ${lim}`;
  }
  if (opts?.status) {
    return sql<Task[]>`
      SELECT * FROM agents.tasks WHERE status = ${opts.status}
      ORDER BY priority DESC, created_at ASC LIMIT ${lim}`;
  }
  return sql<
    Task[]
  >`SELECT * FROM agents.tasks ORDER BY priority DESC, created_at ASC LIMIT ${lim}`;
}

export async function claimTask(
  sql: Sql,
  agentId: string,
): Promise<Task | null> {
  // Get agent capabilities first
  const [agent] = await sql<
    [{ capabilities: string[]; max_concurrent: number; current_load: number }]
  >`
    SELECT capabilities, max_concurrent, current_load FROM agents.agents WHERE id = ${agentId}`;
  if (!agent || agent.current_load >= agent.max_concurrent) return null;

  // Claim next pending task matching capabilities (SKIP LOCKED to prevent double-claim)
  const [task] = await sql<Task[]>`
    UPDATE agents.tasks SET assigned_to = ${agentId}, status = 'running'
    WHERE id = (
      SELECT id FROM agents.tasks
      WHERE status = 'pending'
        AND (required_capability IS NULL OR required_capability = ANY(${sql.array(agent.capabilities)}))
      ORDER BY priority DESC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    ) RETURNING *`;

  if (task) {
    await sql`UPDATE agents.agents SET current_load = current_load + 1, updated_at = NOW() WHERE id = ${agentId}`;
  }
  return task ?? null;
}

export async function completeTask(
  sql: Sql,
  taskId: string,
  result?: any,
): Promise<Task | null> {
  const [task] = await sql<Task[]>`
    UPDATE agents.tasks SET status = 'completed', result = ${JSON.stringify(result ?? {})}, completed_at = NOW()
    WHERE id = ${taskId} RETURNING *`;
  if (task?.assigned_to) {
    await sql`
      UPDATE agents.agents SET
        current_load = GREATEST(current_load - 1, 0),
        total_tasks_completed = total_tasks_completed + 1,
        updated_at = NOW()
      WHERE id = ${task.assigned_to}`;
  }
  return task ?? null;
}

export async function failTask(
  sql: Sql,
  taskId: string,
  error: string,
): Promise<Task | null> {
  const [task] = await sql<Task[]>`
    UPDATE agents.tasks SET status = 'failed', error = ${error}, completed_at = NOW()
    WHERE id = ${taskId} RETURNING *`;
  if (task?.assigned_to) {
    await sql`
      UPDATE agents.agents SET
        current_load = GREATEST(current_load - 1, 0),
        last_error = ${error},
        updated_at = NOW()
      WHERE id = ${task.assigned_to}`;
  }
  return task ?? null;
}
