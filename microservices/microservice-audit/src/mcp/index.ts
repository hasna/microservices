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

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
