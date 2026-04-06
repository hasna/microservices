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

export async function createEndpoint(
  sql: Sql,
  data: {
    workspace_id: string;
    url: string;
    secret?: string;
    events?: string[];
  },
): Promise<Endpoint> {
  const [ep] = await sql<Endpoint[]>`
    INSERT INTO webhooks.endpoints (workspace_id, url, secret, events)
    VALUES (${data.workspace_id}, ${data.url}, ${data.secret ?? null}, ${data.events ?? []})
    RETURNING *`;
  return ep;
}

export async function getEndpoint(
  sql: Sql,
  id: string,
): Promise<Endpoint | null> {
  const [ep] = await sql<
    Endpoint[]
  >`SELECT * FROM webhooks.endpoints WHERE id = ${id}`;
  return ep ?? null;
}

export async function listWorkspaceEndpoints(
  sql: Sql,
  workspaceId: string,
): Promise<Endpoint[]> {
  return sql<Endpoint[]>`
    SELECT * FROM webhooks.endpoints WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC`;
}

export async function updateEndpoint(
  sql: Sql,
  id: string,
  data: {
    url?: string;
    secret?: string | null;
    events?: string[];
    active?: boolean;
  },
): Promise<Endpoint | null> {
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

export interface EndpointHealth {
  id: string;
  workspace_id: string;
  url: string;
  active: boolean;
  failure_count: number;
  last_failure_at: string | null;
  consecutive_failures: number;
  success_rate_pct: number;
}

export async function getEndpointHealth(
  sql: Sql,
  id: string,
): Promise<EndpointHealth | null> {
  const [ep] = await sql<Endpoint[]>`
    SELECT * FROM webhooks.endpoints WHERE id = ${id}`;
  if (!ep) return null;

  const [total] = await sql<{ total: string }[]>`
    SELECT COUNT(*)::text as total FROM webhooks.deliveries
    WHERE endpoint_id = ${id}`;
  const [failed] = await sql<{ failed: string }[]>`
    SELECT COUNT(*)::text as failed FROM webhooks.deliveries
    WHERE endpoint_id = ${id} AND status = 'failed'`;

  const totalCount = parseInt(total.total ?? "0", 10);
  const failedCount = parseInt(failed.failed ?? "0", 10);
  const successRate = totalCount > 0 ? Math.round(((totalCount - failedCount) / totalCount) * 10000) / 100 : 100;

  return {
    id: ep.id,
    workspace_id: ep.workspace_id,
    url: ep.url,
    active: ep.active,
    failure_count: ep.failure_count,
    last_failure_at: ep.last_failure_at,
    consecutive_failures: ep.failure_count,
    success_rate_pct: successRate,
  };
}

export interface DeliveryStats {
  workspace_id: string;
  total: number;
  pending: number;
  delivered: number;
  failed: number;
  success_rate_pct: number;
}

export async function getDeliveryStats(
  sql: Sql,
  workspaceId: string,
): Promise<DeliveryStats> {
  const [row] = await sql<{ total: string; pending: string; delivered: string; failed: string }[]>`
    SELECT
      COUNT(*)::text as total,
      COUNT(*) FILTER (WHERE status = 'pending')::text as pending,
      COUNT(*) FILTER (WHERE status = 'delivered')::text as delivered,
      COUNT(*) FILTER (WHERE status = 'failed')::text as failed
    FROM webhooks.deliveries
    WHERE workspace_id = ${workspaceId}`;

  const total = parseInt(row?.total ?? "0", 10);
  const delivered = parseInt(row?.delivered ?? "0", 10);
  return {
    workspace_id: workspaceId,
    total,
    pending: parseInt(row?.pending ?? "0", 10),
    delivered,
    failed: parseInt(row?.failed ?? "0", 10),
    success_rate_pct: total > 0 ? Math.round((delivered / total) * 10000) / 100 : 0,
  };
}
