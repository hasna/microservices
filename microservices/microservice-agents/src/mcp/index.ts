#!/usr/bin/env bun
/**
 * MCP server for microservice-agents.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { getAgentHealth, markStaleAgents } from "../lib/health.js";
import { markDelivered, markRead, receiveMessages, sendMessage } from "../lib/messaging.js";
import {
  deregisterAgent,
  getAgent,
  getAgentByName,
  heartbeat,
  listAgents,
  registerAgent,
  updateAgent,
} from "../lib/registry.js";
import { findAgentByCapability, routeTask } from "../lib/routing.js";
import { claimTask, completeTask, createTask, failTask, getTask, listTasks } from "../lib/tasks.js";
import {
  registerTool, deregisterTool, getTool, getToolByName,
  listToolsForAgent, listToolsByTag, searchTools,
  discoverToolsForCapability, activateTool, deactivateTool,
} from "../lib/tools.js";

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

// ─── Tool Registry ───────────────────────────────────────────────────────────

server.tool(
  "agents_register_tool",
  "Register a tool on an agent (agent exposes it for discovery)",
  {
    agent_id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    schema: z.record(z.any()).optional(),
    config: z.record(z.any()).optional(),
    tags: z.array(z.string()).optional(),
  },
  async ({ agent_id, name, description, schema, config, tags }) =>
    text(
      await registerTool(sql, {
        agentId: agent_id,
        name,
        description,
        schema,
        config,
        tags,
      }),
    ),
);

server.tool(
  "agents_deregister_tool",
  "Deregister a tool by ID",
  { id: z.string() },
  async ({ id }) => text({ deleted: await deregisterTool(sql, id) }),
);

server.tool(
  "agents_get_tool",
  "Get a tool by ID",
  { id: z.string() },
  async ({ id }) => text(await getTool(sql, id)),
);

server.tool(
  "agents_list_tools",
  "List tools for an agent",
  {
    agent_id: z.string(),
    active_only: z.boolean().optional().default(true),
    tag: z.string().optional(),
  },
  async ({ agent_id, active_only, tag }) =>
    text(
      await listToolsForAgent(sql, agent_id, {
        activeOnly: active_only,
        tag,
      }),
    ),
);

server.tool(
  "agents_search_tools",
  "Search tools across a workspace by name/description",
  {
    workspace_id: z.string(),
    query: z.string(),
  },
  async ({ workspace_id, query }) =>
    text(await searchTools(sql, workspace_id, query)),
);

server.tool(
  "agents_discover_tools_for_capability",
  "Discover all active tools on agents that have a given capability",
  {
    workspace_id: z.string(),
    capability: z.string(),
  },
  async ({ workspace_id, capability }) =>
    text(await discoverToolsForCapability(sql, workspace_id, capability)),
);

server.tool(
  "agents_update_tool",
  "Update a tool (name, description, schema, tags, active state)",
  {
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    schema: z.record(z.any()).optional(),
    config: z.record(z.any()).optional(),
    tags: z.array(z.string()).optional(),
    is_active: z.boolean().optional(),
  },
  async ({ id, ...data }) =>
    text(await updateTool(sql, id, data)),
);

server.tool(
  "agents_list_tools_by_tag",
  "List all active tools in a workspace with a specific tag",
  {
    workspace_id: z.string(),
    tag: z.string(),
  },
  async ({ workspace_id, tag }) =>
    text(await listToolsByTag(sql, workspace_id, tag)),
);

// ─── Additional Agent Operations ──────────────────────────────────────────────

server.tool(
  "agents_update",
  "Update agent metadata (description, model, version, capabilities, config)",
  {
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    model: z.string().optional(),
    version: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    config: z.record(z.any()).optional(),
    max_concurrent: z.number().optional(),
  },
  async ({ id, ...data }) =>
    text(await updateAgent(sql, id, data)),
);

server.tool(
  "agents_get_by_name",
  "Get agent by name within a workspace",
  {
    workspace_id: z.string(),
    name: z.string(),
  },
  async ({ workspace_id, name }) =>
    text(await getAgentByName(sql, workspace_id, name)),
);

server.tool(
  "agents_mark_stale",
  "Mark stale (non-heartbeating) agents for cleanup",
  { workspace_id: z.string() },
  async ({ workspace_id }) =>
    text(await markStaleAgents(sql, workspace_id)),
);

server.tool(
  "agents_route_task",
  "Find best agent for a task and assign it (routes to the winning agent)",
  {
    workspace_id: z.string(),
    task_id: z.string(),
    capability: z.string(),
  },
  async ({ workspace_id, task_id, capability }) =>
    text(await routeTask(sql, workspace_id, task_id, capability)),
);

// ─── Task Management ───────────────────────────────────────────────────────────

server.tool(
  "agents_complete_task",
  "Mark a task as completed with output",
  {
    task_id: z.string(),
    output: z.record(z.any()).optional().default({}),
  },
  async ({ task_id, output }) =>
    text(await completeTask(sql, task_id, output)),
);

server.tool(
  "agents_fail_task",
  "Mark a task as failed with an error",
  {
    task_id: z.string(),
    error: z.string(),
  },
  async ({ task_id, error }) =>
    text(await failTask(sql, task_id, error)),
);

server.tool(
  "agents_get_task",
  "Get a task by ID",
  { task_id: z.string() },
  async ({ task_id }) =>
    text(await getTask(sql, task_id)),
);

// ─── Messaging ─────────────────────────────────────────────────────────────────

server.tool(
  "agents_mark_read",
  "Mark messages as read",
  {
    agent_id: z.string(),
    message_ids: z.array(z.string()),
  },
  async ({ agent_id, message_ids }) =>
    text(await markRead(sql, agent_id, message_ids)),
);

server.tool(
  "agents_mark_delivered",
  "Mark messages as delivered",
  {
    agent_id: z.string(),
    message_ids: z.array(z.string()),
  },
  async ({ agent_id, message_ids }) =>
    text(await markDelivered(sql, agent_id, message_ids)),
);

// ─── Tool Activation ──────────────────────────────────────────────────────────

server.tool(
  "agents_activate_tool",
  "Activate a tool so it can be discovered and used",
  { id: z.string() },
  async ({ id }) =>
    text(await activateTool(sql, id)),
);

server.tool(
  "agents_deactivate_tool",
  "Deactivate a tool so it is hidden from discovery",
  { id: z.string() },
  async ({ id }) =>
    text(await deactivateTool(sql, id)),
);

server.tool(
  "agents_get_tool_by_name",
  "Get a tool by name for a specific agent",
  {
    agent_id: z.string(),
    name: z.string(),
  },
  async ({ agent_id, name }) =>
    text(await getToolByName(sql, agent_id, name)),
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
