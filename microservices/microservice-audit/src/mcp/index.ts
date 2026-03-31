#!/usr/bin/env bun
/**
 * MCP server for microservice-audit.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { logEvent, queryEvents, countEvents, getEvent, exportEvents } from "../lib/events.js";
import { setRetentionPolicy, getRetentionPolicy, applyRetention } from "../lib/retention.js";
import { getAuditStats } from "../lib/stats.js";

const server = new Server(
  { name: "microservice-audit", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "audit_log_event",
      description: "Log an immutable audit event",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", description: "Action performed (e.g. user.login, document.delete)" },
          resource_type: { type: "string", description: "Type of resource affected" },
          resource_id: { type: "string" },
          actor_id: { type: "string" },
          actor_type: { type: "string", enum: ["user", "system", "api_key"] },
          workspace_id: { type: "string" },
          ip: { type: "string" },
          user_agent: { type: "string" },
          metadata: { type: "object" },
          severity: { type: "string", enum: ["debug", "info", "warning", "error", "critical"] },
        },
        required: ["action", "resource_type"],
      },
    },
    {
      name: "audit_query_events",
      description: "Query audit events with filters",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          actor_id: { type: "string" },
          action: { type: "string" },
          resource_type: { type: "string" },
          resource_id: { type: "string" },
          severity: { type: "string", enum: ["debug", "info", "warning", "error", "critical"] },
          from: { type: "string", description: "ISO date string" },
          to: { type: "string", description: "ISO date string" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: [],
      },
    },
    {
      name: "audit_get_event",
      description: "Get a single audit event by ID",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "audit_count_events",
      description: "Count audit events matching filters",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          actor_id: { type: "string" },
          action: { type: "string" },
          resource_type: { type: "string" },
          resource_id: { type: "string" },
          severity: { type: "string", enum: ["debug", "info", "warning", "error", "critical"] },
          from: { type: "string" },
          to: { type: "string" },
        },
        required: [],
      },
    },
    {
      name: "audit_export_events",
      description: "Export audit events as JSON or CSV",
      inputSchema: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["json", "csv"] },
          workspace_id: { type: "string" },
          actor_id: { type: "string" },
          action: { type: "string" },
          resource_type: { type: "string" },
          severity: { type: "string", enum: ["debug", "info", "warning", "error", "critical"] },
          from: { type: "string" },
          to: { type: "string" },
        },
        required: ["format"],
      },
    },
    {
      name: "audit_set_retention",
      description: "Set the retention policy for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          retain_days: { type: "number", description: "Number of days to retain events" },
        },
        required: ["workspace_id", "retain_days"],
      },
    },
    {
      name: "audit_get_retention",
      description: "Get the retention policy for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "audit_apply_retention",
      description: "Apply retention policy and delete old events for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "audit_get_stats",
      description: "Get audit statistics for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          days: { type: "number", description: "Number of days to look back (default 30)" },
        },
        required: ["workspace_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb();
  const { name, arguments: args } = req.params;
  const a = args as Record<string, unknown>;

  const text = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  if (name === "audit_log_event") {
    return text(await logEvent(sql, {
      actorId: a.actor_id ? String(a.actor_id) : undefined,
      actorType: a.actor_type as "user" | "system" | "api_key" | undefined,
      action: String(a.action),
      resourceType: String(a.resource_type),
      resourceId: a.resource_id ? String(a.resource_id) : undefined,
      workspaceId: a.workspace_id ? String(a.workspace_id) : undefined,
      ip: a.ip ? String(a.ip) : undefined,
      userAgent: a.user_agent ? String(a.user_agent) : undefined,
      metadata: a.metadata as Record<string, unknown> | undefined,
      severity: a.severity as "debug" | "info" | "warning" | "error" | "critical" | undefined,
    }));
  }

  if (name === "audit_query_events") {
    return text(await queryEvents(sql, {
      workspaceId: a.workspace_id ? String(a.workspace_id) : undefined,
      actorId: a.actor_id ? String(a.actor_id) : undefined,
      action: a.action ? String(a.action) : undefined,
      resourceType: a.resource_type ? String(a.resource_type) : undefined,
      resourceId: a.resource_id ? String(a.resource_id) : undefined,
      severity: a.severity as "debug" | "info" | "warning" | "error" | "critical" | undefined,
      from: a.from ? new Date(String(a.from)) : undefined,
      to: a.to ? new Date(String(a.to)) : undefined,
      limit: a.limit ? Number(a.limit) : undefined,
      offset: a.offset ? Number(a.offset) : undefined,
    }));
  }

  if (name === "audit_get_event") {
    return text(await getEvent(sql, String(a.id)));
  }

  if (name === "audit_count_events") {
    return text({ count: await countEvents(sql, {
      workspaceId: a.workspace_id ? String(a.workspace_id) : undefined,
      actorId: a.actor_id ? String(a.actor_id) : undefined,
      action: a.action ? String(a.action) : undefined,
      resourceType: a.resource_type ? String(a.resource_type) : undefined,
      resourceId: a.resource_id ? String(a.resource_id) : undefined,
      severity: a.severity as "debug" | "info" | "warning" | "error" | "critical" | undefined,
      from: a.from ? new Date(String(a.from)) : undefined,
      to: a.to ? new Date(String(a.to)) : undefined,
    }) });
  }

  if (name === "audit_export_events") {
    return text(await exportEvents(sql, {
      workspaceId: a.workspace_id ? String(a.workspace_id) : undefined,
      actorId: a.actor_id ? String(a.actor_id) : undefined,
      action: a.action ? String(a.action) : undefined,
      resourceType: a.resource_type ? String(a.resource_type) : undefined,
      severity: a.severity as "debug" | "info" | "warning" | "error" | "critical" | undefined,
      from: a.from ? new Date(String(a.from)) : undefined,
      to: a.to ? new Date(String(a.to)) : undefined,
    }, (a.format as "json" | "csv") ?? "json"));
  }

  if (name === "audit_set_retention") {
    return text(await setRetentionPolicy(sql, String(a.workspace_id), Number(a.retain_days)));
  }

  if (name === "audit_get_retention") {
    return text(await getRetentionPolicy(sql, String(a.workspace_id)));
  }

  if (name === "audit_apply_retention") {
    const deleted = await applyRetention(sql, String(a.workspace_id));
    return text({ deleted });
  }

  if (name === "audit_get_stats") {
    const days = a.days ? Number(a.days) : 30;
    return text(await getAuditStats(sql, String(a.workspace_id), days));
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  const sql = getDb();
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
