#!/usr/bin/env bun
import { Command } from "commander";
import { getDb, closeDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { createUser, listUsers, deleteUser, countUsers } from "../lib/users.js";
import { cleanExpiredSessions } from "../lib/sessions.js";

const program = new Command();

program
  .name("microservice-auth")
  .description("Auth microservice — users, sessions, JWT, OAuth, 2FA, API keys")
  .version("0.0.1");

program
  .command("migrate")
  .description("Run database migrations (creates auth.* schema)")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ auth schema migrations complete");
    } finally { await closeDb(); }
  });

program
  .command("serve")
  .description("Start the HTTP API server")
  .option("--port <n>", "Port", String(process.env["AUTH_PORT"] ?? "3001"))
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
  .command("create-user")
  .description("Create a new user")
  .requiredOption("--email <email>", "User email")
  .option("--password <password>", "User password")
  .option("--name <name>", "User display name")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const user = await createUser(sql, { email: opts.email, password: opts.password, name: opts.name });
      console.log("✓ Created user:", user.id, user.email);
    } finally { await closeDb(); }
  });

program
  .command("list-users")
  .description("List users")
  .option("--limit <n>", "Max results", "20")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      const [users, total] = await Promise.all([
        listUsers(sql, { limit: parseInt(opts.limit, 10) }),
        countUsers(sql),
      ]);
      console.log(`Users (${total} total):`);
      for (const u of users) {
        console.log(`  ${u.id}  ${u.email}  ${u.email_verified ? "✓ verified" : "unverified"}  ${u.name ?? ""}`);
      }
    } finally { await closeDb(); }
  });

program
  .command("delete-user")
  .description("Delete a user by ID")
  .argument("<id>", "User ID")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (id, opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      const ok = await deleteUser(sql, id);
      console.log(ok ? `✓ Deleted user ${id}` : `✗ User ${id} not found`);
    } finally { await closeDb(); }
  });

program
  .command("clean-sessions")
  .description("Remove expired sessions from the database")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      const n = await cleanExpiredSessions(sql);
      console.log(`✓ Cleaned ${n} expired sessions`);
    } finally { await closeDb(); }
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
      const schemas = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'auth'`;
      console.log("  Schema 'auth':", schemas.length > 0 ? "✓ exists" : "✗ missing (run migrate)");
      if (schemas.length > 0) {
        const [{ count }] = await sql`SELECT COUNT(*) as count FROM auth.users`;
        console.log("  Users:", count);
      }
    } catch (err) {
      console.error("✗ Connection failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    } finally { await closeDb(); }
  });

program.parse();
