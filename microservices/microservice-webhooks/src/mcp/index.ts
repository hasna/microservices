#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { createEndpoint, listWorkspaceEndpoints, deleteEndpoint } from "../lib/endpoints.js";
import { triggerWebhook, listDeliveries, replayDelivery } from "../lib/deliver.js";

const server = new Server({ name: "microservice-webhooks", version: "0.0.1" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  {
    name: "webhooks_register_endpoint",
    description: "Register a new webhook endpoint for a workspace",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string", description: "Workspace UUID" },
        url: { type: "string", description: "Endpoint URL to deliver to" },
        secret: { type: "string", description: "HMAC secret for signature verification" },
        events: { type: "array", items: { type: "string" }, description: "Event filter (empty = all events)" },
      },
      required: ["workspace_id", "url"],
    },
  },
  {
    name: "webhooks_trigger",
    description: "Trigger a webhook event for all matching active endpoints in a workspace",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        event: { type: "string" },
        payload: { type: "object" },
      },
      required: ["workspace_id", "event", "payload"],
    },
  },
  {
    name: "webhooks_list_deliveries",
    description: "List webhook deliveries for a workspace",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        status: { type: "string", enum: ["pending", "delivered", "failed"] },
      },
      required: [],
    },
  },
  {
    name: "webhooks_replay_delivery",
    description: "Replay (retry) a webhook delivery",
    inputSchema: {
      type: "object",
      properties: { delivery_id: { type: "string" } },
      required: ["delivery_id"],
    },
  },
  {
    name: "webhooks_list_endpoints",
    description: "List all registered webhook endpoints for a workspace",
    inputSchema: {
      type: "object",
      properties: { workspace_id: { type: "string" } },
      required: ["workspace_id"],
    },
  },
  {
    name: "webhooks_delete_endpoint",
    description: "Delete a webhook endpoint",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
]}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb();
  const { name, arguments: args } = req.params;
  const a = args as Record<string, unknown>;
  const t = (d: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(d, null, 2) }] });

  if (name === "webhooks_register_endpoint") {
    return t(await createEndpoint(sql, {
      workspace_id: String(a.workspace_id),
      url: String(a.url),
      secret: a.secret as string | undefined,
      events: a.events as string[] | undefined,
    }));
  }
  if (name === "webhooks_trigger") {
    await triggerWebhook(sql, String(a.workspace_id), String(a.event), a.payload as Record<string, unknown>);
    return t({ ok: true });
  }
  if (name === "webhooks_list_deliveries") {
    return t(await listDeliveries(sql, {
      workspaceId: a.workspace_id ? String(a.workspace_id) : undefined,
      status: a.status ? String(a.status) : undefined,
    }));
  }
  if (name === "webhooks_replay_delivery") {
    await replayDelivery(sql, String(a.delivery_id));
    return t({ ok: true });
  }
  if (name === "webhooks_list_endpoints") {
    return t(await listWorkspaceEndpoints(sql, String(a.workspace_id)));
  }
  if (name === "webhooks_delete_endpoint") {
    return t({ deleted: await deleteEndpoint(sql, String(a.id)) });
  }
  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const sql = getDb();
  await migrate(sql);
  await server.connect(new StdioServerTransport());
}
main().catch(console.error);
