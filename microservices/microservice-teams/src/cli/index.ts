#!/usr/bin/env bun
import { Command } from "commander";
import { getDb, closeDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { createWorkspace, listUserWorkspaces, deleteWorkspace } from "../lib/workspaces.js";
import { listMembers } from "../lib/members.js";

const program = new Command();
program.name("microservice-teams").description("Teams microservice — workspaces, RBAC, invites").version("0.0.1");

program.command("migrate").description("Run migrations").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { await migrate(sql); console.log("✓ teams schema migrations complete"); } finally { await closeDb(); }
});

program.command("serve").description("Start HTTP server").option("--port <n>", "Port", String(process.env["TEAMS_PORT"] ?? "3002")).option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db; await startServer(parseInt(o.port, 10));
});

program.command("mcp").description("Start MCP server").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db; await import("../mcp/index.js");
});

program.command("create-workspace").description("Create a workspace").requiredOption("--name <n>").requiredOption("--owner <id>").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { await migrate(sql); const ws = await createWorkspace(sql, { name: o.name, ownerId: o.owner }); console.log("✓ Created:", ws.id, ws.name, ws.slug); } finally { await closeDb(); }
});

program.command("list-workspaces").description("List workspaces for a user").requiredOption("--user <id>").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { const wss = await listUserWorkspaces(sql, o.user); for (const w of wss) console.log(`  ${w.id}  ${w.slug}  ${w.name}`); } finally { await closeDb(); }
});

program.command("list-members").description("List members of a workspace").argument("<workspace-id>").option("--db <url>").action(async (id, o) => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { const ms = await listMembers(sql, id); for (const m of ms) console.log(`  ${m.user_id}  ${m.role}`); } finally { await closeDb(); }
});

program.command("status").description("Connection status").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { const [{ version }] = await sql`SELECT version()`; console.log("✓ PostgreSQL:", version.split(" ").slice(0,2).join(" ")); const s = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'teams'`; console.log("  Schema 'teams':", s.length > 0 ? "✓" : "✗ (run migrate)"); } finally { await closeDb(); }
});

program.parse();
