#!/usr/bin/env bun
import { Command } from "commander";
import { getDb, closeDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { listPlans } from "../lib/plans.js";
import { listSubscriptions, getSubscription, cancelSubscription } from "../lib/subscriptions.js";

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

program.command("list-plans").description("List billing plans").option("--db <url>").option("--active", "Only active plans").option("--json", "Output as JSON").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try {
    const plans = await listPlans(sql, { activeOnly: Boolean(o.active) });
    if (o.json) { console.log(JSON.stringify(plans, null, 2)); return; }
    if (plans.length === 0) { console.log("No plans found"); return; }
    for (const p of plans) console.log(`  ${p.id}  ${p.name}  ${p.amount_cents / 100} ${p.currency.toUpperCase()}/${p.interval}  active=${p.active}`);
  } finally { await closeDb(); }
});

program.command("list-subscriptions").description("List subscriptions").option("--db <url>").option("--workspace <id>", "Filter by workspace").option("--status <s>", "Filter by status").option("--json", "Output as JSON").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try {
    const subs = await listSubscriptions(sql, { workspaceId: o.workspace, status: o.status as any });
    if (o.json) { console.log(JSON.stringify(subs, null, 2)); return; }
    if (subs.length === 0) { console.log("No subscriptions found"); return; }
    for (const s of subs) console.log(`  ${s.id}  workspace=${s.workspace_id}  status=${s.status}  plan=${s.plan_id}`);
  } finally { await closeDb(); }
});

program.command("cancel-subscription").description("Cancel a subscription").argument("<subscription-id>", "Subscription ID to cancel").option("--immediately", "Cancel immediately instead of at period end").option("--db <url>").action(async (subscriptionId, o) => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try {
    const sub = await getSubscription(sql, subscriptionId);
    if (!sub) { console.error(`Subscription not found: ${subscriptionId}`); process.exit(1); }
    const stripeSecretKey = process.env["STRIPE_SECRET_KEY"];
    if (stripeSecretKey && sub.stripe_subscription_id) {
      if (o.immediately) {
        await fetch(`https://api.stripe.com/v1/subscriptions/${sub.stripe_subscription_id}`, {
          method: "DELETE",
          headers: { "Authorization": `Bearer ${stripeSecretKey}` },
        });
      } else {
        const params = new URLSearchParams({ cancel_at_period_end: "true" });
        await fetch(`https://api.stripe.com/v1/subscriptions/${sub.stripe_subscription_id}`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${stripeSecretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
      }
    }
    const updated = await cancelSubscription(sql, subscriptionId, !o.immediately);
    console.log(`✓ Subscription ${subscriptionId} canceled  status=${updated?.status}  cancel_at_period_end=${updated?.cancel_at_period_end}`);
  } finally { await closeDb(); }
});

program.parse();

program.command("init").description("Run migrations and confirm setup").requiredOption("--db <url>").action(async o => {
  process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { await migrate(sql); console.log("✓ microservice-billing ready\n  Schema: billing.*\n  Requires: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET\n  Next: microservice-billing serve --port 3003"); } finally { await closeDb(); }
});

program.command("doctor").description("Check configuration and DB connectivity").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  let allOk = true;
  const check = (label: string, pass: boolean, hint?: string) => { console.log(`  ${pass ? "✓" : "✗"} ${label}${!pass && hint ? `  →  ${hint}` : ""}`); if (!pass) allOk = false; };
  console.log("\nmicroservice-billing doctor\n");
  check("DATABASE_URL", !!process.env["DATABASE_URL"], "set DATABASE_URL=postgres://...");
  check("STRIPE_SECRET_KEY", !!process.env["STRIPE_SECRET_KEY"], "set STRIPE_SECRET_KEY=sk_...");
  check("STRIPE_WEBHOOK_SECRET", !!process.env["STRIPE_WEBHOOK_SECRET"], "set STRIPE_WEBHOOK_SECRET=whsec_...");
  if (process.env["DATABASE_URL"]) {
    const sql = getDb();
    try {
      const start = Date.now(); await sql`SELECT 1`; check(`PostgreSQL reachable (${Date.now() - start}ms)`, true);
      const schemas = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'billing'`;
      check("Schema 'billing' exists", schemas.length > 0, "run: microservice-billing migrate");
    } catch (e) { check("PostgreSQL reachable", false, e instanceof Error ? e.message : String(e)); }
    finally { await closeDb(); }
  }
  console.log(`\n${allOk ? "✓ All checks passed" : "✗ Some checks failed"}\n`);
  if (!allOk) process.exit(1);
});
