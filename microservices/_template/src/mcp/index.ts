/**
 * MCP server for microservice-NAME.
 *
 * Exposes NAME functionality as MCP tools for AI agents.
 * Run via: microservice-NAME mcp  (or configure in claude_desktop_config.json)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";

const server = new Server(
  { name: "microservice-NAME", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ADD YOUR TOOLS HERE
    // {
    //   name: "name_list_records",
    //   description: "List all records",
    //   inputSchema: { type: "object", properties: {}, required: [] },
    // },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb();
  const { name, arguments: args } = req.params;

  // ADD TOOL HANDLERS HERE
  // if (name === "name_list_records") { ... }

  throw new Error(`Unknown tool: ${name}`);
});

// Start MCP server
async function main(): Promise<void> {
  const sql = getDb();
  await migrate(sql);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
