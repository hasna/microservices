#!/usr/bin/env bun
import { Command } from "commander";
import { getDb, closeDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { listConversations, getConversation } from "../lib/conversations.js";
import { getMessages } from "../lib/messages.js";
import { searchMessages } from "../lib/messages.js";
import { exportConversation } from "../lib/export.js";

const program = new Command();

program
  .name("microservice-sessions")
  .description("Sessions microservice — conversations, messages, context windows, search, export")
  .version("0.0.1");

program
  .command("migrate")
  .description("Run database migrations (creates sessions.* schema)")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ sessions schema migrations complete");
    } finally { await closeDb(); }
  });

program
  .command("serve")
  .description("Start the HTTP API server")
  .option("--port <n>", "Port", String(process.env["SESSIONS_PORT"] ?? "3016"))
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
      const schemas = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'sessions'`;
      console.log("  Schema 'sessions':", schemas.length > 0 ? "✓ exists" : "✗ missing (run migrate)");
      if (schemas.length > 0) {
        const [{ count: convCount }] = await sql`SELECT COUNT(*) as count FROM sessions.conversations`;
        const [{ count: msgCount }] = await sql`SELECT COUNT(*) as count FROM sessions.messages`;
        console.log("  Conversations:", convCount);
        console.log("  Messages:", msgCount);
      }
    } catch (err) {
      console.error("✗ Connection failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    } finally { await closeDb(); }
  });

program
  .command("doctor")
  .description("Check configuration, env vars, and DB connectivity")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    let ok = true;
    const check = (label: string, pass: boolean, hint?: string) => {
      console.log(`  ${pass ? "✓" : "✗"} ${label}${!pass && hint ? `  →  ${hint}` : ""}`);
      if (!pass) ok = false;
    };

    console.log("\nmicroservice-sessions doctor\n");

    // Env vars
    check("DATABASE_URL", !!process.env["DATABASE_URL"], "set DATABASE_URL=postgres://...");

    // DB connectivity
    if (process.env["DATABASE_URL"]) {
      const sql = getDb();
      try {
        const start = Date.now();
        await sql`SELECT 1`;
        check(`PostgreSQL reachable (${Date.now() - start}ms)`, true);
        const schemas = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'sessions'`;
        check("Schema 'sessions' exists", schemas.length > 0, "run: microservice-sessions migrate");
        if (schemas.length > 0) {
          const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'sessions' ORDER BY table_name`;
          const names = tables.map((t: { table_name: string }) => t.table_name).join(", ");
          check(`Tables (${tables.length})`, tables.length >= 2, `found: ${names}`);
        }
      } catch (e) {
        check("PostgreSQL reachable", false, e instanceof Error ? e.message : String(e));
      } finally { await closeDb(); }
    }

    console.log(`\n${ok ? "✓ All checks passed" : "✗ Some checks failed — see above"}\n`);
    if (!ok) process.exit(1);
  });

program
  .command("init")
  .description("Run migrations and confirm setup (one-step first-time init)")
  .requiredOption("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ microservice-sessions ready");
      console.log("  Schema: sessions.*");
      console.log("  Next: microservice-sessions serve --port 3016");
    } finally { await closeDb(); }
  });

program
  .command("list")
  .description("List conversations")
  .requiredOption("--workspace <id>", "Workspace ID")
  .requiredOption("--user <id>", "User ID")
  .option("--archived", "Show archived conversations")
  .option("--limit <n>", "Max results", "20")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const convs = await listConversations(sql, opts.workspace, opts.user, {
        archived: opts.archived ?? false,
        limit: parseInt(opts.limit, 10),
      });
      if (opts.json) {
        console.log(JSON.stringify({ conversations: convs, count: convs.length }, null, 2));
      } else {
        console.log(`Conversations (${convs.length}):`);
        for (const c of convs) {
          const flags = [c.is_archived ? "archived" : null, c.is_pinned ? "pinned" : null].filter(Boolean).join(", ");
          console.log(`  ${c.id}  ${c.title ?? "(untitled)"}  msgs:${c.message_count}  tokens:${c.total_tokens}${flags ? `  [${flags}]` : ""}`);
        }
      }
    } finally { await closeDb(); }
  });

program
  .command("show")
  .description("Show a conversation and its messages")
  .argument("<id>", "Conversation ID")
  .option("--limit <n>", "Max messages", "50")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (id, opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const conv = await getConversation(sql, id);
      if (!conv) {
        console.error("✗ Conversation not found:", id);
        process.exit(1);
      }
      const msgs = await getMessages(sql, id, { limit: parseInt(opts.limit, 10) });
      if (opts.json) {
        console.log(JSON.stringify({ conversation: conv, messages: msgs }, null, 2));
      } else {
        console.log(`# ${conv.title ?? "Untitled"} (${conv.message_count} messages, ${conv.total_tokens} tokens)\n`);
        for (const m of msgs) {
          const label = m.role.charAt(0).toUpperCase() + m.role.slice(1);
          console.log(`[${label}]: ${m.content.slice(0, 200)}${m.content.length > 200 ? "..." : ""}\n`);
        }
      }
    } finally { await closeDb(); }
  });

program
  .command("export")
  .description("Export a conversation")
  .argument("<id>", "Conversation ID")
  .option("--format <fmt>", "Export format: markdown or json", "markdown")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (id, opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const output = await exportConversation(sql, id, opts.format as "markdown" | "json");
      console.log(output);
    } finally { await closeDb(); }
  });

program
  .command("search")
  .description("Search messages across conversations")
  .requiredOption("--workspace <id>", "Workspace ID")
  .requiredOption("--query <q>", "Search query")
  .option("--limit <n>", "Max results", "20")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const msgs = await searchMessages(sql, opts.workspace, opts.query, {
        limit: parseInt(opts.limit, 10),
      });
      if (opts.json) {
        console.log(JSON.stringify({ messages: msgs, count: msgs.length }, null, 2));
      } else {
        console.log(`Search results for "${opts.query}" (${msgs.length}):`);
        for (const m of msgs) {
          console.log(`  [${m.role}] ${m.content.slice(0, 120)}${m.content.length > 120 ? "..." : ""}  (conv: ${m.conversation_id})`);
        }
      }
    } finally { await closeDb(); }
  });

program.parse();
