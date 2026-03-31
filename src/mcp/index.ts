#!/usr/bin/env node
/**
 * @hasna/microservices hub MCP server.
 * Provides tools to manage all @hasna/microservice-* packages.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  MICROSERVICES,
  getMicroservice,
  searchMicroservices,
  getMicroservicesByCategory,
  type Category,
} from "../lib/registry.js";
import {
  installMicroservice,
  getInstalledMicroservices,
  removeMicroservice,
  getMicroserviceStatus,
  microserviceExists,
} from "../lib/installer.js";
import { runMicroserviceCommand } from "../lib/runner.js";
import { getPackageVersion } from "../lib/package-info.js";

const server = new McpServer({
  name: "microservices",
  version: getPackageVersion(),
});

// List all microservices
server.registerTool(
  "list_microservices",
  {
    title: "List Microservices",
    description: "List all available production microservices (auth, teams, billing, notify, files, audit, flags, jobs).",
    inputSchema: { installed_only: z.boolean().optional() },
  },
  async ({ installed_only }) => {
    const services = installed_only
      ? MICROSERVICES.filter((m) => microserviceExists(m.name))
      : MICROSERVICES;
    return {
      content: [{
        type: "text",
        text: JSON.stringify(services.map((m) => ({
          name: m.name,
          package: m.package,
          binary: m.binary,
          category: m.category,
          description: m.description,
          schemaPrefix: m.schemaPrefix,
          installed: microserviceExists(m.name),
          requiredEnv: m.requiredEnv,
        })), null, 2),
      }],
    };
  }
);

// Search microservices
server.registerTool(
  "search_microservices",
  {
    title: "Search Microservices",
    description: "Search microservices by name, description, or tags.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const results = searchMicroservices(query);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(results.map((m) => ({
          name: m.name,
          package: m.package,
          description: m.description,
          category: m.category,
          tags: m.tags,
        })), null, 2),
      }],
    };
  }
);

// Install a microservice
server.registerTool(
  "install_microservice",
  {
    title: "Install Microservice",
    description: "Install a microservice globally via bun install -g.",
    inputSchema: { name: z.string(), force: z.boolean().optional() },
  },
  async ({ name, force }) => {
    const result = installMicroservice(name, { force });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// Get microservice status
server.registerTool(
  "microservice_status",
  {
    title: "Microservice Status",
    description: "Check if a microservice is installed and get its version.",
    inputSchema: { name: z.string().optional() },
  },
  async ({ name }) => {
    if (name) {
      return {
        content: [{ type: "text", text: JSON.stringify(getMicroserviceStatus(name), null, 2) }],
      };
    }
    const statuses = MICROSERVICES.map((m) => getMicroserviceStatus(m.name));
    return {
      content: [{ type: "text", text: JSON.stringify(statuses, null, 2) }],
    };
  }
);

// Run a microservice command
server.registerTool(
  "run_microservice_command",
  {
    title: "Run Microservice Command",
    description: "Run a CLI command on an installed microservice. Example: run migrate, serve, status.",
    inputSchema: {
      name: z.string().describe("Microservice name (e.g. 'auth', 'billing')"),
      args: z.array(z.string()).describe("CLI arguments (e.g. ['migrate'] or ['status'])"),
    },
  },
  async ({ name, args }) => {
    const result = await runMicroserviceCommand(name, args);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: result.success,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        }, null, 2),
      }],
    };
  }
);

// Remove a microservice
server.registerTool(
  "remove_microservice",
  {
    title: "Remove Microservice",
    description: "Uninstall a microservice global package.",
    inputSchema: { name: z.string() },
  },
  async ({ name }) => {
    const ok = removeMicroservice(name);
    return {
      content: [{ type: "text", text: JSON.stringify({ removed: ok, name }, null, 2) }],
    };
  }
);

// Get info about a specific microservice
server.registerTool(
  "get_microservice_info",
  {
    title: "Get Microservice Info",
    description: "Get detailed info about a microservice including schema, required env vars, and tags.",
    inputSchema: { name: z.string() },
  },
  async ({ name }) => {
    const m = getMicroservice(name);
    if (!m) return { content: [{ type: "text", text: `Unknown microservice: ${name}` }] };
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ ...m, installed: microserviceExists(name) }, null, 2),
      }],
    };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
