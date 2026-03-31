#!/usr/bin/env bun
import { Command } from "commander";
import { getDb, closeDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { listWorkspaceEndpoints, deleteEndpoint } from "../lib/endpoints.js";
import { triggerWebhook, replayDelivery, listDeliveries } from "../lib/deliver.js";

const program = new Command();
program.name("microservice-webhooks").description("Webhooks microservice — endpoint registry, event delivery, HMAC signatures, retry").version("0.0.1");

program.command("migrate")
  .description("Run database migrations")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async o => {
    if (o.db) process.env["DATABASE_URL"] = o.db;
    const sql = getDb();
    try { await migrate(sql); console.log("✓ webhooks schema migrations complete"); }
    finally { await closeDb(); }
  });

program.command("serve")
  .description("Start the HTTP server")
  .option("--port <n>", "Port", String(process.env["WEBHOOKS_PORT"] ?? "3011"))
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async o => {
    if (o.db) process.env["DATABASE_URL"] = o.db;
    await startServer(parseInt(o.port, 10));
  });

program.command("mcp")
  .description("Start the MCP stdio server")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async o => {
    if (o.db) process.env["DATABASE_URL"] = o.db;
    await import("../mcp/index.js");
  });

program.command("status")
  .description("Check database connectivity and schema status")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async o => {
    if (o.db) process.env["DATABASE_URL"] = o.db;
    const sql = getDb();
    try {
      const [{ version }] = await sql`SELECT version()`;
      console.log("✓ PostgreSQL:", version.split(" ").slice(0, 2).join(" "));
      const s = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'webhooks'`;
      console.log("  Schema 'webhooks':", s.length > 0 ? "✓" : "✗ (run migrate)");
    } catch (e) {
      console.error("✗", e instanceof Error ? e.message : e);
      process.exit(1);
    } finally { await closeDb(); }
  });

program.command("doctor")
  .description("Check configuration and DB connectivity")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async o => {
    if (o.db) process.env["DATABASE_URL"] = o.db;
    let allOk = true;
    const check = (label: string, pass: boolean, hint?: string) => {
      console.log(`  ${pass ? "✓" : "✗"} ${label}${!pass && hint ? `  →  ${hint}` : ""}`);
      if (!pass) allOk = false;
    };
    console.log("\nmicroservice-webhooks doctor\n");
    check("DATABASE_URL", !!process.env["DATABASE_URL"], "set DATABASE_URL=postgres://...");
    if (process.env["DATABASE_URL"]) {
      const sql = getDb();
      try {
        const start = Date.now(); await sql`SELECT 1`; check(`PostgreSQL reachable (${Date.now() - start}ms)`, true);
        const schemas = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'webhooks'`;
        check("Schema 'webhooks' exists", schemas.length > 0, "run: microservice-webhooks migrate");
        if (schemas.length > 0) {
          const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'webhooks' ORDER BY table_name`;
          check(`Tables (${tables.length})`, tables.length >= 3, tables.map((t: { table_name: string }) => t.table_name).join(", "));
        }
      } catch (e) { check("PostgreSQL reachable", false, e instanceof Error ? e.message : String(e)); }
      finally { await closeDb(); }
    }
    console.log(`\n${allOk ? "✓ All checks passed" : "✗ Some checks failed"}\n`);
    if (!allOk) process.exit(1);
  });

program.command("init")
  .description("Run migrations and confirm setup")
  .requiredOption("--db <url>", "PostgreSQL connection URL")
  .action(async o => {
    process.env["DATABASE_URL"] = o.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ microservice-webhooks ready\n  Schema: webhooks.*\n  Next: microservice-webhooks serve --port 3011");
    } finally { await closeDb(); }
  });

program.command("list-endpoints")
  .description("List webhook endpoints for a workspace")
  .requiredOption("--workspace <id>", "Workspace UUID")
  .option("--db <url>", "PostgreSQL connection URL")
  .option("--json", "Output as JSON")
  .action(async o => {
    if (o.db) process.env["DATABASE_URL"] = o.db;
    const sql = getDb();
    try {
      const endpoints = await listWorkspaceEndpoints(sql, o.workspace);
      if (o.json) {
        console.log(JSON.stringify(endpoints, null, 2));
      } else {
        for (const ep of endpoints) {
          const evts = ep.events.length === 0 ? "*" : ep.events.join(",");
          console.log(`  ${ep.id}  ${ep.url.padEnd(50)} events:${evts}  ${ep.active ? "active" : "disabled"}  failures:${ep.failure_count}`);
        }
      }
    } finally { await closeDb(); }
  });

program.command("trigger")
  .description("Trigger a webhook event")
  .requiredOption("--workspace <id>", "Workspace UUID")
  .requiredOption("--event <name>", "Event name")
  .option("--payload-json <json>", "JSON payload", "{}")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async o => {
    if (o.db) process.env["DATABASE_URL"] = o.db;
    const sql = getDb();
    try {
      await triggerWebhook(sql, o.workspace, o.event, JSON.parse(o.payloadJson));
      console.log(`✓ Triggered event "${o.event}" for workspace ${o.workspace}`);
    } finally { await closeDb(); }
  });

program.command("replay")
  .description("Replay (retry) a webhook delivery")
  .requiredOption("--delivery-id <id>", "Delivery UUID")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async o => {
    if (o.db) process.env["DATABASE_URL"] = o.db;
    const sql = getDb();
    try {
      await replayDelivery(sql, o.deliveryId);
      console.log(`✓ Replayed delivery ${o.deliveryId}`);
    } finally { await closeDb(); }
  });

program.parse();
