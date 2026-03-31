#!/usr/bin/env bun
import { Command } from "commander";
import { getDb, closeDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { listFlags, createFlag } from "../lib/flags.js";

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
program.command("list").description("List all flags").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { const flags = await listFlags(sql); for (const f of flags) console.log(`  ${f.key.padEnd(30)} ${f.type.padEnd(10)} ${f.enabled ? "✓ on" : "✗ off"}  default: ${f.default_value}`); } finally { await closeDb(); }
});
program.command("create").requiredOption("--key <k>").requiredOption("--name <n>").option("--type <t>", "boolean|string|number|json", "boolean").option("--default <v>", "Default value", "false").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { await migrate(sql); const f = await createFlag(sql, { key: o.key, name: o.name, type: o.type, defaultValue: o.default }); console.log("✓ Created:", f.id, f.key); } finally { await closeDb(); }
});
program.command("status").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { const [{ version }] = await sql`SELECT version()`; console.log("✓ PostgreSQL:", version.split(" ").slice(0,2).join(" ")); const s = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'flags'`; console.log("  Schema 'flags':", s.length > 0 ? "✓" : "✗ (run migrate)"); } catch (e) { console.error("✗", e instanceof Error ? e.message : e); process.exit(1); } finally { await closeDb(); }
});

program.parse();
