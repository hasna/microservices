#!/usr/bin/env bun
/**
 * MCP server for microservice-llm.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { chat } from "../lib/gateway.js";
import { getAvailableModels } from "../lib/providers.js";
import { getWorkspaceUsage } from "../lib/usage.js";

const server = new McpServer({
  name: "microservice-llm",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

server.tool(
  "llm_chat",
  "Send messages to an LLM provider and get a response",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    messages: z.array(z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })).describe("Conversation messages"),
    model: z.string().optional().describe("Model to use (optional, defaults to first available)"),
  },
  async ({ workspace_id, messages, model }) => {
    const result = await chat(sql, {
      workspaceId: workspace_id,
      messages: messages as any,
      model,
    });
    return text(result);
  },
);

server.tool(
  "llm_list_models",
  "List available LLM models based on configured API keys",
  {},
  async () => {
    const models = getAvailableModels();
    return text({ models, count: models.length });
  },
);

server.tool(
  "llm_get_usage",
  "Get LLM usage statistics for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    since: z.string().optional().describe("ISO date string to filter from (optional)"),
  },
  async ({ workspace_id, since }) => {
    const sinceDate = since ? new Date(since) : undefined;
    const usage = await getWorkspaceUsage(sql, workspace_id, sinceDate);
    return text(usage);
  },
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
