import type { Sql } from "postgres";

export interface AuditStats {
  total_events: number;
  top_actions: { action: string; count: number }[];
  top_actors: { actor_id: string; count: number }[];
  events_per_day: { date: string; count: number }[];
  severity_breakdown: { severity: string; count: number }[];
}

export async function getAuditStats(
  sql: Sql,
  workspaceId: string,
  days = 30,
): Promise<AuditStats> {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const [{ total }] = await sql<[{ total: string }]>`
    SELECT COUNT(*) as total FROM audit.events
    WHERE workspace_id = ${workspaceId} AND created_at >= ${since}`;

  const top_actions = await sql<{ action: string; count: string }[]>`
    SELECT action, COUNT(*) as count FROM audit.events
    WHERE workspace_id = ${workspaceId} AND created_at >= ${since}
    GROUP BY action ORDER BY count DESC LIMIT 10`;

  const top_actors = await sql<{ actor_id: string; count: string }[]>`
    SELECT actor_id::text, COUNT(*) as count FROM audit.events
    WHERE workspace_id = ${workspaceId} AND created_at >= ${since} AND actor_id IS NOT NULL
    GROUP BY actor_id ORDER BY count DESC LIMIT 10`;

  const events_per_day = await sql<{ date: string; count: string }[]>`
    SELECT DATE(created_at)::text as date, COUNT(*) as count FROM audit.events
    WHERE workspace_id = ${workspaceId} AND created_at >= ${since}
    GROUP BY DATE(created_at) ORDER BY date`;

  const severity_breakdown = await sql<{ severity: string; count: string }[]>`
    SELECT severity, COUNT(*) as count FROM audit.events
    WHERE workspace_id = ${workspaceId} AND created_at >= ${since}
    GROUP BY severity ORDER BY count DESC`;

  return {
    total_events: parseInt(total, 10),
    top_actions: top_actions.map((r) => ({
      action: r.action,
      count: parseInt(r.count, 10),
    })),
    top_actors: top_actors.map((r) => ({
      actor_id: r.actor_id,
      count: parseInt(r.count, 10),
    })),
    events_per_day: events_per_day.map((r) => ({
      date: r.date,
      count: parseInt(r.count, 10),
    })),
    severity_breakdown: severity_breakdown.map((r) => ({
      severity: r.severity,
      count: parseInt(r.count, 10),
    })),
  };
}
