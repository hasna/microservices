#!/usr/bin/env bun
import { Command } from "commander";
import { getDb, closeDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { queryEvents, exportEvents, countEvents } from "../lib/events.js";
import { applyRetention, getRetentionPolicy } from "../lib/retention.js";
import { getAuditStats } from "../lib/stats.js";
import { writeFileSync } from "fs";

const program = new Command();

program
  .name("microservice-audit")
  .description("Audit microservice — immutable event log, tamper-evident checksums, retention policies")
  .version("0.0.1");

program
  .command("migrate")
  .description("Run database migrations (creates audit.* schema)")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ audit schema migrations complete");
    } finally { await closeDb(); }
  });

program
  .command("serve")
  .description("Start the HTTP API server")
  .option("--port <n>", "Port", String(process.env["AUDIT_PORT"] ?? "3006"))
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
      const schemas = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'audit'`;
      console.log("  Schema 'audit':", schemas.length > 0 ? "✓ exists" : "✗ missing (run migrate)");
      if (schemas.length > 0) {
        const [{ count }] = await sql`SELECT COUNT(*) as count FROM audit.events`;
        console.log("  Events:", count);
      }
    } catch (err) {
      console.error("✗ Connection failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    } finally { await closeDb(); }
  });

program
  .command("query")
  .description("Query audit events")
  .option("--workspace <id>", "Filter by workspace ID")
  .option("--action <action>", "Filter by action")
  .option("--from <date>", "Filter from date (ISO string)")
  .option("--to <date>", "Filter to date (ISO string)")
  .option("--limit <n>", "Max results", "20")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const events = await queryEvents(sql, {
        workspaceId: opts.workspace,
        action: opts.action,
        from: opts.from ? new Date(opts.from) : undefined,
        to: opts.to ? new Date(opts.to) : undefined,
        limit: parseInt(opts.limit, 10),
      });
      if (opts.json) {
        console.log(JSON.stringify({ data: events, count: events.length }, null, 2));
        return;
      }
      if (events.length === 0) {
        console.log("No events found.");
        return;
      }
      for (const e of events) {
        const ts = e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at);
        console.log(`  [${ts}] [${e.severity}] ${e.action} on ${e.resource_type}${e.resource_id ? `/${e.resource_id}` : ""} by ${e.actor_id ?? "system"}`);
      }
      const total = await countEvents(sql, {
        workspaceId: opts.workspace,
        action: opts.action,
        from: opts.from ? new Date(opts.from) : undefined,
        to: opts.to ? new Date(opts.to) : undefined,
      });
      console.log(`\nShowing ${events.length} of ${total} events`);
    } finally { await closeDb(); }
  });

program
  .command("export")
  .description("Export audit events to a file")
  .option("--workspace <id>", "Filter by workspace ID")
  .option("--format <format>", "Output format: json or csv", "json")
  .option("--output <path>", "Output file path (default: stdout)")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const format = opts.format as "json" | "csv";
    if (format !== "json" && format !== "csv") {
      console.error("✗ format must be json or csv");
      process.exit(1);
    }
    const sql = getDb();
    try {
      await migrate(sql);
      const output = await exportEvents(sql, { workspaceId: opts.workspace }, format);
      if (opts.output) {
        writeFileSync(opts.output, output, "utf8");
        console.log(`✓ Exported to ${opts.output}`);
      } else {
        process.stdout.write(output);
      }
    } finally { await closeDb(); }
  });

program
  .command("apply-retention")
  .description("Apply retention policy and delete old events for a workspace")
  .requiredOption("--workspace <id>", "Workspace ID")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const policy = await getRetentionPolicy(sql, opts.workspace);
      const deleted = await applyRetention(sql, opts.workspace);
      const days = policy ? policy.retain_days : 0;
      console.log(`✓ Deleted ${deleted} events older than ${days} days`);
    } finally { await closeDb(); }
  });

program
  .command("stats")
  .description("Show audit statistics for a workspace")
  .requiredOption("--workspace <id>", "Workspace ID")
  .option("--days <n>", "Number of days to look back", "30")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const days = parseInt(opts.days, 10);
      const stats = await getAuditStats(sql, opts.workspace, days);
      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }
      console.log(`\nAudit stats for workspace: ${opts.workspace} (last ${days} days)\n`);
      console.log(`  Total events: ${stats.total_events}`);
      if (stats.top_actions.length > 0) {
        console.log("\n  Top actions:");
        for (const a of stats.top_actions) {
          console.log(`    ${a.action}: ${a.count}`);
        }
      }
      if (stats.events_per_day.length > 0) {
        console.log("\n  Events per day:");
        for (const d of stats.events_per_day) {
          console.log(`    ${d.date}: ${d.count}`);
        }
      }
    } finally { await closeDb(); }
  });

program.parse();

program.command("init").description("Run migrations and confirm setup").requiredOption("--db <url>").action(async o => {
  process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { await migrate(sql); console.log("✓ microservice-audit ready\n  Schema: audit.*\n  Next: microservice-audit serve --port 3006"); } finally { await closeDb(); }
});

program.command("doctor").description("Check configuration and DB connectivity").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  let allOk = true;
  const check = (label: string, pass: boolean, hint?: string) => { console.log(`  ${pass ? "✓" : "✗"} ${label}${!pass && hint ? `  →  ${hint}` : ""}`); if (!pass) allOk = false; };
  console.log("\nmicroservice-audit doctor\n");
  check("DATABASE_URL", !!process.env["DATABASE_URL"], "set DATABASE_URL=postgres://...");
  console.log(`  ℹ Retention: default 90 days (configurable per workspace)`);
  if (process.env["DATABASE_URL"]) {
    const sql = getDb();
    try {
      const start = Date.now(); await sql`SELECT 1`; check(`PostgreSQL reachable (${Date.now() - start}ms)`, true);
      const schemas = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'audit'`;
      check("Schema 'audit' exists", schemas.length > 0, "run: microservice-audit migrate");
      if (schemas.length > 0) {
        const [{ count }] = await sql`SELECT COUNT(*) as count FROM audit.events`;
        console.log(`  ℹ Events stored: ${count}`);
      }
    } catch (e) { check("PostgreSQL reachable", false, e instanceof Error ? e.message : String(e)); }
    finally { await closeDb(); }
  }
  console.log(`\n${allOk ? "✓ All checks passed" : "✗ Some checks failed"}\n`);
  if (!allOk) process.exit(1);
});
