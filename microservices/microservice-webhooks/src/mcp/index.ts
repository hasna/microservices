#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import {
  backoffSeconds,
  computeSignature,
  listDeliveries,
  matchesEvent,
  processDelivery,
  processPendingDeliveries,
  replayDelivery,
  triggerWebhook,
} from "../lib/deliver.js";
import {
  createEndpoint,
  deleteEndpoint,
  disableEndpoint,
  getEndpoint,
  getEndpointHealth,
  getDeliveryStats,
  listWorkspaceEndpoints,
  updateEndpoint,
} from "../lib/endpoints.js";

const server = new Server(
  { name: "microservice-webhooks", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "webhooks_register_endpoint",
      description: "Register a new webhook endpoint for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace UUID" },
          url: { type: "string", description: "Endpoint URL to deliver to" },
          secret: {
            type: "string",
            description: "HMAC secret for signature verification",
          },
          events: {
            type: "array",
            items: { type: "string" },
            description: "Event filter (empty = all events)",
          },
        },
        required: ["workspace_id", "url"],
      },
    },
    {
      name: "webhooks_trigger",
      description:
        "Trigger a webhook event for all matching active endpoints in a workspace",
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
    {
      name: "webhooks_get_endpoint",
      description: "Get a webhook endpoint by ID",
      inputSchema: { type: "object", properties: { endpoint_id: { type: "string" } }, required: ["endpoint_id"] },
    },
    {
      name: "webhooks_update_endpoint",
      description: "Update a webhook endpoint's URL, events, or active status",
      inputSchema: {
        type: "object",
        properties: {
          endpoint_id: { type: "string" },
          url: { type: "string" },
          events: { type: "array", items: { type: "string" } },
          active: { type: "boolean" },
        },
        required: ["endpoint_id"],
      },
    },
    {
      name: "webhooks_disable_endpoint",
      description: "Disable a webhook endpoint",
      inputSchema: { type: "object", properties: { endpoint_id: { type: "string" } }, required: ["endpoint_id"] },
    },
    {
      name: "webhooks_compute_signature",
      description: "Compute HMAC-SHA256 signature for a webhook payload (for verifying outbound webhooks)",
      inputSchema: {
        type: "object",
        properties: {
          secret: { type: "string" },
          payload: { type: "string" },
          timestamp: { type: "string" }.optional(),
        },
        required: ["secret", "payload"],
      },
    },
    {
      name: "webhooks_process_pending",
      description: "Process all pending webhook deliveries (run as a cron job)",
      inputSchema: { type: "object", properties: { limit: { type: "number" } } },
    },
    {
      name: "webhooks_matches_event",
      description: "Check if a given event matches a list of endpoint event filters (useful for debugging event routing)",
      inputSchema: {
        type: "object",
        properties: {
          endpoint_events: { type: "array", items: { type: "string" }, description: "Event filters on the endpoint (empty = all events)" },
          event: { type: "string", description: "The incoming event name to test" },
        },
        required: ["endpoint_events", "event"],
      },
    },
    {
      name: "webhooks_get_backoff_seconds",
      description: "Compute the backoff delay for a webhook delivery attempt (exponential backoff)",
      inputSchema: {
        type: "object",
        properties: {
          attempt: { type: "number", description: "Current attempt number (1-based)" },
        },
        required: ["attempt"],
      },
    },
    {
      name: "webhooks_process_delivery",
      description: "Process/retry a single webhook delivery by ID (use after fixing the underlying issue)",
      inputSchema: {
        type: "object",
        properties: {
          delivery_id: { type: "string", description: "Delivery UUID to process" },
        },
        required: ["delivery_id"],
      },
    },
    {
      name: "webhooks_get_endpoint_health",
      description: "Get health and success-rate statistics for a webhook endpoint",
      inputSchema: {
        type: "object",
        properties: {
          endpoint_id: { type: "string", description: "Endpoint UUID" },
        },
        required: ["endpoint_id"],
      },
    },
    {
      name: "webhooks_get_delivery_stats",
      description: "Get aggregate delivery statistics (total, pending, delivered, failed, success rate) for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace UUID" },
        },
        required: ["workspace_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb();
  const { name, arguments: args } = req.params;
  const a = args as any;
  const t = (d: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(d, null, 2) }],
  });

  if (name === "webhooks_register_endpoint") {
    return t(
      await createEndpoint(sql, {
        workspace_id: String(a.workspace_id),
        url: String(a.url),
        secret: a.secret as string | undefined,
        events: a.events as string[] | undefined,
      }),
    );
  }
  if (name === "webhooks_trigger") {
    await triggerWebhook(
      sql,
      String(a.workspace_id),
      String(a.event),
      a.payload as any,
    );
    return t({ ok: true });
  }
  if (name === "webhooks_list_deliveries") {
    return t(
      await listDeliveries(sql, {
        workspaceId: a.workspace_id ? String(a.workspace_id) : undefined,
        status: a.status ? String(a.status) : undefined,
      }),
    );
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
  if (name === "webhooks_get_endpoint") {
    return t(await getEndpoint(sql, String(a.endpoint_id)));
  }
  if (name === "webhooks_update_endpoint") {
    const { endpoint_id, ...rest } = a;
    return t(await updateEndpoint(sql, String(endpoint_id), rest));
  }
  if (name === "webhooks_disable_endpoint") {
    return t({ disabled: await disableEndpoint(sql, String(a.endpoint_id)) });
  }
  if (name === "webhooks_compute_signature") {
    const { secret, payload, timestamp } = a;
    return t({
      signature: computeSignature(String(secret), String(payload), timestamp ? String(timestamp) : undefined),
      algorithm: "HMAC-SHA256",
    });
  }
  if (name === "webhooks_process_pending") {
    const processed = await processPendingDeliveries(sql, a.limit ? Number(a.limit) : undefined);
    return t({ processed });
  }
  if (name === "webhooks_matches_event") {
    return t({ matches: matchesEvent(a.endpoint_events as string[], String(a.event)) });
  }
  if (name === "webhooks_get_backoff_seconds") {
    return t({ backoff_seconds: backoffSeconds(Number(a.attempt)) });
  }
  if (name === "webhooks_process_delivery") {
    await processDelivery(sql, String(a.delivery_id));
    return t({ ok: true });
  }
  if (name === "webhooks_get_endpoint_health") {
    return t(await getEndpointHealth(sql, String(a.endpoint_id)));
  }
  if (name === "webhooks_get_delivery_stats") {
    return t(await getDeliveryStats(sql, String(a.workspace_id)));
  }
  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const sql = getDb();
  await migrate(sql);
  await server.connect(new StdioServerTransport());
}
main().catch(console.error);
