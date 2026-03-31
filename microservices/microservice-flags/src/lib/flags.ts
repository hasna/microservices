import type { Sql } from "postgres";

export interface Flag {
  id: string; key: string; name: string; description: string | null;
  type: string; default_value: string; enabled: boolean;
  workspace_id: string | null; created_at: string; updated_at: string;
}

export async function createFlag(sql: Sql, data: { key: string; name: string; description?: string; type?: string; defaultValue?: string; workspaceId?: string }): Promise<Flag> {
  const [f] = await sql<Flag[]>`
    INSERT INTO flags.flags (key, name, description, type, default_value, workspace_id)
    VALUES (${data.key}, ${data.name}, ${data.description ?? null}, ${data.type ?? "boolean"}, ${data.defaultValue ?? "false"}, ${data.workspaceId ?? null})
    RETURNING *`;
  return f;
}

export async function getFlag(sql: Sql, id: string): Promise<Flag | null> {
  const [f] = await sql<Flag[]>`SELECT * FROM flags.flags WHERE id = ${id}`;
  return f ?? null;
}

export async function getFlagByKey(sql: Sql, key: string): Promise<Flag | null> {
  const [f] = await sql<Flag[]>`SELECT * FROM flags.flags WHERE key = ${key}`;
  return f ?? null;
}

export async function listFlags(sql: Sql, workspaceId?: string): Promise<Flag[]> {
  return sql<Flag[]>`SELECT * FROM flags.flags WHERE (workspace_id IS NULL OR workspace_id = ${workspaceId ?? null}) ORDER BY key`;
}

export async function updateFlag(sql: Sql, id: string, data: { name?: string; description?: string; enabled?: boolean; defaultValue?: string }): Promise<Flag | null> {
  const [f] = await sql<Flag[]>`
    UPDATE flags.flags SET
      name = COALESCE(${data.name ?? null}, name),
      description = COALESCE(${data.description ?? null}, description),
      enabled = COALESCE(${data.enabled ?? null}, enabled),
      default_value = COALESCE(${data.defaultValue ?? null}, default_value),
      updated_at = NOW()
    WHERE id = ${id} RETURNING *`;
  return f ?? null;
}

export async function deleteFlag(sql: Sql, id: string): Promise<boolean> {
  const r = await sql`DELETE FROM flags.flags WHERE id = ${id}`;
  return r.count > 0;
}

export async function setOverride(sql: Sql, flagId: string, targetType: "user" | "workspace", targetId: string, value: string): Promise<void> {
  await sql`
    INSERT INTO flags.overrides (flag_id, target_type, target_id, value)
    VALUES (${flagId}, ${targetType}, ${targetId}, ${value})
    ON CONFLICT (flag_id, target_type, target_id) DO UPDATE SET value = EXCLUDED.value`;
}

export async function removeOverride(sql: Sql, flagId: string, targetType: string, targetId: string): Promise<boolean> {
  const r = await sql`DELETE FROM flags.overrides WHERE flag_id = ${flagId} AND target_type = ${targetType} AND target_id = ${targetId}`;
  return r.count > 0;
}

export async function addRule(sql: Sql, flagId: string, data: { name?: string; type: string; config: Record<string, unknown>; value: string; priority?: number }): Promise<void> {
  await sql`INSERT INTO flags.rules (flag_id, name, type, config, value, priority) VALUES (${flagId}, ${data.name ?? null}, ${data.type}, ${JSON.stringify(data.config)}, ${data.value}, ${data.priority ?? 0})`;
}

export async function listRules(sql: Sql, flagId: string) {
  return sql`SELECT * FROM flags.rules WHERE flag_id = ${flagId} ORDER BY priority DESC`;
}

export async function getFlagHistory(sql: Sql, flagId: string, limit = 50): Promise<unknown[]> {
  return sql`SELECT * FROM flags.flag_history WHERE flag_id = ${flagId} ORDER BY changed_at DESC LIMIT ${limit}`;
}
