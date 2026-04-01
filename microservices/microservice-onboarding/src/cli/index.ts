#!/usr/bin/env bun
import { Command } from "commander";
import { closeDb, getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { createFlow, listFlows } from "../lib/flows.js";
import { getProgress } from "../lib/progress.js";

const program = new Command();

program
  .name("microservice-onboarding")
  .description(
    "Onboarding microservice — flows, steps, and user progress tracking",
  )
  .version("0.0.1");

program
  .command("migrate")
  .description("Run database migrations (creates onboarding.* schema)")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ onboarding schema migrations complete");
    } finally {
      await closeDb();
    }
  });

program
  .command("serve")
  .description("Start the HTTP API server")
  .option("--port <n>", "Port", String(process.env.ONBOARDING_PORT ?? "3014"))
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
        await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'onboarding'`;
      console.log(
        "  Schema 'onboarding':",
        schemas.length > 0 ? "✓ exists" : "✗ missing (run migrate)",
      );
      if (schemas.length > 0) {
        const [{ count }] =
          await sql`SELECT COUNT(*) as count FROM onboarding.flows`;
        console.log("  Flows:", count);
        const [{ count: progressCount }] =
          await sql`SELECT COUNT(*) as count FROM onboarding.progress`;
        console.log("  Progress records:", progressCount);
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

    console.log("\nmicroservice-onboarding doctor\n");

    check(
      "DATABASE_URL",
      !!process.env.DATABASE_URL,
      "set DATABASE_URL=postgres://...",
    );

    if (process.env.DATABASE_URL) {
      const sql = getDb();
      try {
        const start = Date.now();
        await sql`SELECT 1`;
        check(`PostgreSQL reachable (${Date.now() - start}ms)`, true);
        const schemas =
          await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'onboarding'`;
        check(
          "Schema 'onboarding' exists",
          schemas.length > 0,
          "run: microservice-onboarding migrate",
        );
        if (schemas.length > 0) {
          const tables =
            await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'onboarding' ORDER BY table_name`;
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
      console.log("✓ microservice-onboarding ready");
      console.log("  Schema: onboarding.*");
      console.log("  Next: microservice-onboarding serve --port 3014");
    } finally {
      await closeDb();
    }
  });

program
  .command("list-flows")
  .description("List all onboarding flows")
  .option("--active", "Show only active flows")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const flows = await listFlows(sql, !!opts.active);
      if (opts.json) {
        console.log(JSON.stringify(flows, null, 2));
      } else {
        console.log(`Flows (${flows.length}):`);
        for (const f of flows) {
          const stepsCount = Array.isArray(f.steps) ? f.steps.length : 0;
          console.log(
            `  ${f.id}  ${f.name}  ${f.active ? "active" : "inactive"}  (${stepsCount} steps)`,
          );
        }
      }
    } finally {
      await closeDb();
    }
  });

program
  .command("create-flow")
  .description("Create a new onboarding flow")
  .requiredOption("--name <name>", "Flow name")
  .option("--description <desc>", "Flow description")
  .option("--steps-json <json>", "Steps as JSON array")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      let steps: Parameters<typeof createFlow>[1]["steps"] = [];
      if (opts.stepsJson) {
        try {
          steps = JSON.parse(opts.stepsJson);
        } catch {
          console.error("✗ Invalid JSON for --steps-json");
          process.exit(1);
        }
      }
      const flow = await createFlow(sql, {
        name: opts.name,
        description: opts.description,
        steps,
      });
      console.log("✓ Created flow:", flow.id, flow.name);
    } finally {
      await closeDb();
    }
  });

program
  .command("show-progress")
  .description("Show onboarding progress for a user on a flow")
  .requiredOption("--user <user_id>", "User ID (UUID)")
  .requiredOption("--flow <flow_id>", "Flow ID (UUID)")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      const summary = await getProgress(sql, opts.user, opts.flow);
      if (!summary) {
        console.log("✗ No progress found (flow may not exist)");
        process.exit(1);
      }
      if (opts.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log(`Flow: ${summary.flow?.name ?? opts.flow}`);
        console.log(
          `Progress: ${summary.percentage}%  ${summary.is_complete ? "✓ complete" : "in progress"}`,
        );
        console.log(
          `Completed steps (${summary.completed_steps.length}): ${summary.completed_steps.join(", ") || "none"}`,
        );
        console.log(
          `Pending steps (${summary.pending_steps.length}): ${summary.pending_steps.map((s) => `${s.id}${s.required ? "" : " (optional)"}`).join(", ") || "none"}`,
        );
      }
    } finally {
      await closeDb();
    }
  });

program.parse();
