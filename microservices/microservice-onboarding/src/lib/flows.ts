import type { Sql } from "postgres";

export interface FlowStep {
  id: string;
  title: string;
  description?: string;
  required?: boolean;
}

export interface Flow {
  id: string;
  name: string;
  description: string | null;
  steps: FlowStep[];
  active: boolean;
  created_at: Date;
}

export async function createFlow(
  sql: Sql,
  data: { name: string; description?: string; steps: FlowStep[] }
): Promise<Flow> {
  const [row] = await sql<Flow[]>`
    INSERT INTO onboarding.flows (name, description, steps)
    VALUES (${data.name}, ${data.description ?? null}, ${sql.json(data.steps)})
    RETURNING *
  `;
  return row;
}

export async function getFlow(sql: Sql, id: string): Promise<Flow | null> {
  const [row] = await sql<Flow[]>`SELECT * FROM onboarding.flows WHERE id = ${id}`;
  return row ?? null;
}

export async function getFlowByName(sql: Sql, name: string): Promise<Flow | null> {
  const [row] = await sql<Flow[]>`SELECT * FROM onboarding.flows WHERE name = ${name}`;
  return row ?? null;
}

export async function listFlows(sql: Sql, activeOnly = false): Promise<Flow[]> {
  if (activeOnly) {
    return sql<Flow[]>`SELECT * FROM onboarding.flows WHERE active = true ORDER BY created_at ASC`;
  }
  return sql<Flow[]>`SELECT * FROM onboarding.flows ORDER BY created_at ASC`;
}

export async function updateFlow(
  sql: Sql,
  id: string,
  data: Partial<{ name: string; description: string; steps: FlowStep[]; active: boolean }>
): Promise<Flow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (data.name !== undefined) { sets.push("name = $" + (values.length + 1)); values.push(data.name); }
  if (data.description !== undefined) { sets.push("description = $" + (values.length + 1)); values.push(data.description); }
  if (data.steps !== undefined) { sets.push("steps = $" + (values.length + 1) + "::jsonb"); values.push(JSON.stringify(data.steps)); }
  if (data.active !== undefined) { sets.push("active = $" + (values.length + 1)); values.push(data.active); }

  if (sets.length === 0) return getFlow(sql, id);

  // Build update using tagged template for safety
  if (data.name !== undefined && data.description !== undefined && data.steps !== undefined && data.active !== undefined) {
    const [row] = await sql<Flow[]>`
      UPDATE onboarding.flows
      SET name = ${data.name}, description = ${data.description}, steps = ${sql.json(data.steps)}, active = ${data.active}
      WHERE id = ${id}
      RETURNING *
    `;
    return row ?? null;
  }

  // Partial updates — build dynamically
  const existing = await getFlow(sql, id);
  if (!existing) return null;

  const merged = {
    name: data.name ?? existing.name,
    description: data.description ?? existing.description ?? null,
    steps: data.steps ?? existing.steps,
    active: data.active ?? existing.active,
  };

  const [row] = await sql<Flow[]>`
    UPDATE onboarding.flows
    SET name = ${merged.name}, description = ${merged.description}, steps = ${sql.json(merged.steps)}, active = ${merged.active}
    WHERE id = ${id}
    RETURNING *
  `;
  return row ?? null;
}

export async function deleteFlow(sql: Sql, id: string): Promise<boolean> {
  const result = await sql`DELETE FROM onboarding.flows WHERE id = ${id}`;
  return (result as unknown as { count: number }).count > 0;
}
