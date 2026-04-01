#!/usr/bin/env bun
import { Command } from "commander";
import { closeDb, getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { indexDocument, listCollections } from "../lib/index_ops.js";
import { search } from "../lib/search_ops.js";

const program = new Command();

program
  .name("microservice-search")
  .description(
    "Search microservice — full-text, semantic (pgvector), and hybrid document search",
  )
  .version("0.0.1");

program
  .command("migrate")
  .description("Run database migrations (creates search.* schema)")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ search schema migrations complete");
    } finally {
      await closeDb();
    }
  });

program
  .command("serve")
  .description("Start the HTTP API server")
  .option("--port <n>", "Port", String(process.env.SEARCH_PORT ?? "3013"))
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
        await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'search'`;
      console.log(
        "  Schema 'search':",
        schemas.length > 0 ? "✓ exists" : "✗ missing (run migrate)",
      );
      if (schemas.length > 0) {
        const collections = await listCollections(sql);
        console.log("  Collections:", collections.length);
        for (const c of collections) {
          console.log(`    ${c.collection}: ${c.count} documents`);
        }
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
  .command("doctor")
  .description(
    "Check configuration, env vars, DB connectivity, and optional features",
  )
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

    console.log("\nmicroservice-search doctor\n");

    // Env vars
    check(
      "DATABASE_URL",
      !!process.env.DATABASE_URL,
      "set DATABASE_URL=postgres://...",
    );
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    check(
      `OPENAI_API_KEY (semantic search) — ${hasOpenAI ? "set" : "not set"}`,
      true, // Always pass — semantic is optional
    );

    if (process.env.DATABASE_URL) {
      const sql = getDb();
      try {
        const start = Date.now();
        await sql`SELECT 1`;
        check(`PostgreSQL reachable (${Date.now() - start}ms)`, true);

        const schemas =
          await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'search'`;
        check(
          "Schema 'search' exists",
          schemas.length > 0,
          "run: microservice-search migrate",
        );

        if (schemas.length > 0) {
          const tables =
            await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'search' ORDER BY table_name`;
          const names = tables.map((t: any) => t.table_name).join(", ");
          check(
            `Tables (${tables.length})`,
            tables.length >= 1,
            `found: ${names}`,
          );

          // Check pgvector
          try {
            const [{ has_vector }] = await sql<[{ has_vector: boolean }]>`
              SELECT EXISTS(
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'search' AND table_name = 'documents' AND column_name = 'embedding'
              ) AS has_vector
            `;
            check(
              "pgvector column (embedding)",
              has_vector,
              "run migrate, or install the vector extension",
            );
          } catch {
            check(
              "pgvector column (embedding)",
              false,
              "extension not available",
            );
          }
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

program
  .command("init")
  .description("Run migrations and confirm setup (one-step first-time init)")
  .requiredOption("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ microservice-search ready");
      console.log("  Schema: search.*");
      console.log("  Next: microservice-search serve --port 3013");
    } finally {
      await closeDb();
    }
  });

program
  .command("query")
  .description("Search indexed documents")
  .requiredOption("--text <query>", "Search query")
  .option("--collection <name>", "Limit to collection")
  .option("--mode <mode>", "Search mode: text|semantic|hybrid", "text")
  .option("--limit <n>", "Max results", "10")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      const results = await search(sql, {
        text: opts.text,
        collection: opts.collection,
        mode: opts.mode as "text" | "semantic" | "hybrid",
        limit: parseInt(opts.limit, 10),
      });
      if (opts.json) {
        console.log(
          JSON.stringify({ results, count: results.length }, null, 2),
        );
      } else {
        console.log(`Results (${results.length}):`);
        for (const r of results) {
          console.log(
            `  [${r.collection}] ${r.doc_id}  score=${r.score.toFixed(4)}`,
          );
          if (r.highlight) console.log(`    ${r.highlight}`);
        }
      }
    } finally {
      await closeDb();
    }
  });

program
  .command("index")
  .description("Index a document")
  .requiredOption("--collection <name>", "Collection name")
  .requiredOption("--doc-id <id>", "Document ID")
  .requiredOption("--content <text>", "Document content")
  .option("--workspace-id <uuid>", "Workspace UUID")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      await indexDocument(sql, {
        collection: opts.collection,
        docId: opts.docId,
        content: opts.content,
        workspaceId: opts.workspaceId,
      });
      console.log(
        `✓ Indexed document '${opts.docId}' in collection '${opts.collection}'`,
      );
    } finally {
      await closeDb();
    }
  });

program.parse();
