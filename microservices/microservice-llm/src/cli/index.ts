#!/usr/bin/env bun
import { Command } from "commander";
import { closeDb, getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { chat } from "../lib/gateway.js";
import { getAvailableModels } from "../lib/providers.js";
import { getWorkspaceUsage } from "../lib/usage.js";

const program = new Command();

program
  .name("microservice-llm")
  .description(
    "LLM gateway microservice — multi-provider chat, usage tracking, cost calculation",
  )
  .version("0.0.1");

program
  .command("migrate")
  .description("Run database migrations (creates llm.* schema)")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ llm schema migrations complete");
    } finally {
      await closeDb();
    }
  });

program
  .command("serve")
  .description("Start the HTTP API server")
  .option("--port <n>", "Port", String(process.env.LLM_PORT ?? "3009"))
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    await startServer(parseInt(opts.port, 10));
  });

program
  .command("mcp")
  .description("Start the MCP server (stdio)")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    await import("../mcp/index.js");
  });

program
  .command("status")
  .description("Show connection and schema status")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      const [{ version }] = await sql`SELECT version()`;
      console.log("✓ PostgreSQL:", version.split(" ").slice(0, 2).join(" "));
      const schemas =
        await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'llm'`;
      console.log(
        "  Schema 'llm':",
        schemas.length > 0 ? "✓ exists" : "✗ missing (run migrate)",
      );
      if (schemas.length > 0) {
        const [{ count }] =
          await sql`SELECT COUNT(*) as count FROM llm.requests`;
        console.log("  Requests:", count);
      }
    } catch (err) {
      console.error(
        "✗ Connection failed:",
        err instanceof Error ? err.message : err,
      );
      process.exit(1);
    } finally {
      await closeDb();
    }
  });

program
  .command("chat")
  .description("Send a chat message to an LLM provider")
  .requiredOption("--workspace <id>", "Workspace UUID")
  .option("--model <model>", "Model to use")
  .option("--message <text>", "Message to send")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const message = opts.message ?? "Hello, world!";
    const sql = getDb();
    try {
      await migrate(sql);
      const result = await chat(sql, {
        workspaceId: opts.workspace,
        messages: [{ role: "user", content: message }],
        model: opts.model,
      });
      console.log(`Model: ${result.model} (${result.provider})`);
      console.log(
        `Tokens: ${result.usage.total_tokens} (${result.usage.prompt_tokens} in, ${result.usage.completion_tokens} out)`,
      );
      console.log(`Cost: $${result.cost_usd.toFixed(6)}`);
      console.log(`\nResponse:\n${result.content}`);
    } finally {
      await closeDb();
    }
  });

program
  .command("usage")
  .description("Show usage statistics for a workspace")
  .requiredOption("--workspace <id>", "Workspace UUID")
  .option("--since <date>", "ISO date string to filter from")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      const since = opts.since ? new Date(opts.since) : undefined;
      const usage = await getWorkspaceUsage(sql, opts.workspace, since);
      if (opts.json) {
        console.log(JSON.stringify(usage, null, 2));
      } else {
        console.log(`Workspace: ${opts.workspace}`);
        console.log(`Total requests: ${usage.total_requests}`);
        console.log(`Total tokens:   ${usage.total_tokens}`);
        console.log(`Total cost:     $${usage.total_cost_usd.toFixed(6)}`);
        if (usage.by_model.length > 0) {
          console.log("\nBy model:");
          for (const m of usage.by_model) {
            console.log(
              `  ${m.model} (${m.provider}): ${m.requests} requests, ${m.total_tokens} tokens, $${m.cost_usd.toFixed(6)}`,
            );
          }
        }
      }
    } finally {
      await closeDb();
    }
  });

program
  .command("list-models")
  .description("List available models based on configured API keys")
  .action(() => {
    const models = getAvailableModels();
    if (models.length === 0) {
      console.log(
        "No providers configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GROQ_API_KEY.",
      );
    } else {
      console.log(`Available models (${models.length}):`);
      for (const m of models) {
        console.log(`  ${m}`);
      }
    }
  });

program
  .command("doctor")
  .description("Check configuration, env vars, and DB connectivity")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    let ok = true;
    const check = (label: string, pass: boolean, hint?: string) => {
      console.log(
        `  ${pass ? "✓" : "✗"} ${label}${!pass && hint ? `  →  ${hint}` : ""}`,
      );
      if (!pass) ok = false;
    };

    console.log("\nmicroservice-llm doctor\n");

    // Env vars
    check(
      "DATABASE_URL",
      !!process.env.DATABASE_URL,
      "set DATABASE_URL=postgres://...",
    );
    const hasAnyProvider = !!(
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.GROQ_API_KEY
    );
    check(
      "At least one provider key",
      hasAnyProvider,
      "set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GROQ_API_KEY",
    );
    check("OPENAI_API_KEY (optional)", true); // informational
    check("ANTHROPIC_API_KEY (optional)", true);
    check("GROQ_API_KEY (optional)", true);

    // Available models
    const models = getAvailableModels();
    console.log(
      `\n  Available models (${models.length}): ${models.join(", ") || "none"}`,
    );

    // DB connectivity
    if (process.env.DATABASE_URL) {
      const sql = getDb();
      try {
        const start = Date.now();
        await sql`SELECT 1`;
        check(`PostgreSQL reachable (${Date.now() - start}ms)`, true);
        const schemas =
          await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'llm'`;
        check(
          "Schema 'llm' exists",
          schemas.length > 0,
          "run: microservice-llm migrate",
        );
        if (schemas.length > 0) {
          const tables =
            await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'llm' ORDER BY table_name`;
          const names = tables.map((t: any) => t.table_name).join(", ");
          check(
            `Tables (${tables.length})`,
            tables.length >= 2,
            `found: ${names}`,
          );
        }
      } catch (e) {
        check(
          "PostgreSQL reachable",
          false,
          e instanceof Error ? e.message : String(e),
        );
      } finally {
        await closeDb();
      }
    }

    console.log(
      `\n${ok ? "✓ All checks passed" : "✗ Some checks failed — see above"}\n`,
    );
    if (!ok) process.exit(1);
  });

program
  .command("init")
  .description("Run migrations and confirm setup (one-step first-time init)")
  .requiredOption("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ microservice-llm ready");
      console.log("  Schema: llm.*");
      console.log("  Next: microservice-llm serve --port 3009");
    } finally {
      await closeDb();
    }
  });

program.parse();
