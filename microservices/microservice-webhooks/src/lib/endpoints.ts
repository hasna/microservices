import type { Sql } from "postgres";

export interface Endpoint {
  id: string;
  workspace_id: string;
  url: string;
  secret: string | null;
  events: string[];
  active: boolean;
  failure_count: number;
  last_failure_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function createEndpoint(sql: Sql, data: {
  workspace_id: string;
  url: string;
  secret?: string;
  events?: string[];
}): Promise<Endpoint> {
  const [ep] = await sql<Endpoint[]>`
    INSERT INTO webhooks.endpoints (workspace_id, url, secret, events)
    VALUES (${data.workspace_id}, ${data.url}, ${data.secret ?? null}, ${data.events ?? []})
    RETURNING *`;
  return ep;
}

export async function getEndpoint(sql: Sql, id: string): Promise<Endpoint | null> {
  const [ep] = await sql<Endpoint[]>`SELECT * FROM webhooks.endpoints WHERE id = ${id}`;
  return ep ?? null;
}

export async function listWorkspaceEndpoints(sql: Sql, workspaceId: string): Promise<Endpoint[]> {
  return sql<Endpoint[]>`
    SELECT * FROM webhooks.endpoints WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC`;
}

export async function updateEndpoint(sql: Sql, id: string, data: {
  url?: string;
  secret?: string | null;
  events?: string[];
  active?: boolean;
}): Promise<Endpoint | null> {
  const [ep] = await sql<Endpoint[]>`
    UPDATE webhooks.endpoints SET
      url       = COALESCE(${data.url ?? null}, url),
      secret    = CASE WHEN ${data.secret !== undefined} THEN ${data.secret ?? null} ELSE secret END,
      events    = COALESCE(${data.events ?? null}, events),
      active    = COALESCE(${data.active ?? null}, active),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *`;
  return ep ?? null;
}

export async function deleteEndpoint(sql: Sql, id: string): Promise<boolean> {
  const r = await sql`DELETE FROM webhooks.endpoints WHERE id = ${id}`;
  return r.count > 0;
}

export async function disableEndpoint(sql: Sql, id: string): Promise<void> {
  await sql`UPDATE webhooks.endpoints SET active = false, updated_at = NOW() WHERE id = ${id}`;
}
