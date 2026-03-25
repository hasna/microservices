#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCloudTools } from "@hasna/cloud";
import { z } from "zod";
import {
  MICROSERVICES,
  CATEGORIES,
  getMicroservice,
  getMicroservicesByCategory,
  searchMicroservices,
} from "../lib/registry.js";
import {
  installMicroservice,
  getInstalledMicroservices,
  removeMicroservice,
  getMicroserviceStatus,
} from "../lib/installer.js";
import {
  runMicroserviceCommand,
  getMicroserviceOperations,
  getMicroserviceCliPath,
} from "../lib/runner.js";
import { getPackageVersion } from "../lib/package-info.js";
import { getHubAdapter } from "../lib/database.js";

const server = new McpServer({
  name: "microservices",
  version: getPackageVersion(),
});

// --- Tool: search_microservices ---
server.registerTool(
  "search_microservices",
  {
    title: "Search Microservices",
    description: "Search microservices by name or keyword.",
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
              displayName: m.displayName,
              category: m.category,
              description: m.description,
            })),
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Tool: list_microservices ---
server.registerTool(
  "list_microservices",
  {
    title: "List Microservices",
    description: "List microservices. Optional category filter.",
    inputSchema: {
      category: z.string().optional(),
      installed_only: z.boolean().optional(),
    },
  },
  async ({ category, installed_only }) => {
    let services = MICROSERVICES;

    if (category) {
      const matched = CATEGORIES.find(
        (c) => c.toLowerCase() === category.toLowerCase()
      );
      if (!matched) {
        return {
          content: [
            {
              type: "text",
              text: `Unknown category: "${category}". Available: ${CATEGORIES.join(", ")}`,
            },
          ],
          isError: true,
        };
      }
      services = getMicroservicesByCategory(matched);
    }

    if (installed_only) {
      const installed = getInstalledMicroservices();
      services = services.filter((m) => installed.includes(m.name));
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            services.map((m) => ({
              name: m.name,
              displayName: m.displayName,
              category: m.category,
              description: m.description,
            })),
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Tool: list_categories ---
server.registerTool(
  "list_categories",
  {
    title: "List Categories",
    description: "List microservice categories with counts.",
    inputSchema: {},
  },
  async () => {
    const categoryCounts = CATEGORIES.map((category) => ({
      category,
      count: getMicroservicesByCategory(category).length,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { categories: categoryCounts, total: MICROSERVICES.length },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Tool: microservice_info ---
server.registerTool(
  "microservice_info",
  {
    title: "Microservice Info",
    description: "Get metadata, install status, and database info for a microservice.",
    inputSchema: { name: z.string() },
  },
  async ({ name }) => {
    const meta = getMicroservice(name);
    if (!meta) {
      return {
        content: [{ type: "text", text: `Microservice '${name}' not found.` }],
        isError: true,
      };
    }

    const status = getMicroserviceStatus(name);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ...meta, ...status }, null, 2),
        },
      ],
    };
  }
);

// --- Tool: install_microservice ---
server.registerTool(
  "install_microservice",
  {
    title: "Install Microservice",
    description: "Install microservices into .microservices/.",
    inputSchema: {
      names: z.array(z.string()),
      overwrite: z.boolean().optional(),
    },
  },
  async ({ names, overwrite }) => {
    const results = names.map((name) =>
      installMicroservice(name, { overwrite: overwrite ?? false })
    );

    const summary = results.map((r) =>
      r.success
        ? `+ ${r.microservice} -> ${r.path}`
        : `x ${r.microservice}: ${r.error}`
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { results, summary: summary.join("\n") },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Tool: remove_microservice ---
server.registerTool(
  "remove_microservice",
  {
    title: "Remove Microservice",
    description: "Remove an installed microservice. Data is preserved by default.",
    inputSchema: {
      name: z.string(),
      delete_data: z.boolean().optional(),
    },
  },
  async ({ name, delete_data }) => {
    const removed = removeMicroservice(name, { deleteData: delete_data });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            name,
            removed,
            data_preserved: !delete_data,
          }),
        },
      ],
    };
  }
);

// --- Tool: list_installed ---
server.registerTool(
  "list_installed",
  {
    title: "List Installed Microservices",
    description: "List installed microservices with their status.",
    inputSchema: {},
  },
  async () => {
    const installed = getInstalledMicroservices();
    const statuses = installed.map((name) => getMicroserviceStatus(name));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ installed: statuses, count: installed.length }, null, 2),
        },
      ],
    };
  }
);

// --- Tool: run_microservice ---
server.registerTool(
  "run_microservice",
  {
    title: "Run Microservice Command",
    description:
      "Execute a command on an installed microservice. Use list_microservice_operations first to discover available commands.",
    inputSchema: {
      name: z.string().describe("Microservice name (e.g. contacts, invoices)"),
      args: z
        .array(z.string())
        .describe("CLI arguments (e.g. ['list', '--format', 'json'])"),
      timeout: z.number().optional().describe("Timeout in ms (default: 30000)"),
    },
  },
  async ({ name, args, timeout }) => {
    const meta = getMicroservice(name);
    if (!meta) {
      return {
        content: [{ type: "text", text: `Microservice '${name}' not found.` }],
        isError: true,
      };
    }

    const result = await runMicroserviceCommand(name, args, timeout ?? 30000);

    if (!result.success) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                microservice: name,
                success: false,
                error: result.stderr || result.stdout,
                exitCode: result.exitCode,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { microservice: name, success: true, output: result.stdout },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Tool: list_microservice_operations ---
server.registerTool(
  "list_microservice_operations",
  {
    title: "List Microservice Operations",
    description: "Discover available commands for an installed microservice.",
    inputSchema: {
      name: z.string().describe("Microservice name"),
    },
  },
  async ({ name }) => {
    const meta = getMicroservice(name);
    if (!meta) {
      return {
        content: [{ type: "text", text: `Microservice '${name}' not found.` }],
        isError: true,
      };
    }

    if (!getMicroserviceCliPath(name)) {
      return {
        content: [
          {
            type: "text",
            text: `Microservice '${name}' does not have a CLI. Is it installed?`,
          },
        ],
        isError: true,
      };
    }

    const ops = await getMicroserviceOperations(name);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              microservice: name,
              displayName: meta.displayName,
              commands: ops.commands,
              helpText: ops.helpText,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Tool: search_tools ---
server.registerTool(
  "search_tools",
  {
    title: "Search Tools",
    description: "List tool names, optionally filtered by keyword.",
    inputSchema: { query: z.string().optional() },
  },
  async ({ query }) => {
    const all = [
      "search_microservices",
      "list_microservices",
      "list_categories",
      "microservice_info",
      "install_microservice",
      "remove_microservice",
      "list_installed",
      "run_microservice",
      "list_microservice_operations",
      "register_agent",
      "heartbeat",
      "set_focus",
      "list_agents",
      "search_tools",
      "describe_tools",
    ];
    const matches = query
      ? all.filter((n) => n.includes(query.toLowerCase()))
      : all;
    return { content: [{ type: "text" as const, text: matches.join(", ") }] };
  }
);

// --- Tool: describe_tools ---
server.registerTool(
  "describe_tools",
  {
    title: "Describe Tools",
    description: "Get full descriptions for specific tools.",
    inputSchema: { names: z.array(z.string()) },
  },
  async ({ names }) => {
    const descriptions: Record<string, string> = {
      search_microservices: "Search by name/keyword. Params: query",
      list_microservices: "List microservices, optionally by category. Params: category?, installed_only?",
      list_categories: "List categories with counts.",
      microservice_info: "Get metadata + install status + DB info. Params: name",
      install_microservice: "Install microservices. Params: names[], overwrite?",
      remove_microservice: "Remove installed microservice. Params: name, delete_data?",
      list_installed: "List installed microservices with status.",
      run_microservice: "Execute a command on a microservice. Params: name, args[], timeout?",
      list_microservice_operations: "Discover available commands. Params: name",
      register_agent: "Register agent session (idempotent). Params: name, session_id?",
      heartbeat: "Update last_seen_at to signal agent is active. Params: agent_id",
      set_focus: "Set active project context. Params: agent_id, project_id?",
      list_agents: "List all registered agents.",
    };
    const result = names
      .map((n: string) => `${n}: ${descriptions[n] || "See tool schema"}`)
      .join("\n");
    return { content: [{ type: "text" as const, text: result }] };
  }
);

// --- Agent Tools ---

const _agentReg = new Map<string, { id: string; name: string; last_seen_at: string; project_id?: string }>();

server.registerTool(
  "register_agent",
  {
    title: "Register Agent",
    description: "Register an agent session (idempotent). Auto-updates last_seen_at on re-register.",
    inputSchema: {
      name: z.string().describe("Agent name"),
      session_id: z.string().optional().describe("Session identifier"),
    },
  },
  async ({ name, session_id }) => {
    const existing = [..._agentReg.values()].find((x) => x.name === name);
    if (existing) {
      existing.last_seen_at = new Date().toISOString();
      return { content: [{ type: "text" as const, text: JSON.stringify(existing) }] };
    }
    const id = Math.random().toString(36).slice(2, 10);
    const ag = { id, name, last_seen_at: new Date().toISOString() };
    _agentReg.set(id, ag);
    return { content: [{ type: "text" as const, text: JSON.stringify(ag) }] };
  }
);

server.registerTool(
  "heartbeat",
  {
    title: "Heartbeat",
    description: "Update last_seen_at to signal agent is active.",
    inputSchema: { agent_id: z.string().describe("Agent ID") },
  },
  async ({ agent_id }) => {
    const ag = _agentReg.get(agent_id);
    if (!ag) return { content: [{ type: "text" as const, text: `Agent not found: ${agent_id}` }], isError: true };
    ag.last_seen_at = new Date().toISOString();
    return { content: [{ type: "text" as const, text: JSON.stringify({ id: ag.id, name: ag.name, last_seen_at: ag.last_seen_at }) }] };
  }
);

server.registerTool(
  "set_focus",
  {
    title: "Set Focus",
    description: "Set active project context for this agent session.",
    inputSchema: {
      agent_id: z.string().describe("Agent ID"),
      project_id: z.string().nullable().optional().describe("Project ID to focus on, or null to clear"),
    },
  },
  async ({ agent_id, project_id }) => {
    const ag = _agentReg.get(agent_id);
    if (!ag) return { content: [{ type: "text" as const, text: `Agent not found: ${agent_id}` }], isError: true };
    (ag as any).project_id = project_id ?? undefined;
    return { content: [{ type: "text" as const, text: project_id ? `Focus: ${project_id}` : "Focus cleared" }] };
  }
);

server.registerTool(
  "list_agents",
  {
    title: "List Agents",
    description: "List all registered agents.",
    inputSchema: {},
  },
  async () => {
    const agents = [..._agentReg.values()];
    if (agents.length === 0) return { content: [{ type: "text" as const, text: "No agents registered." }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(agents, null, 2) }] };
  }
);

// --- Tool: send_feedback ---
server.registerTool(
  "send_feedback",
  {
    title: "Send Feedback",
    description: "Send feedback about this service",
    inputSchema: {
      message: z.string().describe("Feedback message"),
      email: z.string().optional().describe("Contact email (optional)"),
      category: z.enum(["bug", "feature", "general"]).optional().describe("Feedback category"),
    },
  },
  async (params: { message: string; email?: string; category?: string }) => {
    const adapter = getHubAdapter();
    adapter.run(
      "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
      params.message, params.email || null, params.category || "general", getPackageVersion()
    );
    return { content: [{ type: "text" as const, text: "Feedback saved. Thank you!" }] };
  },
);

// --- Start the server ---
async function main() {
  const transport = new StdioServerTransport();
  registerCloudTools(server, "microservices");
  await server.connect(transport);
  console.error("Microservices MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
