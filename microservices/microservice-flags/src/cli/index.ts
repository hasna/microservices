#!/usr/bin/env bun
import { Command } from "commander";
import { getDb, closeDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { listFlags, createFlag, getFlagByKey, updateFlag } from "../lib/flags.js";
import { evaluateFlag } from "../lib/evaluate.js";

const program = new Command();
program.name("microservice-flags").description("Flags microservice — feature flags, rollouts, A/B experiments").version("0.0.1");

program.command("migrate").description("Run migrations").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { await migrate(sql); console.log("✓ flags schema migrations complete"); } finally { await closeDb(); }
});
program.command("serve").option("--port <n>", "Port", String(process.env["FLAGS_PORT"] ?? "3007")).option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db; await startServer(parseInt(o.port, 10));
});
program.command("mcp").option("--db <url>").action(async o => { if (o.db) process.env["DATABASE_URL"] = o.db; await import("../mcp/index.js"); });
program.command("list").description("List all flags").option("--db <url>").option("--json", "Output as JSON").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { const flags = await listFlags(sql); if (o.json) { console.log(JSON.stringify(flags, null, 2)); } else { for (const f of flags) console.log(`  ${f.key.padEnd(30)} ${f.type.padEnd(10)} ${f.enabled ? "✓ on" : "✗ off"}  default: ${f.default_value}`); } } finally { await closeDb(); }
});
program.command("create").requiredOption("--key <k>").requiredOption("--name <n>").option("--type <t>", "boolean|string|number|json", "boolean").option("--default <v>", "Default value", "false").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { await migrate(sql); const f = await createFlag(sql, { key: o.key, name: o.name, type: o.type, defaultValue: o.default }); console.log("✓ Created:", f.id, f.key); } finally { await closeDb(); }
});
program.command("status").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { const [{ version }] = await sql`SELECT version()`; console.log("✓ PostgreSQL:", version.split(" ").slice(0,2).join(" ")); const s = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'flags'`; console.log("  Schema 'flags':", s.length > 0 ? "✓" : "✗ (run migrate)"); } catch (e) { console.error("✗", e instanceof Error ? e.message : e); process.exit(1); } finally { await closeDb(); }
});

program.command("toggle <key> <state>").description("Enable or disable a flag by key").option("--db <url>").action(async (key, state, o) => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb();
  try {
    const flag = await getFlagByKey(sql, key);
    if (!flag) { console.error(`✗ Flag '${key}' not found`); process.exit(1); }
    const enabled = state === "on";
    await updateFlag(sql, flag.id, { enabled });
    console.log(`✓ Flag '${key}' is now ${enabled ? "ON" : "OFF"}`);
  } finally { await closeDb(); }
});

program.command("evaluate <key>").description("Evaluate a flag for a given context").option("--user <id>", "User ID").option("--workspace <id>", "Workspace ID").option("--db <url>").action(async (key, o) => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb();
  try {
    const result = await evaluateFlag(sql, key, { userId: o.user, workspaceId: o.workspace });
    console.log(`${key} = "${result.value}" (source: ${result.source})`);
  } finally { await closeDb(); }
});

program.command("init").description("Run migrations and confirm setup").requiredOption("--db <url>").action(async o => {
  process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { await migrate(sql); console.log("✓ microservice-flags ready\n  Schema: flags.*\n  Next: microservice-flags serve --port 3007"); } finally { await closeDb(); }
});

program.command("doctor").description("Check configuration and DB connectivity").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  let allOk = true;
  const check = (label: string, pass: boolean, hint?: string) => { console.log(`  ${pass ? "✓" : "✗"} ${label}${!pass && hint ? `  →  ${hint}` : ""}`); if (!pass) allOk = false; };
  console.log("\nmicroservice-flags doctor\n");
  check("DATABASE_URL", !!process.env["DATABASE_URL"], "set DATABASE_URL=postgres://...");
  if (process.env["DATABASE_URL"]) {
    const sql = getDb();
    try {
      const start = Date.now(); await sql`SELECT 1`; check(`PostgreSQL reachable (${Date.now() - start}ms)`, true);
      const schemas = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'flags'`;
      check("Schema 'flags' exists", schemas.length > 0, "run: microservice-flags migrate");
      if (schemas.length > 0) {
        const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'flags' ORDER BY table_name`;
        check(`Tables (${tables.length})`, tables.length >= 4, tables.map((t: { table_name: string }) => t.table_name).join(", "));
      }
    } catch (e) { check("PostgreSQL reachable", false, e instanceof Error ? e.message : String(e)); }
    finally { await closeDb(); }
  }
  console.log(`\n${allOk ? "✓ All checks passed" : "✗ Some checks failed"}\n`);
  if (!allOk) process.exit(1);
});

program.parse();
