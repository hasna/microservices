#!/usr/bin/env bun
import * as fs from "node:fs";
import { Command } from "commander";
import { closeDb, getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { listCollections } from "../lib/collections.js";
import { hasEmbeddingKey } from "../lib/embeddings.js";
import { ingestDocument } from "../lib/ingest.js";
import { retrieve } from "../lib/retrieve.js";
import { getCollectionStats } from "../lib/stats.js";

const program = new Command();

program
  .name("microservice-knowledge")
  .description(
    "Knowledge microservice — RAG collections, document ingestion, chunking, retrieval",
  )
  .version("0.0.1");

program
  .command("migrate")
  .description("Run database migrations (creates knowledge.* schema)")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ knowledge schema migrations complete");
    } finally {
      await closeDb();
    }
  });

program
  .command("serve")
  .description("Start the HTTP API server")
  .option("--port <n>", "Port", String(process.env.KNOWLEDGE_PORT ?? "3018"))
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
  .command("doctor")
  .description(
    "Check configuration, env vars, pgvector availability, and DB connectivity",
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

    console.log("\nmicroservice-knowledge doctor\n");

    check(
      "DATABASE_URL",
      !!process.env.DATABASE_URL,
      "set DATABASE_URL=postgres://...",
    );
    if (hasEmbeddingKey()) {
      console.log("  ✓ OPENAI_API_KEY set — semantic search enabled");
    } else {
      console.log("  ℹ OPENAI_API_KEY not set — using full-text search only");
    }

    if (process.env.DATABASE_URL) {
      const sql = getDb();
      try {
        const start = Date.now();
        await sql`SELECT 1`;
        check(`PostgreSQL reachable (${Date.now() - start}ms)`, true);

        const schemas =
          await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'knowledge'`;
        check(
          "Schema 'knowledge' exists",
          schemas.length > 0,
          "run: microservice-knowledge migrate",
        );

        // Check pgvector
        try {
          const [pgvRow] =
            await sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
          check(
            "pgvector extension",
            !!pgvRow,
            "install pgvector for semantic search",
          );
        } catch {
          check(
            "pgvector extension",
            false,
            "install pgvector for semantic search",
          );
        }

        if (schemas.length > 0) {
          const tables =
            await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'knowledge' ORDER BY table_name`;
          const names = tables.map((t: any) => t.table_name).join(", ");
          check(
            `Tables (${tables.length})`,
            tables.length >= 3,
            `found: ${names}`,
          );

          // Check embedding column
          const [embCol] =
            await sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'knowledge' AND table_name = 'chunks' AND column_name = 'embedding'`;
          check(
            "Vector embedding column",
            !!embCol,
            "pgvector not available during migration",
          );

          // Show counts
          const [{ count: docCount }] =
            await sql`SELECT COUNT(*) as count FROM knowledge.documents`;
          const [{ count: chunkCount }] =
            await sql`SELECT COUNT(*) as count FROM knowledge.chunks`;
          const [{ count: colCount }] =
            await sql`SELECT COUNT(*) as count FROM knowledge.collections`;
          console.log(
            `  Collections: ${colCount}, Documents: ${docCount}, Chunks: ${chunkCount}`,
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

program
  .command("init")
  .description("Run migrations and confirm setup (one-step first-time init)")
  .requiredOption("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ microservice-knowledge ready");
      console.log("  Schema: knowledge.*");
      console.log("  Next: microservice-knowledge serve --port 3018");
    } finally {
      await closeDb();
    }
  });

program
  .command("list-collections")
  .description("List all collections in a workspace")
  .requiredOption("--workspace <id>", "Workspace ID")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const cols = await listCollections(sql, opts.workspace);
      if (opts.json) {
        console.log(JSON.stringify(cols, null, 2));
      } else {
        if (cols.length === 0) {
          console.log("No collections found.");
        } else {
          console.log(`Found ${cols.length} collection(s):`);
          for (const c of cols) {
            console.log(
              `  [${c.id}] ${c.name} — ${c.document_count} docs, ${c.chunk_count} chunks (${c.chunking_strategy})`,
            );
          }
        }
      }
    } finally {
      await closeDb();
    }
  });

program
  .command("ingest")
  .description("Ingest a document into a collection")
  .requiredOption("--collection <id>", "Collection ID")
  .requiredOption("--title <text>", "Document title")
  .option("--content <text>", "Document content (or use --file)")
  .option("--file <path>", "Read content from file")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;

    let content = opts.content;
    if (opts.file) {
      content = fs.readFileSync(opts.file, "utf-8");
    }
    if (!content) {
      console.error("Error: --content or --file is required");
      process.exit(1);
    }

    const sql = getDb();
    try {
      await migrate(sql);
      const doc = await ingestDocument(sql, opts.collection, {
        title: opts.title,
        content,
        sourceType: opts.file ? "file" : "text",
      });
      console.log(`✓ Ingested document: ${doc.id}`);
      console.log(`  Title: ${doc.title}`);
      console.log(`  Chunks: ${doc.chunk_count}`);
      console.log(`  Status: ${doc.status}`);
    } finally {
      await closeDb();
    }
  });

program
  .command("query")
  .description("Query a collection for relevant chunks")
  .requiredOption("--collection <id>", "Collection ID")
  .requiredOption("--text <query>", "Search query")
  .option("--mode <m>", "Search mode: text|semantic|hybrid", "text")
  .option("--limit <n>", "Max results", "5")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const results = await retrieve(sql, opts.collection, opts.text, {
        mode: opts.mode as "semantic" | "text" | "hybrid",
        limit: parseInt(opts.limit, 10),
      });
      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (results.length === 0) {
          console.log("No results found.");
        } else {
          console.log(`Found ${results.length} result(s):`);
          for (const r of results) {
            console.log(
              `  [score: ${r.score.toFixed(4)}] (${r.document.title}) ${r.chunk.content.slice(0, 120)}...`,
            );
          }
        }
      }
    } finally {
      await closeDb();
    }
  });

program
  .command("stats")
  .description("Show statistics for a collection")
  .requiredOption("--collection <id>", "Collection ID")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const stats = await getCollectionStats(sql, opts.collection);
      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log(`Collection: ${stats.collection_id}`);
        console.log(`  Documents: ${stats.document_count}`);
        console.log(`  Chunks: ${stats.chunk_count}`);
        console.log(`  Avg chunks/doc: ${stats.avg_chunks_per_doc}`);
        console.log(`  Total tokens: ${stats.total_tokens}`);
      }
    } finally {
      await closeDb();
    }
  });

program.parse();
