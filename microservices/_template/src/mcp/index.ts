/**
 * MCP server for microservice-__name__.
 *
 * Exposes __Name__ functionality as MCP tools for AI agents.
 * Run via: microservice-__name__ mcp  (or configure in claude_desktop_config.json)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";

const server = new McpServer({
  name: "microservice-__name__",
  version: "0.0.1",
});

// Example Tool:
// server.tool(
//   "__name___example",
//   "Description of what this tool does",
//   {
//     param_one: z.string().describe("What is this parameter?"),
//     param_two: z.number().optional().describe("An optional number"),
//   },
//   async ({ param_one, param_two }) => {
//     const sql = getDb();
//     const result = await sql`SELECT 1 as "ok"`;
//     return {
//       content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
//     };
//   }
// );

// Start MCP server
async function main(): Promise<void> {
  const sql = getDb();
  await migrate(sql);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
