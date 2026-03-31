#!/usr/bin/env bun
/**
 * MCP server for microservice-llm.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { chat } from "../lib/gateway.js";
import { getWorkspaceUsage } from "../lib/usage.js";
import { getAvailableModels } from "../lib/providers.js";

const server = new Server(
  { name: "microservice-llm", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "llm_chat",
      description: "Send messages to an LLM provider and get a response",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace UUID for usage tracking" },
          messages: {
            type: "array",
            description: "Conversation messages",
            items: {
              type: "object",
              properties: {
                role: { type: "string", enum: ["system", "user", "assistant"] },
                content: { type: "string" },
              },
              required: ["role", "content"],
            },
          },
          model: { type: "string", description: "Model to use (optional, defaults to first available)" },
        },
        required: ["workspace_id", "messages"],
      },
    },
    {
      name: "llm_list_models",
      description: "List available LLM models based on configured API keys",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "llm_get_usage",
      description: "Get LLM usage statistics for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace UUID" },
          since: { type: "string", description: "ISO date string to filter from (optional)" },
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

  if (name === "llm_chat") {
    const messages = a.messages as Array<{ role: "system" | "user" | "assistant"; content: string }>;
    const result = await chat(sql, {
      workspaceId: String(a.workspace_id),
      messages,
      model: a.model ? String(a.model) : undefined,
    });
    return text(result);
  }

  if (name === "llm_list_models") {
    const models = getAvailableModels();
    return text({ models, count: models.length });
  }

  if (name === "llm_get_usage") {
    const since = a.since ? new Date(String(a.since)) : undefined;
    const usage = await getWorkspaceUsage(sql, String(a.workspace_id), since);
    return text(usage);
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
