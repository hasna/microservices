import type { Sql } from "postgres";

export interface Override {
  id: string;
  prompt_id: string;
  scope_type: "workspace" | "user" | "agent";
  scope_id: string;
  content: string;
  created_at: string;
}

export async function setOverride(
  sql: Sql,
  promptId: string,
  scopeType: "workspace" | "user" | "agent",
  scopeId: string,
  content: string
): Promise<Override> {
  const [row] = await sql`
    INSERT INTO prompts.overrides (prompt_id, scope_type, scope_id, content)
    VALUES (${promptId}, ${scopeType}, ${scopeId}, ${content})
    ON CONFLICT (prompt_id, scope_type, scope_id) DO UPDATE SET content = EXCLUDED.content
    RETURNING *`;
  return row as unknown as Override;
}

export async function removeOverride(sql: Sql, id: string): Promise<boolean> {
  const result = await sql`DELETE FROM prompts.overrides WHERE id = ${id}`;
  return result.count > 0;
}

export async function listOverrides(sql: Sql, promptId: string): Promise<Override[]> {
  return (await sql`
    SELECT * FROM prompts.overrides WHERE prompt_id = ${promptId} ORDER BY scope_type, created_at DESC`) as unknown as Override[];
}

export async function getOverrideForScope(
  sql: Sql,
  promptId: string,
  scopeType: "workspace" | "user" | "agent",
  scopeId: string
): Promise<Override | null> {
  const [row] = await sql`
    SELECT * FROM prompts.overrides WHERE prompt_id = ${promptId} AND scope_type = ${scopeType} AND scope_id = ${scopeId}`;
  return row ? (row as unknown as Override) : null;
}
