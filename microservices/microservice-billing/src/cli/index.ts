#!/usr/bin/env bun
import { Command } from "commander";
import { getDb, closeDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { listPlans } from "../lib/plans.js";
import { listSubscriptions } from "../lib/subscriptions.js";

const program = new Command();
program.name("microservice-billing").description("Billing microservice — plans, subscriptions, invoices, Stripe").version("0.0.1");

program.command("migrate").description("Run database migrations").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { await migrate(sql); console.log("✓ billing schema migrations complete"); } finally { await closeDb(); }
});

program.command("serve").description("Start HTTP server").option("--port <n>", "Port", String(process.env["BILLING_PORT"] ?? "3003")).option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db; await startServer(parseInt(o.port, 10));
});

program.command("mcp").description("Start MCP server").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db; await import("../mcp/index.js");
});

program.command("status").description("Connection and schema status").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try {
    const [{ version }] = await sql`SELECT version()`;
    console.log("✓ PostgreSQL:", version.split(" ").slice(0, 2).join(" "));
    const s = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'billing'`;
    console.log("  Schema 'billing':", s.length > 0 ? "✓" : "✗ (run migrate)");
  } finally { await closeDb(); }
});

program.command("list-plans").description("List billing plans").option("--db <url>").option("--active", "Only active plans").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try {
    const plans = await listPlans(sql, { activeOnly: Boolean(o.active) });
    if (plans.length === 0) { console.log("No plans found"); return; }
    for (const p of plans) console.log(`  ${p.id}  ${p.name}  ${p.amount_cents / 100} ${p.currency.toUpperCase()}/${p.interval}  active=${p.active}`);
  } finally { await closeDb(); }
});

program.command("list-subscriptions").description("List subscriptions").option("--db <url>").option("--workspace <id>", "Filter by workspace").option("--status <s>", "Filter by status").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try {
    const subs = await listSubscriptions(sql, { workspaceId: o.workspace, status: o.status as any });
    if (subs.length === 0) { console.log("No subscriptions found"); return; }
    for (const s of subs) console.log(`  ${s.id}  workspace=${s.workspace_id}  status=${s.status}  plan=${s.plan_id}`);
  } finally { await closeDb(); }
});

program.parse();
