#!/usr/bin/env bun
import { Command } from "commander";
import { getDb, closeDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { storeMemory, searchMemories, listMemories } from "../lib/memories.js";
import { hasEmbeddingKey } from "../lib/embeddings.js";

const program = new Command();

program
  .name("microservice-memory")
  .description("Memory microservice — semantic recall, vector search, collections")
  .version("0.0.1");

program
  .command("migrate")
  .description("Run database migrations (creates memory.* schema)")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ memory schema migrations complete");
    } finally { await closeDb(); }
  });

program
  .command("serve")
  .description("Start the HTTP API server")
  .option("--port <n>", "Port", String(process.env["MEMORY_PORT"] ?? "3012"))
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
      const schemas = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'memory'`;
      console.log("  Schema 'memory':", schemas.length > 0 ? "✓ exists" : "✗ missing (run migrate)");
      if (schemas.length > 0) {
        const [{ count }] = await sql`SELECT COUNT(*) as count FROM memory.memories`;
        console.log("  Memories:", count);
        const [{ count: colCount }] = await sql`SELECT COUNT(*) as count FROM memory.collections`;
        console.log("  Collections:", colCount);
      }
    } catch (err) {
      console.error("✗ Connection failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    } finally { await closeDb(); }
  });

program
  .command("doctor")
  .description("Check configuration, env vars, pgvector availability, and DB connectivity")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    let ok = true;
    const check = (label: string, pass: boolean, hint?: string) => {
      console.log(`  ${pass ? "✓" : "✗"} ${label}${!pass && hint ? `  →  ${hint}` : ""}`);
      if (!pass) ok = false;
    };

    console.log("\nmicroservice-memory doctor\n");

    check("DATABASE_URL", !!process.env["DATABASE_URL"], "set DATABASE_URL=postgres://...");
    check("OPENAI_API_KEY (optional, enables semantic search)", hasEmbeddingKey() || true);
    if (hasEmbeddingKey()) {
      console.log("  ✓ OPENAI_API_KEY set — semantic search enabled");
    } else {
      console.log("  ℹ OPENAI_API_KEY not set — using full-text search only");
    }

    if (process.env["DATABASE_URL"]) {
      const sql = getDb();
      try {
        const start = Date.now();
        await sql`SELECT 1`;
        check(`PostgreSQL reachable (${Date.now() - start}ms)`, true);

        const schemas = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'memory'`;
        check("Schema 'memory' exists", schemas.length > 0, "run: microservice-memory migrate");

        // Check pgvector
        try {
          await sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
          const [pgvRow] = await sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
          check("pgvector extension", !!pgvRow, "install pgvector for semantic search");
        } catch {
          check("pgvector extension", false, "install pgvector for semantic search");
        }

        if (schemas.length > 0) {
          const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'memory' ORDER BY table_name`;
          const names = tables.map((t: { table_name: string }) => t.table_name).join(", ");
          check(`Tables (${tables.length})`, tables.length >= 2, `found: ${names}`);

          // Check embedding column
          const [embCol] = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'memory' AND table_name = 'memories' AND column_name = 'embedding'`;
          check("Vector embedding column", !!embCol, "pgvector not available during migration");
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
      console.log("✓ microservice-memory ready");
      console.log("  Schema: memory.*");
      console.log("  Next: microservice-memory serve --port 3012");
    } finally { await closeDb(); }
  });

program
  .command("store")
  .description("Store a memory")
  .requiredOption("--workspace <id>", "Workspace ID")
  .requiredOption("--content <text>", "Memory content")
  .option("--user <id>", "User ID")
  .option("--importance <n>", "Importance score (0.0-1.0)", "0.5")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const mem = await storeMemory(sql, {
        workspaceId: opts.workspace,
        userId: opts.user,
        content: opts.content,
        importance: parseFloat(opts.importance),
      });
      console.log("✓ Stored memory:", mem.id);
      console.log("  Content:", mem.content.slice(0, 80) + (mem.content.length > 80 ? "..." : ""));
    } finally { await closeDb(); }
  });

program
  .command("search")
  .description("Search memories")
  .requiredOption("--workspace <id>", "Workspace ID")
  .requiredOption("--query <text>", "Search query")
  .option("--user <id>", "User ID")
  .option("--limit <n>", "Max results", "10")
  .option("--mode <m>", "Search mode: text|semantic|hybrid", "text")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const sql = getDb();
    try {
      const results = await searchMemories(sql, {
        workspaceId: opts.workspace,
        userId: opts.user,
        text: opts.query,
        mode: opts.mode as "semantic" | "text" | "hybrid",
        limit: parseInt(opts.limit, 10),
      });
      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        console.log(`Found ${results.length} memories:`);
        for (const m of results) {
          console.log(`  [${m.id}] (importance: ${m.importance}) ${m.content.slice(0, 100)}`);
        }
      }
    } finally { await closeDb(); }
  });

program.parse();
