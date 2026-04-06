#!/usr/bin/env bun
/**
 * MCP server for microservice-audit.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import {
  countEvents,
  exportEvents,
  getEvent,
  logEvent,
  queryEvents,
} from "../lib/events.js";
import {
  applyRetention,
  getRetentionPolicy,
  setRetentionPolicy,
} from "../lib/retention.js";
import { getAuditStats } from "../lib/stats.js";
import { computeChecksum, VALID_SEVERITY_LEVELS } from "../lib/events.js";

const server = new McpServer({
  name: "microservice-audit",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const SeveritySchema = z.enum(["debug", "info", "warning", "error", "critical"]);
const ActorTypeSchema = z.enum(["user", "system", "api_key"]);

server.tool(
  "audit_log_event",
  "Log an immutable audit event",
  {
    action: z.string().describe("Action performed (e.g. user.login, document.delete)"),
    resource_type: z.string().describe("Type of resource affected"),
    resource_id: z.string().optional(),
    actor_id: z.string().optional(),
    actor_type: ActorTypeSchema.optional(),
    workspace_id: z.string().optional(),
    ip: z.string().optional(),
    user_agent: z.string().optional(),
    metadata: z.record(z.any()).optional(),
    severity: SeveritySchema.optional().default("info"),
  },
  async ({ actor_id, actor_type, resource_type, resource_id, workspace_id, user_agent, ...rest }) =>
    text(
      await logEvent(sql, {
        actorId: actor_id,
        actorType: actor_type,
        resourceType: resource_type,
        resourceId: resource_id,
        workspaceId: workspace_id,
        userAgent: user_agent,
        ...rest,
      }),
    ),
);

server.tool(
  "audit_query_events",
  "Query audit events with filters",
  {
    workspace_id: z.string().optional(),
    actor_id: z.string().optional(),
    action: z.string().optional(),
    resource_type: z.string().optional(),
    resource_id: z.string().optional(),
    severity: SeveritySchema.optional(),
    from: z.string().optional().describe("ISO date string"),
    to: z.string().optional().describe("ISO date string"),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ workspace_id, actor_id, resource_type, resource_id, from, to, ...rest }) =>
    text(
      await queryEvents(sql, {
        workspaceId: workspace_id,
        actorId: actor_id,
        resourceType: resource_type,
        resourceId: resource_id,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        ...rest,
      }),
    ),
);

server.tool(
  "audit_get_event",
  "Get a single audit event by ID",
  { id: z.string() },
  async ({ id }) => text(await getEvent(sql, id)),
);

server.tool(
  "audit_count_events",
  "Count audit events matching filters",
  {
    workspace_id: z.string().optional(),
    actor_id: z.string().optional(),
    action: z.string().optional(),
    resource_type: z.string().optional(),
    resource_id: z.string().optional(),
    severity: SeveritySchema.optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  },
  async ({ workspace_id, actor_id, resource_type, resource_id, from, to, ...rest }) =>
    text({
      count: await countEvents(sql, {
        workspaceId: workspace_id,
        actorId: actor_id,
        resourceType: resource_type,
        resourceId: resource_id,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        ...rest,
      }),
    }),
);

server.tool(
  "audit_export_events",
  "Export audit events as JSON or CSV",
  {
    format: z.enum(["json", "csv"]),
    workspace_id: z.string().optional(),
    actor_id: z.string().optional(),
    action: z.string().optional(),
    resource_type: z.string().optional(),
    severity: SeveritySchema.optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  },
  async ({ workspace_id, actor_id, resource_type, from, to, format, ...rest }) =>
    text(
      await exportEvents(
        sql,
        {
          workspaceId: workspace_id,
          actorId: actor_id,
          resourceType: resource_type,
          from: from ? new Date(from) : undefined,
          to: to ? new Date(to) : undefined,
          ...rest,
        },
        format,
      ),
    ),
);

server.tool(
  "audit_set_retention",
  "Set the retention policy for a workspace",
  {
    workspace_id: z.string(),
    retain_days: z.number().describe("Number of days to retain events"),
  },
  async ({ workspace_id, retain_days }) =>
    text(await setRetentionPolicy(sql, workspace_id, retain_days)),
);

server.tool(
  "audit_get_retention",
  "Get the retention policy for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await getRetentionPolicy(sql, workspace_id)),
);

server.tool(
  "audit_apply_retention",
  "Apply retention policy and delete old events for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text({ deleted: await applyRetention(sql, workspace_id) }),
);

server.tool(
  "audit_get_stats",
  "Get audit statistics for a workspace",
  {
    workspace_id: z.string(),
    days: z.number().optional().default(30).describe("Number of days to look back"),
  },
  async ({ workspace_id, days }) => text(await getAuditStats(sql, workspace_id, days)),
);

server.tool(
  "audit_verify_event_checksum",
  "Verify an event's integrity by recomputing and comparing its checksum",
  { id: z.string() },
  async ({ id }) => {
    const event = await getEvent(sql, id);
    if (!event) return text({ valid: false, error: "Event not found" });
    const expected = computeChecksum({
      actor_id: event.actor_id,
      action: event.action,
      resource_type: event.resource_type,
      resource_id: event.resource_id,
      workspace_id: event.workspace_id,
      created_at: event.created_at,
    });
    return text({ valid: event.checksum === expected, stored: event.checksum, computed: expected });
  },
);

server.tool(
  "audit_get_event_by_checksum",
  "Look up an audit event by its integrity checksum",
  { checksum: z.string() },
  async ({ checksum }) => {
    const [event] = await sql`SELECT * FROM audit.events WHERE checksum = ${checksum} LIMIT 1`;
    return text(event || null);
  },
);

server.tool(
  "audit_compute_checksum",
  "Compute the integrity checksum for given event fields (useful for pre-insert verification)",
  {
    actor_id: z.string().optional(),
    action: z.string(),
    resource_type: z.string(),
    resource_id: z.string().optional(),
    workspace_id: z.string().optional(),
    created_at: z.string(),
  },
  async ({ actor_id, action, resource_type, resource_id, workspace_id, created_at }) =>
    text({ checksum: computeChecksum({ actor_id: actor_id ?? null, action, resource_type, resource_id: resource_id ?? null, workspace_id: workspace_id ?? null, created_at }) }),
);

server.tool(
  "audit_get_valid_severity_levels",
  "Return the list of valid audit severity levels",
  {},
  async () => text(VALID_SEVERITY_LEVELS),
);

// ─── Advanced Analytics ───────────────────────────────────────────────────────────────────

server.tool(
  "audit_correlate_events",
  "Find audit events that are likely related — same actor, IP, or user agent within a time window",
  {
    seed_event_id: z.string().describe("Event to find related events for"),
    window_minutes: z.number().optional().default(30),
    limit: z.number().optional().default(20),
  },
  async ({ seed_event_id, window_minutes, limit }) => {
    const [seed] = await sql`SELECT * FROM audit.events WHERE id = ${seed_event_id}`;
    if (!seed) return text({ correlated: [], message: "Seed event not found" });
    const windowMs = (window_minutes ?? 30) * 60 * 1000;
    const from = new Date(seed.created_at.getTime() - windowMs).toISOString();
    const to = new Date(seed.created_at.getTime() + windowMs).toISOString();
    const rows = await sql`
      SELECT * FROM audit.events
      WHERE id != ${seed_event_id}
        AND created_at BETWEEN ${from} AND ${to}
        AND (
          (actor_id = ${seed.actor_id} AND actor_id IS NOT NULL)
          OR (ip = ${seed.ip} AND ip IS NOT NULL)
          OR (user_agent = ${seed.user_agent} AND user_agent IS NOT NULL)
        )
      ORDER BY created_at ASC LIMIT ${limit ?? 20}`;
    return text({ seed_event: seed, correlated: rows });
  },
);

server.tool(
  "audit_get_event_timeline",
  "Get a timeline of audit events for a specific actor or resource — useful for forensics",
  {
    actor_id: z.string().optional(),
    resource_id: z.string().optional(),
    workspace_id: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.number().optional().default(100),
  },
  async ({ actor_id, resource_id, workspace_id, from, to, limit }) => {
    const timeline = await sql`
      SELECT id, action, resource_type, resource_id, severity, ip, created_at,
             json_metadata = 'null'::jsonb OR json_metadata IS NULL as has_metadata,
             CASE WHEN json_metadata = 'null'::jsonb OR json_metadata IS NULL THEN null ELSE json_metadata END as metadata
      FROM audit.events
      WHERE ${actor_id ? sql`actor_id = ${actor_id}` : sql`true`}
        AND ${resource_id ? sql`resource_id = ${resource_id}` : sql`true`}
        AND ${workspace_id ? sql`workspace_id = ${workspace_id}` : sql`true`}
        AND ${from ? sql`created_at >= ${from}` : sql`true`}
        AND ${to ? sql`created_at <= ${to}` : sql`true`}
      ORDER BY created_at DESC LIMIT ${limit ?? 100}`;
    return text({ timeline });
  },
);

server.tool(
  "audit_detect_anomaly_spike",
  "Detect whether there is an unusual spike in audit event volume for a workspace",
  {
    workspace_id: z.string(),
    threshold_multiplier: z.number().optional().default(3).describe("Std-dev multiplier to flag as anomaly"),
    hours: z.number().optional().default(24),
  },
  async ({ workspace_id, threshold_multiplier, hours }) => {
    const since = new Date(Date.now() - (hours ?? 24) * 3600000).toISOString();
    const [stats] = await sql<{ avg_count: string; stddev: string }[]>`
      WITH hourly_counts AS (
        SELECT DATE_TRUNC('hour', created_at) as hour, COUNT(*)::text as cnt
        FROM audit.events
        WHERE workspace_id = ${workspace_id} AND created_at >= ${since}
        GROUP BY DATE_TRUNC('hour', created_at)
      )
      SELECT COALESCE(AVG(cnt::int)::text, '0') as avg_count,
             COALESCE(STDDEV(cnt::int)::text, '0') as stddev
      FROM hourly_counts`;
    const avg = parseFloat(stats.avg_count);
    const std = parseFloat(stats.stddev);
    const [latest] = await sql<{ cnt: string }[]>`
      SELECT COUNT(*)::text as cnt FROM audit.events
      WHERE workspace_id = ${workspace_id}
        AND created_at >= ${new Date(Date.now() - 3600000).toISOString()}`;
    const latestCount = parseInt(latest.cnt, 10);
    const isAnomaly = std > 0 && latestCount > avg + (threshold_multiplier ?? 3) * std;
    return text({
      latest_hour_count: latestCount,
      average_hourly_count: avg,
      standard_deviation: std,
      threshold: avg + ((threshold_multiplier ?? 3) * std),
      is_anomaly: isAnomaly,
      message: isAnomaly ? "Spike detected — check for suspicious activity" : "No anomaly detected",
    });
  },
);

server.tool(
  "audit_get_resource_compliance_report",
  "Get a compliance report for a resource type — counts by action and severity, useful for access reviews",
  {
    workspace_id: z.string(),
    resource_type: z.string(),
    from: z.string().optional(),
    to: z.string().optional(),
  },
  async ({ workspace_id, resource_type, from, to }) => {
    const since = from ?? new Date(Date.now() - 30 * 86400000).toISOString();
    const until = to ?? new Date().toISOString();
    const [byAction] = await sql<{ action: string; count: string; severity_breakdown: { severity: string; cnt: string }[] }[]>`
      SELECT action, COUNT(*)::text as count,
             json_agg(json_build_object('severity', severity, 'cnt', 1)) as severity_breakdown
      FROM audit.events
      WHERE workspace_id = ${workspace_id}
        AND resource_type = ${resource_type}
        AND created_at BETWEEN ${since} AND ${until}
      GROUP BY action
      ORDER BY count DESC`;
    const [total] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::text as total FROM audit.events
      WHERE workspace_id = ${workspace_id}
        AND resource_type = ${resource_type}
        AND created_at BETWEEN ${since} AND ${until}`;
    const [criticalCount] = await sql<{ cnt: string }[]>`
      SELECT COUNT(*)::text as cnt FROM audit.events
      WHERE workspace_id = ${workspace_id}
        AND resource_type = ${resource_type}
        AND severity = 'critical'
        AND created_at BETWEEN ${since} AND ${until}`;
    const [uniqueActors] = await sql<{ cnt: string }[]>`
      SELECT COUNT(DISTINCT actor_id)::text as cnt FROM audit.events
      WHERE workspace_id = ${workspace_id}
        AND resource_type = ${resource_type}
        AND actor_id IS NOT NULL
        AND created_at BETWEEN ${since} AND ${until}`;
    return text({
      workspace_id,
      resource_type,
      period_from: since,
      period_to: until,
      total_events: parseInt(total.total, 10),
      critical_events: parseInt(criticalCount.cnt, 10),
      unique_actors: parseInt(uniqueActors.cnt, 10),
      by_action: byAction.map((r) => ({ action: r.action, count: parseInt(r.count, 10) })),
    });
  },
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
