#!/usr/bin/env bun
/**
 * MCP server for microservice-usage.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import {
  checkQuota,
  getQuota,
  getUsageSummary,
  isValidPeriod,
  listMetrics,
  setQuota,
  VALID_PERIODS,
} from "../lib/query.js";
import { getPeriodStart, track } from "../lib/track.js";

const server = new Server(
  { name: "microservice-usage", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "usage_track",
      description: "Track a usage event for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace UUID" },
          metric: {
            type: "string",
            description: "Metric name (e.g. api.calls, storage.gb)",
          },
          quantity: { type: "number", description: "Amount consumed" },
          unit: {
            type: "string",
            description: "Unit of measure (default: count)",
          },
          metadata: {
            type: "object",
            description: "Optional key-value metadata",
          },
        },
        required: ["workspace_id", "metric", "quantity"],
      },
    },
    {
      name: "usage_get_summary",
      description: "Get usage summary for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          metric: { type: "string", description: "Filter by metric name" },
          since: {
            type: "string",
            description:
              "ISO date string — only include events after this date",
          },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "usage_check_quota",
      description: "Check whether current usage is within the configured quota",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          metric: { type: "string" },
          period: {
            type: "string",
            enum: ["hour", "day", "month", "total"],
            description: "Period to check (default: month)",
          },
        },
        required: ["workspace_id", "metric"],
      },
    },
    {
      name: "usage_set_quota",
      description: "Set or update the quota for a workspace and metric",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          metric: { type: "string" },
          limit_value: {
            type: "number",
            description: "Maximum allowed usage in the period",
          },
          period: {
            type: "string",
            enum: ["hour", "day", "month", "total"],
            description: "Period (default: month)",
          },
          hard_limit: {
            type: "boolean",
            description: "If true, enforce hard block when limit is exceeded",
          },
        },
        required: ["workspace_id", "metric", "limit_value"],
      },
    },
    {
      name: "usage_list_metrics",
      description: "List all distinct metrics tracked for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "usage_get_quota",
      description: "Get the configured quota (limit) for a workspace and metric",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          metric: { type: "string" },
          period: {
            type: "string",
            enum: ["hour", "day", "month", "total"],
          },
        },
        required: ["workspace_id", "metric"],
      },
    },
    {
      name: "usage_get_valid_periods",
      description: "Get the list of valid period strings for quota configuration",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "usage_check_period_valid",
      description: "Check whether a period string is valid",
      inputSchema: {
        type: "object",
        properties: {
          period: { type: "string" },
        },
        required: ["period"],
      },
    },
    {
      name: "usage_get_period_start",
      description: "Get the start date of the current period for a given period type",
      inputSchema: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["hour", "day", "month"],
          },
        },
        required: ["period"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb();
  const { name, arguments: args } = req.params;
  const a = args as any;

  const text = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  if (name === "usage_track") {
    await track(sql, {
      workspaceId: String(a.workspace_id),
      metric: String(a.metric),
      quantity: Number(a.quantity),
      unit: a.unit ? String(a.unit) : undefined,
      metadata: a.metadata as any | undefined,
    });
    return text({ ok: true });
  }

  if (name === "usage_get_summary") {
    return text(
      await getUsageSummary(
        sql,
        String(a.workspace_id),
        a.metric ? String(a.metric) : undefined,
        a.since ? new Date(String(a.since)) : undefined,
      ),
    );
  }

  if (name === "usage_check_quota") {
    return text(
      await checkQuota(
        sql,
        String(a.workspace_id),
        String(a.metric),
        a.period ? String(a.period) : "month",
      ),
    );
  }

  if (name === "usage_set_quota") {
    await setQuota(
      sql,
      String(a.workspace_id),
      String(a.metric),
      Number(a.limit_value),
      a.period ? String(a.period) : "month",
      a.hard_limit ? Boolean(a.hard_limit) : false,
    );
    return text({ ok: true });
  }

  if (name === "usage_list_metrics") {
    return text(await listMetrics(sql, String(a.workspace_id)));
  }

  if (name === "usage_get_quota") {
    return text(await getQuota(
      sql,
      String(a.workspace_id),
      String(a.metric),
      a.period ? String(a.period) : "month",
    ));
  }

  if (name === "usage_get_valid_periods") {
    return text({ valid_periods: VALID_PERIODS });
  }

  if (name === "usage_check_period_valid") {
    return text({ valid: isValidPeriod(String(a.period)) });
  }

  if (name === "usage_get_period_start") {
    return text({ period_start: getPeriodStart(String(a.period)) });
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
