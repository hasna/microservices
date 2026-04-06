#!/usr/bin/env bun
/**
 * MCP server for microservice-onboarding.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { createFlow, deleteFlow, getFlow, getFlowByName, listFlows, updateFlow } from "../lib/flows.js";
import {
  getProgress,
  getUserFlows,
  isComplete,
  markStep,
  resetProgress,
  startFlow,
} from "../lib/progress.js";

const server = new Server(
  { name: "microservice-onboarding", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "onboarding_create_flow",
      description: "Create a new onboarding flow with steps",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
                required: { type: "boolean" },
              },
              required: ["id", "title"],
            },
          },
        },
        required: ["name", "steps"],
      },
    },
    {
      name: "onboarding_list_flows",
      description: "List all onboarding flows",
      inputSchema: {
        type: "object",
        properties: { active_only: { type: "boolean" } },
        required: [],
      },
    },
    {
      name: "onboarding_get_progress",
      description: "Get onboarding progress for a user on a specific flow",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string" },
          flow_id: { type: "string" },
        },
        required: ["user_id", "flow_id"],
      },
    },
    {
      name: "onboarding_mark_step",
      description: "Mark a step as completed for a user",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string" },
          flow_id: { type: "string" },
          step_id: { type: "string" },
        },
        required: ["user_id", "flow_id", "step_id"],
      },
    },
    {
      name: "onboarding_start_flow",
      description:
        "Start an onboarding flow for a user (creates progress record, idempotent)",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string" },
          flow_id: { type: "string" },
          workspace_id: { type: "string" },
        },
        required: ["user_id", "flow_id"],
      },
    },
    {
      name: "onboarding_is_complete",
      description: "Check if a user has completed an onboarding flow",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string" },
          flow_id: { type: "string" },
        },
        required: ["user_id", "flow_id"],
      },
    },
    {
      name: "onboarding_reset",
      description: "Reset a user's onboarding progress for a flow",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string" },
          flow_id: { type: "string" },
        },
        required: ["user_id", "flow_id"],
      },
    },
    {
      name: "onboarding_get_flow",
      description: "Get a flow by ID",
      inputSchema: { type: "object", properties: { flow_id: { type: "string" } }, required: ["flow_id"] },
    },
    {
      name: "onboarding_get_flow_by_name",
      description: "Get a flow by its unique name",
      inputSchema: { type: "object", properties: { name: { type: "string" }, workspace_id: { type: "string" } }, required: ["name"] },
    },
    {
      name: "onboarding_update_flow",
      description: "Update a flow's name, description, or steps",
      inputSchema: {
        type: "object",
        properties: {
          flow_id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          steps: { type: "array" },
          active: { type: "boolean" },
        },
        required: ["flow_id"],
      },
    },
    {
      name: "onboarding_delete_flow",
      description: "Delete an onboarding flow",
      inputSchema: { type: "object", properties: { flow_id: { type: "string" } }, required: ["flow_id"] },
    },
    {
      name: "onboarding_get_user_flows",
      description: "Get all flows and their completion status for a user",
      inputSchema: { type: "object", properties: { user_id: { type: "string" } }, required: ["user_id"] },
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

  if (name === "onboarding_create_flow") {
    return text(
      await createFlow(sql, {
        name: String(a.name),
        description: a.description ? String(a.description) : undefined,
        steps: a.steps as Parameters<typeof createFlow>[1]["steps"],
      }),
    );
  }

  if (name === "onboarding_list_flows") {
    return text(await listFlows(sql, Boolean(a.active_only)));
  }

  if (name === "onboarding_get_progress") {
    return text(await getProgress(sql, String(a.user_id), String(a.flow_id)));
  }

  if (name === "onboarding_mark_step") {
    return text(
      await markStep(
        sql,
        String(a.user_id),
        String(a.flow_id),
        String(a.step_id),
      ),
    );
  }

  if (name === "onboarding_start_flow") {
    return text(
      await startFlow(
        sql,
        String(a.user_id),
        String(a.flow_id),
        a.workspace_id ? String(a.workspace_id) : undefined,
      ),
    );
  }

  if (name === "onboarding_is_complete") {
    return text({
      is_complete: await isComplete(sql, String(a.user_id), String(a.flow_id)),
    });
  }

  if (name === "onboarding_reset") {
    await resetProgress(sql, String(a.user_id), String(a.flow_id));
    return text({ ok: true });
  }

  if (name === "onboarding_get_flow") {
    return text(await getFlow(sql, String(a.flow_id)));
  }

  if (name === "onboarding_get_flow_by_name") {
    return text(await getFlowByName(sql, String(a.name), a.workspace_id ? String(a.workspace_id) : undefined));
  }

  if (name === "onboarding_update_flow") {
    const { flow_id, ...rest } = a;
    return text(await updateFlow(sql, String(flow_id), rest));
  }

  if (name === "onboarding_delete_flow") {
    return text({ deleted: await deleteFlow(sql, String(a.flow_id)) });
  }

  if (name === "onboarding_get_user_flows") {
    return text(await getUserFlows(sql, String(a.user_id)));
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
