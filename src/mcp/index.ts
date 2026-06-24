#!/usr/bin/env bun
/**
 * @hasna/microservices hub MCP server.
 * Provides tools to manage all @hasna/microservice-* packages.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  DEFAULT_LIST_LIMIT,
  DEFAULT_OUTPUT_MAX_CHARS,
  DEFAULT_SEARCH_LIMIT,
  formatPageHint,
  formatTextTable,
  formatTruncationHint,
  paginate,
  summarizeOutput,
  truncateText,
} from "../lib/compact-output.js";
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
import {
  DEFAULT_MCP_HTTP_PORT,
  isStdioMode,
  resolveMcpHttpPort,
  startMcpHttpServer,
} from "./http.js";

function hasFlag(...flags: string[]): boolean {
  return process.argv.some((arg) => flags.includes(arg));
}

function printHelp(): void {
  process.stdout.write(
    `Usage: microservices-mcp [options]

Microservices MCP server (stdio transport by default)

Options:
  --http           Serve MCP over Streamable HTTP (127.0.0.1)
  --port <number>  HTTP port (default: ${DEFAULT_MCP_HTTP_PORT}, env: MCP_HTTP_PORT)
  -h, --help       Show help
  -V, --version    Show version
`,
  );
}

function textContent(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function jsonContent(value: unknown) {
  return textContent(JSON.stringify(value, null, 2));
}

function compactServiceRows(
  services: typeof MICROSERVICES,
  options: { verbose?: boolean },
): string {
  return formatTextTable(
    services.map((m) => ({
      name: m.name,
      category: m.category,
      binary: m.binary,
      description: m.description,
      detail: options.verbose
        ? `${m.package}; env: ${m.requiredEnv.join(", ")}; tags: ${m.tags.join(", ")}`
        : m.description,
    })),
    [
      { header: "name", width: 14, value: (row) => row.name },
      { header: "category", width: 12, value: (row) => row.category },
      { header: "binary", width: 24, value: (row) => row.binary },
      {
        header: options.verbose ? "details" : "description",
        width: options.verbose ? 72 : 44,
        value: (row) => row.detail,
      },
    ],
  );
}

function compactStatusRows(
  statuses: Array<ReturnType<typeof getMicroserviceStatus>>,
  options: { verbose?: boolean },
): string {
  return formatTextTable(
    statuses.map((status) => ({
      name: status.name,
      installed: status.installed ? "yes" : "no",
      version: status.version ?? "-",
      env: status.meta?.requiredEnv.join(", ") ?? "",
    })),
    [
      { header: "name", width: 14, value: (row) => row.name },
      { header: "installed", width: 9, value: (row) => row.installed },
      { header: "version", width: 12, value: (row) => row.version },
      {
        header: options.verbose ? "required_env" : "hint",
        width: options.verbose ? 64 : 40,
        value: (row) =>
          options.verbose
            ? row.env
            : row.installed === "yes"
              ? "use verbose:true for env"
              : "install with install_microservice",
      },
    ],
  );
}

function compactRunResult(
  result: Awaited<ReturnType<typeof runMicroserviceCommand>>,
  options: { verbose?: boolean; maxChars?: number; json?: boolean },
): string {
  if (options.json) {
    return JSON.stringify(
      {
        success: result.success,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      },
      null,
      2,
    );
  }

  const lines = [`success: ${result.success}`, `exitCode: ${result.exitCode}`];
  for (const [label, value] of [
    ["stdout", result.stdout],
    ["stderr", result.stderr],
  ] as const) {
    if (!value) continue;
    const summary = options.verbose
      ? { text: value, truncated: false, omittedChars: 0, omittedLines: 0 }
      : summarizeOutput(value, {
          maxChars: options.maxChars ?? DEFAULT_OUTPUT_MAX_CHARS,
        });
    lines.push(`${label}:`);
    lines.push(summary.text);
    if (summary.truncated) {
      lines.push(
        formatTruncationHint(summary, "call with verbose:true for full output"),
      );
    }
  }
  return lines.join("\n");
}

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "microservices",
    version: getPackageVersion(),
  });

  server.registerTool(
    "list_microservices",
    {
      title: "List Microservices",
      description:
        "List available production microservices. Compact by default; use verbose/json and limit/offset for gradual disclosure.",
      inputSchema: {
        installed_only: z.boolean().optional(),
        limit: z.number().int().min(0).optional(),
        offset: z.number().int().min(0).optional(),
        verbose: z.boolean().optional(),
        json: z.boolean().optional(),
      },
    },
    async ({ installed_only, limit, offset = 0, verbose, json }) => {
      const services = installed_only
        ? MICROSERVICES.filter((m) => microserviceExists(m.name))
        : MICROSERVICES;
      const fullPayload = services.map((m) => ({
        name: m.name,
        package: m.package,
        binary: m.binary,
        category: m.category,
        description: m.description,
        schemaPrefix: m.schemaPrefix,
        installed: microserviceExists(m.name),
        requiredEnv: m.requiredEnv,
      }));

      if (json) return jsonContent(fullPayload);

      const page = paginate(services, {
        limit: limit ?? DEFAULT_LIST_LIMIT,
        offset,
      });
      return textContent(
        [
          `Microservices (${services.length} total)`,
          compactServiceRows(page, { verbose }),
          formatPageHint({
            shown: page.length,
            total: services.length,
            limit: limit ?? DEFAULT_LIST_LIMIT,
            offset,
            detailHint:
              "Use limit/offset, verbose:true, json:true, or get_microservice_info for details.",
          }),
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "search_microservices",
    {
      title: "Search Microservices",
      description:
        "Search microservices by name, description, or tags. Compact by default; use verbose/json for details.",
      inputSchema: {
        query: z.string(),
        limit: z.number().int().min(0).optional(),
        verbose: z.boolean().optional(),
        json: z.boolean().optional(),
      },
    },
    async ({ query, limit, verbose, json }) => {
      const results = searchMicroservices(query);
      const payload = results.map((m) => ({
        name: m.name,
        package: m.package,
        description: m.description,
        category: m.category,
        tags: m.tags,
      }));

      if (json) return jsonContent(payload);

      const page = paginate(results, { limit: limit ?? DEFAULT_SEARCH_LIMIT });
      if (page.length === 0)
        return textContent(`No microservices matching "${query}".`);
      return textContent(
        [
          `Search results for "${query}" (${results.length} total)`,
          compactServiceRows(page, { verbose }),
          formatPageHint({
            shown: page.length,
            total: results.length,
            limit: limit ?? DEFAULT_SEARCH_LIMIT,
            detailHint:
              "Use limit, verbose:true, json:true, or get_microservice_info for details.",
          }),
        ].join("\n"),
      );
    },
  );

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

  server.registerTool(
    "microservice_status",
    {
      title: "Microservice Status",
      description:
        "Check installation status. Compact by default; use verbose/json for full env metadata.",
      inputSchema: {
        name: z.string().optional(),
        limit: z.number().int().min(0).optional(),
        offset: z.number().int().min(0).optional(),
        verbose: z.boolean().optional(),
        json: z.boolean().optional(),
      },
    },
    async ({ name, limit, offset = 0, verbose, json }) => {
      if (name) {
        const status = getMicroserviceStatus(name);
        if (json) return jsonContent(status);
        return textContent(
          [
            `Status for ${status.name}`,
            compactStatusRows([status], { verbose }),
            verbose
              ? ""
              : "Use verbose:true or get_microservice_info for env details.",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
      const statuses = MICROSERVICES.map((m) => getMicroserviceStatus(m.name));
      if (json) return jsonContent(statuses);
      const page = paginate(statuses, {
        limit: limit ?? DEFAULT_LIST_LIMIT,
        offset,
      });
      const installed = statuses.filter((status) => status.installed).length;
      return textContent(
        [
          `Microservice status (${installed}/${statuses.length} installed)`,
          compactStatusRows(page, { verbose }),
          formatPageHint({
            shown: page.length,
            total: statuses.length,
            limit: limit ?? DEFAULT_LIST_LIMIT,
            offset,
            detailHint:
              "Use limit/offset, verbose:true, json:true, or get_microservice_info for details.",
          }),
        ].join("\n"),
      );
    },
  );

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
        verbose: z.boolean().optional(),
        max_chars: z.number().int().min(0).optional(),
        json: z.boolean().optional(),
      },
    },
    async ({ name, args, verbose, max_chars, json }) => {
      const result = await runMicroserviceCommand(name, args);
      return textContent(
        compactRunResult(result, {
          verbose,
          maxChars: max_chars,
          json,
        }),
      );
    },
  );

  server.registerTool(
    "check_env",
    {
      title: "Check Environment Variables",
      description:
        "Verify if all required and optional environment variables are set for installed microservices. Compact by default.",
      inputSchema: {
        verbose: z.boolean().optional(),
        json: z.boolean().optional(),
      },
    },
    async ({ verbose, json }) => {
      const installed = MICROSERVICES.filter((m) => microserviceExists(m.name));
      if (installed.length === 0) {
        return {
          content: [
            { type: "text", text: "No microservices installed to check." },
          ],
        };
      }

      const report = installed.map((m) => {
        const missingRequired = m.requiredEnv.filter(
          (env) => !process.env[env],
        );
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

      const totalMissing = report.reduce(
        (acc, r) => acc + r.missing_required.length,
        0,
      );
      const payload = {
        summary: {
          installed: installed.length,
          total_missing_required: totalMissing,
          all_ok: report.every((r) => r.ok),
        },
        services: report,
      };
      if (json) return jsonContent(payload);

      const rows = report.map((service) => ({
        name: service.name,
        status: service.ok ? "ok" : "missing",
        required: service.missing_required.join(", "),
        optional: service.missing_optional.join(", "),
      }));
      return textContent(
        [
          `Environment check: ${installed.length} installed, ${totalMissing} missing required var(s)`,
          formatTextTable(rows, [
            { header: "service", width: 14, value: (row) => row.name },
            { header: "status", width: 9, value: (row) => row.status },
            {
              header: "missing_required",
              width: verbose ? 60 : 28,
              value: (row) => row.required || "-",
            },
            ...(verbose
              ? [
                  {
                    header: "missing_optional",
                    width: 60,
                    value: (row: (typeof rows)[number]) => row.optional || "-",
                  },
                ]
              : []),
          ]),
          verbose
            ? "Use json:true for the complete machine-readable report."
            : "Use verbose:true for optional vars or json:true for the complete report.",
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "scaffold_microservice",
    {
      title: "Scaffold Microservice",
      description: "Scaffold a new microservice from the _template directory.",
      inputSchema: {
        name: z
          .string()
          .describe(
            "The name of the new microservice (lowercase, dashes only)",
          ),
      },
    },
    async ({ name }) => {
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
        const targetDir = path.join(
          cwd,
          "microservices",
          `microservice-${name}`,
        );

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

        fs.cpSync(templateDir, targetDir, { recursive: true });

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

  server.registerTool(
    "init_all_microservices",
    {
      title: "Init All Microservices",
      description:
        "Run migrations and confirm setup for all installed microservices.",
      inputSchema: {
        db: z.string().describe("PostgreSQL connection URL"),
        verbose: z.boolean().optional(),
        json: z.boolean().optional(),
      },
    },
    async ({ db, verbose, json }) => {
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
          output: res.stdout || res.stderr || "no output",
        });
        if (!res.success) hasErrors = true;
      }

      const payload = {
        success: !hasErrors,
        initialized: installed.length,
        results,
      };
      if (json) return jsonContent(payload);
      const displayResults = verbose
        ? results
        : results.map((result) => ({
            ...result,
            output: truncateText(result.output, 160),
          }));
      return textContent(
        [
          `Init ${payload.success ? "succeeded" : "had failures"} for ${installed.length} installed service(s).`,
          formatTextTable(displayResults, [
            { header: "service", width: 14, value: (row) => row.name },
            {
              header: "ok",
              width: 4,
              value: (row) => (row.success ? "yes" : "no"),
            },
            { header: "output", width: 100, value: (row) => row.output },
          ]),
          "Use verbose:true or json:true for more detail.",
        ].join("\n"),
      );
    },
  );

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
        verbose: z.boolean().optional(),
        json: z.boolean().optional(),
      },
    },
    async ({ db, verbose, json }) => {
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
          output: res.stdout || res.stderr || "no output",
        });
        if (!res.success) hasErrors = true;
      }

      const payload = {
        success: !hasErrors,
        migrated: installed.length,
        results,
      };
      if (json) return jsonContent(payload);
      const displayResults = verbose
        ? results
        : results.map((result) => ({
            ...result,
            output: truncateText(result.output, 160),
          }));
      return textContent(
        [
          `Migration ${payload.success ? "succeeded" : "had failures"} for ${installed.length} installed service(s).`,
          formatTextTable(displayResults, [
            { header: "service", width: 14, value: (row) => row.name },
            {
              header: "ok",
              width: 4,
              value: (row) => (row.success ? "yes" : "no"),
            },
            { header: "output", width: 100, value: (row) => row.output },
          ]),
          "Use verbose:true or json:true for more detail.",
        ].join("\n"),
      );
    },
  );

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
        for (const m of installed) {
          const proc = spawn(m.binary, ["serve"], {
            env: process.env,
            stdio: "ignore",
            detached: true,
          });

          proc.unref();
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
          {
            type: "text",
            text: JSON.stringify({ removed: ok, name }, null, 2),
          },
        ],
      };
    },
  );

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

  return server;
}

async function main(): Promise<void> {
  if (hasFlag("--help", "-h")) {
    printHelp();
    return;
  }

  if (hasFlag("--version", "-V")) {
    process.stdout.write(`${getPackageVersion()}\n`);
    return;
  }

  if (isStdioMode()) {
    const server = buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }
  // Default: shared Streamable HTTP server (one process per MCP, many agents).
  const handle = await startMcpHttpServer(buildServer, {
    port: resolveMcpHttpPort(),
  });
  process.on("SIGINT", () => {
    void handle.close().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void handle.close().finally(() => process.exit(0));
  });
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
