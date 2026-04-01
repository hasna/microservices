#!/usr/bin/env bun
/**
 * CLI for microservice-__name__.
 * Binary: microservice-__name__
 *
 * Commands:
 *   microservice-__name__ migrate          — run database migrations
 *   microservice-__name__ serve [--port N] — start HTTP server
 *   microservice-__name__ mcp              — start MCP server
 *   microservice-__name__ status           — show connection + schema status
 */

import { Command } from "commander";
import { closeDb, getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";

const program = new Command();

program
  .name("microservice-__name__")
  .description("__Name__ microservice — part of @hasna/microservices")
  .version("0.0.1");

program
  .command("migrate")
  .description("Run database migrations")
  .option("--db <url>", "PostgreSQL connection URL (overrides DATABASE_URL)")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ Migrations complete");
    } finally {
      await closeDb();
    }
  });

program
  .command("serve")
  .description("Start the HTTP API server")
  .option(
    "--port <n>",
    "Port to listen on",
    String(process.env.__NAME___PORT ?? "3000"),
  )
  .option("--db <url>", "PostgreSQL connection URL (overrides DATABASE_URL)")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    await startServer(parseInt(opts.port, 10));
  });

program
  .command("mcp")
  .description("Start the MCP server (stdio)")
  .option("--db <url>", "PostgreSQL connection URL (overrides DATABASE_URL)")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const mcp = await import("../mcp/index.js");
    // @ts-expect-error
    const main = mcp.default || mcp.main || mcp;
    if (typeof main === "function") await main();
  });

program
  .command("status")
  .description("Show connection and schema status")
  .option("--db <url>", "PostgreSQL connection URL (overrides DATABASE_URL)")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      const [{ version }] = await sql`SELECT version()`;
      console.log("✓ Connected:", version);
      const schemas =
        await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = '__name__'`;
      console.log(
        "  Schema '__name__':",
        schemas.length > 0 ? "✓ exists" : "✗ not created (run migrate)",
      );
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

program.parse();
