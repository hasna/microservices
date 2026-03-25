#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTranscribeTools } from "./tools/transcribe.js";
import { registerMediaTools } from "./tools/media.js";
import { registerCrudTools } from "./tools/crud.js";
import { registerAiTools } from "./tools/ai.js";
import { registerCommentsTools } from "./tools/comments.js";
import { registerAnnotationsTools } from "./tools/annotations.js";
import { registerProofreadTools } from "./tools/proofread.js";
import { registerMetaTools } from "./tools/meta.js";

const server = new McpServer({
  name: "microservice-transcriber",
  version: "0.0.1",
});

registerTranscribeTools(server);
registerMediaTools(server);
registerCrudTools(server);
registerAiTools(server);
registerCommentsTools(server);
registerAnnotationsTools(server);
registerProofreadTools(server);
registerMetaTools(server);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Transcriber MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
