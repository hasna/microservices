import type { Sql } from "postgres";

export interface HealthReport {
  total: number;
  active: number;
  idle: number;
  stopped: number;
  error: number;
  stale_threshold_minutes: number;
}

export async function markStaleAgents(
  sql: Sql,
  thresholdMinutes: number = 5,
): Promise<number> {
  const r = await sql`
    UPDATE agents.agents SET status = 'stopped', updated_at = NOW()
    WHERE status IN ('active', 'idle')
      AND last_heartbeat_at IS NOT NULL
      AND last_heartbeat_at < NOW() - (${thresholdMinutes} || ' minutes')::interval
  `;
  return r.count;
}

export async function getAgentHealth(
  sql: Sql,
  workspaceId: string,
): Promise<HealthReport> {
  const [r] = await sql<
    [
      {
        total: string;
        active: string;
        idle: string;
        stopped: string;
        error: string;
      },
    ]
  >`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'active')::int AS active,
      COUNT(*) FILTER (WHERE status = 'idle')::int AS idle,
      COUNT(*) FILTER (WHERE status = 'stopped')::int AS stopped,
      COUNT(*) FILTER (WHERE status = 'error')::int AS error
    FROM agents.agents WHERE workspace_id = ${workspaceId}`;
  return {
    total: Number(r.total),
    active: Number(r.active),
    idle: Number(r.idle),
    stopped: Number(r.stopped),
    error: Number(r.error),
    stale_threshold_minutes: 5,
  };
}
