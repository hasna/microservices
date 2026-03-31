#!/usr/bin/env bun
/**
 * CLI for microservice-waitlist.
 * Binary: microservice-waitlist
 *
 * Commands:
 *   microservice-waitlist migrate
 *   microservice-waitlist serve [--port N]
 *   microservice-waitlist mcp
 *   microservice-waitlist status
 *   microservice-waitlist doctor
 *   microservice-waitlist init --db <url>
 *   microservice-waitlist stats --campaign <id>
 *   microservice-waitlist invite-batch --campaign <id> --count <n>
 *   microservice-waitlist list --campaign <id> [--status <status>]
 */

import { Command } from "commander";
import { getDb, closeDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { listEntries, inviteBatch } from "../lib/entries.js";
import { getWaitlistStats } from "../lib/stats.js";

const program = new Command();

program
  .name("microservice-waitlist")
  .description("Waitlist microservice — campaign management, referral tracking, priority scoring")
  .version("0.0.1");

program
  .command("migrate")
  .description("Run database migrations (creates waitlist.* schema)")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ waitlist schema migrations complete");
    } finally { await closeDb(); }
  });

program
  .command("serve")
  .description("Start the HTTP API server")
  .option("--port <n>", "Port", String(process.env["WAITLIST_PORT"] ?? "3015"))
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
      const schemas = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'waitlist'`;
      console.log("  Schema 'waitlist':", schemas.length > 0 ? "✓ exists" : "✗ missing (run migrate)");
      if (schemas.length > 0) {
        const [{ count }] = await sql`SELECT COUNT(*) as count FROM waitlist.campaigns`;
        console.log("  Campaigns:", count);
        const [{ entries }] = await sql`SELECT COUNT(*) as entries FROM waitlist.entries`;
        console.log("  Entries:", entries);
      }
    } catch (err) {
      console.error("✗ Connection failed:", err instanceof Error ? err.message : err);
      process.exit(1);
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
      console.log("✓ microservice-waitlist ready\n  Schema: waitlist.*\n  Next: microservice-waitlist serve --port 3015");
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
    console.log("\nmicroservice-waitlist doctor\n");
    check("DATABASE_URL", !!process.env["DATABASE_URL"], "set DATABASE_URL=postgres://...");
    if (process.env["DATABASE_URL"]) {
      const sql = getDb();
      try {
        const start = Date.now();
        await sql`SELECT 1`;
        check(`PostgreSQL reachable (${Date.now() - start}ms)`, true);
        const schemas = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'waitlist'`;
        check("Schema 'waitlist' exists", schemas.length > 0, "run: microservice-waitlist migrate");
        if (schemas.length > 0) {
          const [{ count }] = await sql`SELECT COUNT(*) as count FROM waitlist.campaigns`;
          console.log(`  ℹ Campaigns stored: ${count}`);
        }
      } catch (e) {
        check("PostgreSQL reachable", false, e instanceof Error ? e.message : String(e));
      } finally { await closeDb(); }
    }
    console.log(`\n${allOk ? "✓ All checks passed" : "✗ Some checks failed"}\n`);
    if (!allOk) process.exit(1);
  });

program
  .command("stats")
  .description("Show waitlist statistics for a campaign")
  .requiredOption("--campaign <id>", "Campaign UUID")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const stats = await getWaitlistStats(sql, opts.campaign);
      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }
      console.log(`\nWaitlist stats for campaign: ${opts.campaign}\n`);
      console.log(`  Total:   ${stats.total}`);
      console.log(`  Waiting: ${stats.waiting}`);
      console.log(`  Invited: ${stats.invited}`);
      console.log(`  Joined:  ${stats.joined}`);
      if (stats.top_referrers.length > 0) {
        console.log("\n  Top referrers:");
        for (const r of stats.top_referrers) {
          console.log(`    ${r.email}: ${r.referral_count} referrals`);
        }
      }
    } finally { await closeDb(); }
  });

program
  .command("invite-batch")
  .description("Invite the top N waiting entries by priority score")
  .requiredOption("--campaign <id>", "Campaign UUID")
  .requiredOption("--count <n>", "Number of entries to invite")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const count = parseInt(opts.count, 10);
      const invited = await inviteBatch(sql, opts.campaign, count);
      if (opts.json) {
        console.log(JSON.stringify({ data: invited, count: invited.length }, null, 2));
        return;
      }
      console.log(`✓ Invited ${invited.length} entries`);
      for (const e of invited) {
        console.log(`  ${e.email} (score: ${e.priority_score})`);
      }
    } finally { await closeDb(); }
  });

program
  .command("list")
  .description("List entries for a campaign")
  .requiredOption("--campaign <id>", "Campaign UUID")
  .option("--status <status>", "Filter by status: waiting|invited|joined|removed")
  .option("--limit <n>", "Max entries to return", "50")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const entries = await listEntries(sql, opts.campaign, opts.status, parseInt(opts.limit, 10));
      if (opts.json) {
        console.log(JSON.stringify({ data: entries, count: entries.length }, null, 2));
        return;
      }
      if (entries.length === 0) {
        console.log("No entries found.");
        return;
      }
      for (const e of entries) {
        const ts = e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at);
        console.log(`  [${ts}] [${e.status}] ${e.email}${e.name ? ` (${e.name})` : ""} score=${e.priority_score} refs=${e.referral_count}`);
      }
      console.log(`\nShowing ${entries.length} entries`);
    } finally { await closeDb(); }
  });

program.parse();
