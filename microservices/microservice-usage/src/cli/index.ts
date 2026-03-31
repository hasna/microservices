#!/usr/bin/env bun
import { Command } from "commander";
import { getDb, closeDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { track } from "../lib/track.js";
import { getUsageSummary, checkQuota, setQuota } from "../lib/query.js";

const program = new Command();

program
  .name("microservice-usage")
  .description("Usage tracking microservice — event ingestion, quota enforcement, aggregate reporting")
  .version("0.0.1");

program
  .command("migrate")
  .description("Run database migrations (creates usage.* schema)")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ usage schema migrations complete");
    } finally { await closeDb(); }
  });

program
  .command("serve")
  .description("Start the HTTP API server")
  .option("--port <n>", "Port", String(process.env["USAGE_PORT"] ?? "3010"))
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    await startServer(parseInt(opts.port, 10));
  });

program
  .command("mcp")
  .description("Start the MCP server (stdio)")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    await import("../mcp/index.js");
  });

program
  .command("status")
  .description("Show connection and schema status")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      const [{ version }] = await sql`SELECT version()`;
      console.log("✓ PostgreSQL:", version.split(" ").slice(0, 2).join(" "));
      const schemas = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'usage'`;
      console.log("  Schema 'usage':", schemas.length > 0 ? "✓ exists" : "✗ missing (run migrate)");
      if (schemas.length > 0) {
        const [{ count }] = await sql`SELECT COUNT(*) as count FROM usage.events`;
        console.log("  Events:", count);
      }
    } catch (err) {
      console.error("✗ Connection failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    } finally { await closeDb(); }
  });

program
  .command("track")
  .description("Track a usage event")
  .requiredOption("--workspace <id>", "Workspace ID")
  .requiredOption("--metric <name>", "Metric name")
  .requiredOption("--quantity <n>", "Quantity")
  .option("--unit <unit>", "Unit of measure", "count")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      await track(sql, {
        workspaceId: opts.workspace,
        metric: opts.metric,
        quantity: parseFloat(opts.quantity),
        unit: opts.unit,
      });
      console.log(`✓ Tracked ${opts.quantity} ${opts.unit} of ${opts.metric} for workspace ${opts.workspace}`);
    } finally { await closeDb(); }
  });

program
  .command("report")
  .description("Show usage report for a workspace")
  .requiredOption("--workspace <id>", "Workspace ID")
  .option("--metric <name>", "Filter by metric")
  .option("--period <period>", "Period filter: day, month (affects since calculation)", "month")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      // Calculate since based on period
      const now = new Date();
      let since: Date | undefined;
      if (opts.period === "day") {
        since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (opts.period === "month") {
        since = new Date(now.getFullYear(), now.getMonth(), 1);
      }
      const summary = await getUsageSummary(sql, opts.workspace, opts.metric, since);
      if (opts.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }
      if (summary.length === 0) {
        console.log("No usage data found.");
        return;
      }
      console.log(`\nUsage report for workspace: ${opts.workspace}\n`);
      for (const s of summary) {
        console.log(`  ${s.metric}: ${s.total} ${s.unit} (since ${s.period_start})`);
      }
    } finally { await closeDb(); }
  });

program
  .command("init")
  .description("Run migrations and confirm setup")
  .requiredOption("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ microservice-usage ready\n  Schema: usage.*\n  Next: microservice-usage serve --port 3010");
    } finally { await closeDb(); }
  });

program
  .command("doctor")
  .description("Check configuration and DB connectivity")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    let allOk = true;
    const check = (label: string, pass: boolean, hint?: string) => {
      console.log(`  ${pass ? "✓" : "✗"} ${label}${!pass && hint ? `  →  ${hint}` : ""}`);
      if (!pass) allOk = false;
    };
    console.log("\nmicroservice-usage doctor\n");
    check("DATABASE_URL", !!process.env["DATABASE_URL"], "set DATABASE_URL=postgres://...");
    if (process.env["DATABASE_URL"]) {
      const sql = getDb();
      try {
        const start = Date.now();
        await sql`SELECT 1`;
        check(`PostgreSQL reachable (${Date.now() - start}ms)`, true);
        const schemas = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'usage'`;
        check("Schema 'usage' exists", schemas.length > 0, "run: microservice-usage migrate");
        if (schemas.length > 0) {
          const [{ count }] = await sql`SELECT COUNT(*) as count FROM usage.events`;
          console.log(`  ℹ Events stored: ${count}`);
        }
      } catch (e) {
        check("PostgreSQL reachable", false, e instanceof Error ? e.message : String(e));
      } finally { await closeDb(); }
    }
    console.log(`\n${allOk ? "✓ All checks passed" : "✗ Some checks failed"}\n`);
    if (!allOk) process.exit(1);
  });

program.parse();
