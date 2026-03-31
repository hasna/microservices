#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { registerAgent, deregisterAgent, getAgent, listAgents, heartbeat } from "../lib/registry.js";
import { getAgentHealth } from "../lib/health.js";
import { findAgentByCapability } from "../lib/routing.js";
import { sendMessage, receiveMessages } from "../lib/messaging.js";
import { createTask, claimTask, listTasks } from "../lib/tasks.js";

const server = new Server({ name: "microservice-agents", version: "0.0.1" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: "agents_register", description: "Register a new agent", inputSchema: { type: "object", properties: { workspace_id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, model: { type: "string" }, version: { type: "string" }, capabilities: { type: "array", items: { type: "string" } }, config: { type: "object" }, max_concurrent: { type: "number" } }, required: ["workspace_id", "name"] } },
  { name: "agents_deregister", description: "Deregister an agent", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "agents_list", description: "List agents in a workspace", inputSchema: { type: "object", properties: { workspace_id: { type: "string" }, status: { type: "string" }, capability: { type: "string" } }, required: ["workspace_id"] } },
  { name: "agents_get", description: "Get agent by ID", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "agents_heartbeat", description: "Send agent heartbeat", inputSchema: { type: "object", properties: { agent_id: { type: "string" } }, required: ["agent_id"] } },
  { name: "agents_get_health", description: "Get agent health report for workspace", inputSchema: { type: "object", properties: { workspace_id: { type: "string" } }, required: ["workspace_id"] } },
  { name: "agents_find_by_capability", description: "Find best agent matching a capability", inputSchema: { type: "object", properties: { workspace_id: { type: "string" }, capability: { type: "string" }, prefer_idle: { type: "boolean" } }, required: ["workspace_id", "capability"] } },
  { name: "agents_send_message", description: "Send a message between agents", inputSchema: { type: "object", properties: { workspace_id: { type: "string" }, from_agent_id: { type: "string" }, to_agent_id: { type: "string" }, type: { type: "string" }, payload: { type: "object" } }, required: ["workspace_id", "to_agent_id", "type", "payload"] } },
  { name: "agents_receive_messages", description: "Receive messages for an agent", inputSchema: { type: "object", properties: { agent_id: { type: "string" }, unread_only: { type: "boolean" }, since: { type: "string" }, limit: { type: "number" } }, required: ["agent_id"] } },
  { name: "agents_create_task", description: "Create a new task", inputSchema: { type: "object", properties: { workspace_id: { type: "string" }, type: { type: "string" }, payload: { type: "object" }, required_capability: { type: "string" }, priority: { type: "number" } }, required: ["workspace_id", "type"] } },
  { name: "agents_claim_task", description: "Claim next available task for an agent", inputSchema: { type: "object", properties: { agent_id: { type: "string" } }, required: ["agent_id"] } },
  { name: "agents_list_tasks", description: "List tasks", inputSchema: { type: "object", properties: { workspace_id: { type: "string" }, agent_id: { type: "string" }, status: { type: "string" } } } },
]}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb(); const { name, arguments: args } = req.params; const a = args as Record<string, unknown>;
  const t = (d: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(d, null, 2) }] });

  if (name === "agents_register") return t(await registerAgent(sql, {
    workspaceId: String(a.workspace_id), name: String(a.name),
    description: a.description ? String(a.description) : undefined,
    model: a.model ? String(a.model) : undefined,
    version: a.version ? String(a.version) : undefined,
    capabilities: Array.isArray(a.capabilities) ? a.capabilities as string[] : undefined,
    config: a.config as Record<string, unknown> | undefined,
    maxConcurrent: a.max_concurrent ? Number(a.max_concurrent) : undefined,
  }));
  if (name === "agents_deregister") return t({ deleted: await deregisterAgent(sql, String(a.id)) });
  if (name === "agents_list") return t(await listAgents(sql, String(a.workspace_id), {
    status: a.status ? String(a.status) : undefined,
    capability: a.capability ? String(a.capability) : undefined,
  }));
  if (name === "agents_get") return t(await getAgent(sql, String(a.id)));
  if (name === "agents_heartbeat") return t(await heartbeat(sql, String(a.agent_id)));
  if (name === "agents_get_health") return t(await getAgentHealth(sql, String(a.workspace_id)));
  if (name === "agents_find_by_capability") return t(await findAgentByCapability(sql, String(a.workspace_id), String(a.capability), { preferIdle: a.prefer_idle === true }));
  if (name === "agents_send_message") return t(await sendMessage(sql, {
    workspaceId: String(a.workspace_id),
    fromAgentId: a.from_agent_id ? String(a.from_agent_id) : undefined,
    toAgentId: String(a.to_agent_id), type: String(a.type),
    payload: (a.payload as Record<string, unknown>) ?? {},
  }));
  if (name === "agents_receive_messages") return t(await receiveMessages(sql, String(a.agent_id), {
    unreadOnly: a.unread_only === true,
    since: a.since ? String(a.since) : undefined,
    limit: a.limit ? Number(a.limit) : undefined,
  }));
  if (name === "agents_create_task") return t(await createTask(sql, {
    workspaceId: String(a.workspace_id), type: String(a.type),
    payload: (a.payload as Record<string, unknown>) ?? {},
    requiredCapability: a.required_capability ? String(a.required_capability) : undefined,
    priority: a.priority ? Number(a.priority) : undefined,
  }));
  if (name === "agents_claim_task") return t(await claimTask(sql, String(a.agent_id)));
  if (name === "agents_list_tasks") return t(await listTasks(sql, {
    workspaceId: a.workspace_id ? String(a.workspace_id) : undefined,
    agentId: a.agent_id ? String(a.agent_id) : undefined,
    status: a.status ? String(a.status) : undefined,
  }));
  throw new Error(`Unknown tool: ${name}`);
});

async function main() { const sql = getDb(); await migrate(sql); await server.connect(new StdioServerTransport()); }
main().catch(console.error);
