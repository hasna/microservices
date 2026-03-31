#!/usr/bin/env bun
import { Command } from "commander";
import { getDb, closeDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { queryEvents, exportEvents, countEvents } from "../lib/events.js";
import { applyRetention } from "../lib/retention.js";
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

program.parse();
