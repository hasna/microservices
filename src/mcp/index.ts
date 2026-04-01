#!/usr/bin/env node
/**
 * @hasna/microservices hub MCP server.
 * Provides tools to manage all @hasna/microservice-* packages.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getMicroserviceStatus,
  installMicroservice,
  microserviceExists,
  removeMicroservice,
} from "../lib/installer.js";
import { getPackageVersion } from "../lib/package-info.js";
import {
  getMicroservice,
  MICROSERVICES,
  searchMicroservices,
} from "../lib/registry.js";
import { runMicroserviceCommand } from "../lib/runner.js";

const server = new McpServer({
  name: "microservices",
  version: getPackageVersion(),
});

// List all microservices
server.registerTool(
  "list_microservices",
  {
    title: "List Microservices",
    description:
      "List all 21 available production microservices (auth, teams, billing, llm, agents, memory, etc).",
    inputSchema: { installed_only: z.boolean().optional() },
  },
  async ({ installed_only }) => {
    const services = installed_only
      ? MICROSERVICES.filter((m) => microserviceExists(m.name))
      : MICROSERVICES;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            services.map((m) => ({
              name: m.name,
              package: m.package,
              binary: m.binary,
              category: m.category,
              description: m.description,
              schemaPrefix: m.schemaPrefix,
              installed: microserviceExists(m.name),
              requiredEnv: m.requiredEnv,
            })),
            null,
            2,
          ),
        },
      ],
    };
  },
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
      content: [
        {
          type: "text",
          text: JSON.stringify(
            results.map((m) => ({
              name: m.name,
              package: m.package,
              description: m.description,
              category: m.category,
              tags: m.tags,
            })),
            null,
            2,
          ),
        },
      ],
    };
  },
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
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
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
        content: [
          {
            type: "text",
            text: JSON.stringify(getMicroserviceStatus(name), null, 2),
          },
        ],
      };
    }
    const statuses = MICROSERVICES.map((m) => getMicroserviceStatus(m.name));
    return {
      content: [{ type: "text", text: JSON.stringify(statuses, null, 2) }],
    };
  },
);

// Run a microservice command
server.registerTool(
  "run_microservice_command",
  {
    title: "Run Microservice Command",
    description:
      "Run a CLI command on an installed microservice. Example: run migrate, serve, status.",
    inputSchema: {
      name: z.string().describe("Microservice name (e.g. 'auth', 'billing')"),
      args: z
        .array(z.string())
        .describe("CLI arguments (e.g. ['migrate'] or ['status'])"),
    },
  },
  async ({ name, args }) => {
    const result = await runMicroserviceCommand(name, args);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: result.success,
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// Check environment variables
server.registerTool(
  "check_env",
  {
    title: "Check Environment Variables",
    description:
      "Verify if all required and optional environment variables are set for installed microservices.",
    inputSchema: {},
  },
  async () => {
    const installed = MICROSERVICES.filter((m) => microserviceExists(m.name));
    if (installed.length === 0) {
      return {
        content: [
          { type: "text", text: "No microservices installed to check." },
        ],
      };
    }

    const report = installed.map((m) => {
      const missingRequired = m.requiredEnv.filter((env) => !process.env[env]);
      const missingOptional = (m.optionalEnv ?? []).filter(
        (env) => !process.env[env],
      );
      return {
        name: m.name,
        ok: missingRequired.length === 0,
        missing_required: missingRequired,
        missing_optional: missingOptional,
      };
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              summary: {
                installed: installed.length,
                total_missing_required: report.reduce(
                  (acc, r) => acc + r.missing_required.length,
                  0,
                ),
                all_ok: report.every((r) => r.ok),
              },
              services: report,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// Scaffold a microservice
server.registerTool(
  "scaffold_microservice",
  {
    title: "Scaffold Microservice",
    description: "Scaffold a new microservice from the _template directory.",
    inputSchema: {
      name: z
        .string()
        .describe("The name of the new microservice (lowercase, dashes only)"),
    },
  },
  async ({ name }) => {
    // Basic format check
    if (!/^[a-z0-9-]+$/.test(name)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: false,
                error:
                  "Name can only contain lowercase letters, numbers, and dashes.",
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    try {
      const fs = await import("node:fs");
      const path = await import("node:path");

      const cwd = process.cwd();
      const templateDir = path.join(cwd, "microservices", "_template");
      const targetDir = path.join(cwd, "microservices", `microservice-${name}`);

      if (!fs.existsSync(templateDir)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: `Template directory not found at ${templateDir}.`,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      if (fs.existsSync(targetDir)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: `Target directory already exists at ${targetDir}`,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Recursive copy
      fs.cpSync(templateDir, targetDir, { recursive: true });

      // String replace unambiguous placeholders in all files
      const replaceInFile = (filePath: string) => {
        const content = fs.readFileSync(filePath, "utf-8");
        let updated = content.replace(
          /__NAME__/g,
          name.toUpperCase().replace(/-/g, "_"),
        );
        updated = updated.replace(
          /__Name__/g,
          name.charAt(0).toUpperCase() + name.slice(1),
        );
        updated = updated.replace(/__name__/g, name);
        fs.writeFileSync(filePath, updated, "utf-8");
      };

      const walkAndReplace = (dir: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const filePath = path.join(dir, file);
          if (fs.statSync(filePath).isDirectory()) {
            walkAndReplace(filePath);
          } else {
            replaceInFile(filePath);
          }
        }
      };

      walkAndReplace(targetDir);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                message: `Created microservices/microservice-${name}`,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { success: false, error: String(err) },
              null,
              2,
            ),
          },
        ],
      };
    }
  },
);

// Init all installed microservices
server.registerTool(
  "init_all_microservices",
  {
    title: "Init All Microservices",
    description:
      "Run migrations and confirm setup for all installed microservices.",
    inputSchema: { db: z.string().describe("PostgreSQL connection URL") },
  },
  async ({ db }) => {
    process.env.DATABASE_URL = db;
    const installed = MICROSERVICES.filter((m) => microserviceExists(m.name));
    if (installed.length === 0) {
      return {
        content: [
          { type: "text", text: "No microservices installed to init." },
        ],
      };
    }

    const results = [];
    let hasErrors = false;

    for (const m of installed) {
      const res = await runMicroserviceCommand(m.name, ["init", "--db", db]);
      results.push({
        name: m.name,
        success: res.success,
        output: res.stdout || res.stderr,
      });
      if (!res.success) hasErrors = true;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { success: !hasErrors, initialized: installed.length, results },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// Migrate all installed microservices
server.registerTool(
  "migrate_all_microservices",
  {
    title: "Migrate All Microservices",
    description: "Run database migrations for all installed microservices.",
    inputSchema: {
      db: z
        .string()
        .optional()
        .describe("PostgreSQL connection URL (overrides DATABASE_URL)"),
    },
  },
  async ({ db }) => {
    if (db) process.env.DATABASE_URL = db;
    const installed = MICROSERVICES.filter((m) => microserviceExists(m.name));
    if (installed.length === 0) {
      return {
        content: [
          { type: "text", text: "No microservices installed to migrate." },
        ],
      };
    }

    const results = [];
    let hasErrors = false;

    for (const m of installed) {
      const res = await runMicroserviceCommand(m.name, ["migrate"]);
      results.push({
        name: m.name,
        success: res.success,
        output: res.stdout || res.stderr,
      });
      if (!res.success) hasErrors = true;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { success: !hasErrors, migrated: installed.length, results },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// Serve all installed microservices
server.registerTool(
  "serve_all_microservices",
  {
    title: "Serve All Microservices",
    description:
      "Start HTTP servers for all installed microservices. NOTE: This will run them in the background. It is highly recommended to run this directly in your terminal if you need to view live logs.",
    inputSchema: {
      db: z
        .string()
        .optional()
        .describe("PostgreSQL connection URL (overrides DATABASE_URL)"),
    },
  },
  async ({ db }) => {
    if (db) process.env.DATABASE_URL = db;
    const installed = MICROSERVICES.filter((m) => microserviceExists(m.name));
    if (installed.length === 0) {
      return {
        content: [
          { type: "text", text: "No microservices installed to serve." },
        ],
      };
    }

    try {
      const { spawn } = await import("node:child_process");

      const servicesStarted = [];
      for (let i = 0; i < installed.length; i++) {
        const m = installed[i];

        // Spawn detached process so it keeps running
        const proc = spawn(m.binary, ["serve"], {
          env: process.env,
          stdio: "ignore",
          detached: true,
        });

        proc.unref(); // allow the MCP server to exit independently
        servicesStarted.push(m.name);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                started: servicesStarted.length,
                services: servicesStarted,
                note: "Processes have been detached and are running in the background.",
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { success: false, error: String(err) },
              null,
              2,
            ),
          },
        ],
      };
    }
  },
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
      content: [
        { type: "text", text: JSON.stringify({ removed: ok, name }, null, 2) },
      ],
    };
  },
);

// Get info about a specific microservice
server.registerTool(
  "get_microservice_info",
  {
    title: "Get Microservice Info",
    description:
      "Get detailed info about a microservice including schema, required env vars, and tags.",
    inputSchema: { name: z.string() },
  },
  async ({ name }) => {
    const m = getMicroservice(name);
    if (!m)
      return {
        content: [{ type: "text", text: `Unknown microservice: ${name}` }],
      };
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { ...m, installed: microserviceExists(name) },
            null,
            2,
          ),
        },
      ],
    };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
