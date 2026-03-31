#!/usr/bin/env bun
import { Command } from "commander";
import { getDb, closeDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { createWorkspace, listUserWorkspaces, deleteWorkspace } from "../lib/workspaces.js";
import { listMembers, removeMember, getMember } from "../lib/members.js";
import { createInvite } from "../lib/invites.js";

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

program.command("list-workspaces").description("List workspaces for a user").requiredOption("--user <id>").option("--json", "Output as JSON").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { const wss = await listUserWorkspaces(sql, o.user); if (o.json) { console.log(JSON.stringify(wss, null, 2)); } else { for (const w of wss) console.log(`  ${w.id}  ${w.slug}  ${w.name}`); } } finally { await closeDb(); }
});

program.command("list-members").description("List members of a workspace").argument("<workspace-id>").option("--json", "Output as JSON").option("--db <url>").action(async (id, o) => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { const ms = await listMembers(sql, id); if (o.json) { console.log(JSON.stringify(ms, null, 2)); } else { for (const m of ms) console.log(`  ${m.user_id}  ${m.role}`); } } finally { await closeDb(); }
});

program.command("status").description("Connection status").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { const [{ version }] = await sql`SELECT version()`; console.log("✓ PostgreSQL:", version.split(" ").slice(0,2).join(" ")); const s = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'teams'`; console.log("  Schema 'teams':", s.length > 0 ? "✓" : "✗ (run migrate)"); } finally { await closeDb(); }
});

program.command("init").description("Run migrations and confirm setup").requiredOption("--db <url>").action(async o => {
  process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { await migrate(sql); console.log("✓ microservice-teams ready\n  Schema: teams.*\n  Next: microservice-teams serve --port 3002"); } finally { await closeDb(); }
});

program.command("doctor").description("Check configuration and DB connectivity").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  let allOk = true;
  const check = (label: string, pass: boolean, hint?: string) => { console.log(`  ${pass ? "✓" : "✗"} ${label}${!pass && hint ? `  →  ${hint}` : ""}`); if (!pass) allOk = false; };
  console.log("\nmicroservice-teams doctor\n");
  check("DATABASE_URL", !!process.env["DATABASE_URL"], "set DATABASE_URL=postgres://...");
  if (process.env["DATABASE_URL"]) {
    const sql = getDb();
    try {
      const start = Date.now(); await sql`SELECT 1`; check(`PostgreSQL reachable (${Date.now() - start}ms)`, true);
      const schemas = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'teams'`;
      check("Schema 'teams' exists", schemas.length > 0, "run: microservice-teams migrate");
      if (schemas.length > 0) {
        const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'teams' ORDER BY table_name`;
        check(`Tables (${tables.length})`, tables.length >= 3, tables.map((t: { table_name: string }) => t.table_name).join(", "));
      }
    } catch (e) { check("PostgreSQL reachable", false, e instanceof Error ? e.message : String(e)); }
    finally { await closeDb(); }
  }
  console.log(`\n${allOk ? "✓ All checks passed" : "✗ Some checks failed"}\n`);
  if (!allOk) process.exit(1);
});

program.command("leave-workspace").description("Leave a workspace (non-owners only)").requiredOption("--workspace <id>").requiredOption("--user <id>").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb();
  try {
    await migrate(sql);
    const member = await getMember(sql, o.workspace, o.user);
    if (!member) { console.error("✗ Member not found"); process.exit(1); }
    if (member.role === "owner") { console.error("✗ Owners cannot leave — transfer ownership first"); process.exit(1); }
    await removeMember(sql, o.workspace, o.user);
    console.log("✓ Left workspace", o.workspace);
  } finally { await closeDb(); }
});

program.command("invite").description("Invite a user by email to a workspace").requiredOption("--workspace <id>").requiredOption("--email <email>").option("--role <role>", "Role: admin|member|viewer", "member").requiredOption("--invited-by <id>").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb();
  try {
    await migrate(sql);
    const invite = await createInvite(sql, { workspaceId: o.workspace, email: o.email, role: o.role as any, invitedBy: o.invitedBy });
    console.log("✓ Invited:", invite.email, "token:", invite.token);
  } finally { await closeDb(); }
});

program.parse();
