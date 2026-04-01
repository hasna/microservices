#!/usr/bin/env bun
/**
 * MCP server for microservice-agents.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { getAgentHealth } from "../lib/health.js";
import { receiveMessages, sendMessage } from "../lib/messaging.js";
import {
  deregisterAgent,
  getAgent,
  heartbeat,
  listAgents,
  registerAgent,
} from "../lib/registry.js";
import { findAgentByCapability } from "../lib/routing.js";
import { claimTask, createTask, listTasks } from "../lib/tasks.js";

const server = new McpServer({
  name: "microservice-agents",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

server.tool(
  "agents_register",
  "Register a new agent",
  {
    workspace_id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    model: z.string().optional(),
    version: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    config: z.record(z.any()).optional(),
    max_concurrent: z.number().optional(),
  },
  async ({ workspace_id, name, max_concurrent, ...rest }) =>
    text(
      await registerAgent(sql, {
        workspaceId: workspace_id,
        name,
        maxConcurrent: max_concurrent,
        ...rest,
      }),
    ),
);

server.tool(
  "agents_deregister",
  "Deregister an agent",
  { id: z.string() },
  async ({ id }) => text({ deleted: await deregisterAgent(sql, id) }),
);

server.tool(
  "agents_list",
  "List agents in a workspace",
  {
    workspace_id: z.string(),
    status: z.string().optional(),
    capability: z.string().optional(),
  },
  async ({ workspace_id, ...opts }) =>
    text(await listAgents(sql, workspace_id, opts)),
);

server.tool(
  "agents_get",
  "Get agent by ID",
  { id: z.string() },
  async ({ id }) => text(await getAgent(sql, id)),
);

server.tool(
  "agents_heartbeat",
  "Send agent heartbeat",
  { agent_id: z.string() },
  async ({ agent_id }) => text(await heartbeat(sql, agent_id)),
);

server.tool(
  "agents_get_health",
  "Get agent health report for workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await getAgentHealth(sql, workspace_id)),
);

server.tool(
  "agents_find_by_capability",
  "Find best agent matching a capability",
  {
    workspace_id: z.string(),
    capability: z.string(),
    prefer_idle: z.boolean().optional().default(false),
  },
  async ({ workspace_id, capability, prefer_idle }) =>
    text(
      await findAgentByCapability(sql, workspace_id, capability, {
        preferIdle: prefer_idle,
      }),
    ),
);

server.tool(
  "agents_send_message",
  "Send a message between agents",
  {
    workspace_id: z.string(),
    from_agent_id: z.string().optional(),
    to_agent_id: z.string(),
    type: z.string(),
    payload: z.record(z.any()),
  },
  async ({ workspace_id, from_agent_id, to_agent_id, type, payload }) =>
    text(
      await sendMessage(sql, {
        workspaceId: workspace_id,
        fromAgentId: from_agent_id,
        toAgentId: to_agent_id,
        type,
        payload,
      }),
    ),
);

server.tool(
  "agents_receive_messages",
  "Receive messages for an agent",
  {
    agent_id: z.string(),
    unread_only: z.boolean().optional().default(false),
    since: z.string().optional(),
    limit: z.number().optional(),
  },
  async ({ agent_id, unread_only, since, limit }) =>
    text(
      await receiveMessages(sql, agent_id, {
        unreadOnly: unread_only,
        since,
        limit,
      }),
    ),
);

server.tool(
  "agents_create_task",
  "Create a new task",
  {
    workspace_id: z.string(),
    type: z.string(),
    payload: z.record(z.any()).optional().default({}),
    required_capability: z.string().optional(),
    priority: z.number().optional(),
  },
  async ({ workspace_id, type, payload, required_capability, priority }) =>
    text(
      await createTask(sql, {
        workspaceId: workspace_id,
        type,
        payload,
        requiredCapability: required_capability,
        priority,
      }),
    ),
);

server.tool(
  "agents_claim_task",
  "Claim next available task for an agent",
  { agent_id: z.string() },
  async ({ agent_id }) => text(await claimTask(sql, agent_id)),
);

server.tool(
  "agents_list_tasks",
  "List tasks",
  {
    workspace_id: z.string().optional(),
    agent_id: z.string().optional(),
    status: z.string().optional(),
  },
  async ({ workspace_id, agent_id, status }) =>
    text(
      await listTasks(sql, {
        workspaceId: workspace_id,
        agentId: agent_id,
        status,
      }),
    ),
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
