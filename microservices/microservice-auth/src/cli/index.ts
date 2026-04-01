#!/usr/bin/env bun
import { Command } from "commander";
import { closeDb, getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { cleanExpiredSessions } from "../lib/sessions.js";
import {
  countUsers,
  createUser,
  deleteUser,
  listUsers,
  updateUser,
} from "../lib/users.js";

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
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ auth schema migrations complete");
    } finally {
      await closeDb();
    }
  });

program
  .command("serve")
  .description("Start the HTTP API server")
  .option("--port <n>", "Port", String(process.env.AUTH_PORT ?? "3001"))
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    await startServer(parseInt(opts.port, 10));
  });

program
  .command("mcp")
  .description("Start the MCP server (stdio)")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
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
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const user = await createUser(sql, {
        email: opts.email,
        password: opts.password,
        name: opts.name,
      });
      console.log("✓ Created user:", user.id, user.email);
    } finally {
      await closeDb();
    }
  });

program
  .command("list-users")
  .description("List users")
  .option("--limit <n>", "Max results", "20")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      const [users, total] = await Promise.all([
        listUsers(sql, { limit: parseInt(opts.limit, 10) }),
        countUsers(sql),
      ]);
      if (opts.json) {
        console.log(JSON.stringify({ users, total }, null, 2));
      } else {
        console.log(`Users (${total} total):`);
        for (const u of users) {
          console.log(
            `  ${u.id}  ${u.email}  ${u.email_verified ? "✓ verified" : "unverified"}  ${u.name ?? ""}`,
          );
        }
      }
    } finally {
      await closeDb();
    }
  });

program
  .command("delete-user")
  .description("Delete a user by ID")
  .argument("<id>", "User ID")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (id, opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      const ok = await deleteUser(sql, id);
      console.log(ok ? `✓ Deleted user ${id}` : `✗ User ${id} not found`);
    } finally {
      await closeDb();
    }
  });

program
  .command("clean-sessions")
  .description("Remove expired sessions from the database")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      const n = await cleanExpiredSessions(sql);
      console.log(`✓ Cleaned ${n} expired sessions`);
    } finally {
      await closeDb();
    }
  });

program
  .command("status")
  .description("Show connection and schema status")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      const [{ version }] = await sql`SELECT version()`;
      console.log("✓ PostgreSQL:", version.split(" ").slice(0, 2).join(" "));
      const schemas =
        await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'auth'`;
      console.log(
        "  Schema 'auth':",
        schemas.length > 0 ? "✓ exists" : "✗ missing (run migrate)",
      );
      if (schemas.length > 0) {
        const [{ count }] = await sql`SELECT COUNT(*) as count FROM auth.users`;
        console.log("  Users:", count);
      }
    } catch (err) {
      console.error(
        "✗ Connection failed:",
        err instanceof Error ? err.message : err,
      );
      process.exit(1);
    } finally {
      await closeDb();
    }
  });

program
  .command("update-user")
  .description("Update a user's profile")
  .argument("<id>", "User ID")
  .option("--name <n>", "Display name")
  .option("--avatar-url <url>", "Avatar URL")
  .option("--verify-email", "Mark email as verified")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (id, opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      const updated = await updateUser(sql, id, {
        name: opts.name,
        avatar_url: opts.avatarUrl,
        email_verified: opts.verifyEmail ? true : undefined,
      });
      if (updated)
        console.log(
          "✓ Updated user:",
          updated.id,
          updated.email,
          updated.name ?? "",
        );
      else console.log("✗ User not found:", id);
    } finally {
      await closeDb();
    }
  });

program
  .command("init")
  .description("Run migrations and confirm setup (one-step first-time init)")
  .requiredOption("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ microservice-auth ready");
      console.log("  Schema: auth.*");
      console.log("  Next: microservice-auth serve --port 3001");
    } finally {
      await closeDb();
    }
  });

program
  .command("doctor")
  .description("Check configuration, env vars, and DB connectivity")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    let ok = true;
    const check = (label: string, pass: boolean, hint?: string) => {
      console.log(
        `  ${pass ? "✓" : "✗"} ${label}${!pass && hint ? `  →  ${hint}` : ""}`,
      );
      if (!pass) ok = false;
    };

    console.log("\nmicroservice-auth doctor\n");

    // Env vars
    check(
      "DATABASE_URL",
      !!process.env.DATABASE_URL,
      "set DATABASE_URL=postgres://...",
    );
    check(
      "JWT_SECRET",
      !!process.env.JWT_SECRET,
      "set JWT_SECRET=<at-least-32-chars>",
    );
    const hasOAuth = !!(
      process.env.GITHUB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
    );
    check("OAuth providers (optional)", hasOAuth || true); // always pass, just informational

    // DB connectivity
    if (process.env.DATABASE_URL) {
      const sql = getDb();
      try {
        const start = Date.now();
        await sql`SELECT 1`;
        check(`PostgreSQL reachable (${Date.now() - start}ms)`, true);
        const schemas =
          await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'auth'`;
        check(
          "Schema 'auth' exists",
          schemas.length > 0,
          "run: microservice-auth migrate",
        );
        if (schemas.length > 0) {
          const tables =
            await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'auth' ORDER BY table_name`;
          const names = tables.map((t: any) => t.table_name).join(", ");
          check(
            `Tables (${tables.length})`,
            tables.length >= 4,
            `found: ${names}`,
          );
        }
      } catch (e) {
        check(
          "PostgreSQL reachable",
          false,
          e instanceof Error ? e.message : String(e),
        );
      } finally {
        await closeDb();
      }
    }

    console.log(
      `\n${ok ? "✓ All checks passed" : "✗ Some checks failed — see above"}\n`,
    );
    if (!ok) process.exit(1);
  });

program.parse();
