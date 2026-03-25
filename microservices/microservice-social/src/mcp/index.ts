#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerPostTools } from "./tools/posts.js";
import { registerTemplateTools } from "./tools/templates.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerPublisherTools } from "./tools/publisher.js";
import { registerMentionTools } from "./tools/mentions.js";
import { registerAiTools } from "./tools/ai.js";

const server = new McpServer({
  name: "microservice-social",
  version: "0.0.1",
});

registerAccountTools(server);
registerPostTools(server);
registerTemplateTools(server);
registerAnalyticsTools(server);
registerPublisherTools(server);
registerMentionTools(server);
registerAiTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-social MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
