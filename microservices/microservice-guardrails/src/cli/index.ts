#!/usr/bin/env bun
import { Command } from "commander";
import { closeDb, getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { checkInput, checkOutput } from "../lib/guard.js";
import { redactPII, scanPII } from "../lib/pii.js";
import { listViolations } from "../lib/violations.js";

const program = new Command();

program
  .name("microservice-guardrails")
  .description(
    "Guardrails microservice — PII detection, prompt injection defense, toxicity filtering, policy enforcement",
  )
  .version("0.0.1");

program
  .command("migrate")
  .description("Run database migrations (creates guardrails.* schema)")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ guardrails schema migrations complete");
    } finally {
      await closeDb();
    }
  });

program
  .command("serve")
  .description("Start the HTTP API server")
  .option("--port <n>", "Port", String(process.env.GUARDRAILS_PORT ?? "3017"))
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
        await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'guardrails'`;
      console.log(
        "  Schema 'guardrails':",
        schemas.length > 0 ? "✓ exists" : "✗ missing (run migrate)",
      );
      if (schemas.length > 0) {
        const [{ count: pCount }] =
          await sql`SELECT COUNT(*) as count FROM guardrails.policies`;
        const [{ count: vCount }] =
          await sql`SELECT COUNT(*) as count FROM guardrails.violations`;
        console.log("  Policies:", pCount);
        console.log("  Violations:", vCount);
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
  .command("check")
  .description("Check text for guardrail violations")
  .requiredOption("--text <text>", "Text to check")
  .option("--direction <dir>", "Direction: input or output", "input")
  .option("--workspace <id>", "Workspace ID for policy evaluation")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const result =
        opts.direction === "output"
          ? await checkOutput(sql, opts.text, opts.workspace)
          : await checkInput(sql, opts.text, opts.workspace);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`\n  Safe: ${result.safe ? "✓ yes" : "✗ no"}`);
      if (result.violations.length > 0) {
        console.log(`  Violations (${result.violations.length}):`);
        for (const v of result.violations) {
          console.log(
            `    [${v.severity}] ${v.type}: ${JSON.stringify(v.details)}`,
          );
        }
      }
      if (result.sanitized !== opts.text) {
        console.log(`  Sanitized: ${result.sanitized.slice(0, 200)}`);
      }
      console.log();
    } finally {
      await closeDb();
    }
  });

program
  .command("scan-pii")
  .description("Scan text for PII patterns")
  .requiredOption("--text <text>", "Text to scan")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const matches = scanPII(opts.text);
    if (opts.json) {
      console.log(JSON.stringify({ matches }, null, 2));
      return;
    }
    if (matches.length === 0) {
      console.log("No PII detected.");
      return;
    }
    console.log(`\n  PII matches (${matches.length}):`);
    for (const m of matches) {
      console.log(`    [${m.type}] "${m.value}" at ${m.start}-${m.end}`);
    }
    console.log(`\n  Redacted: ${redactPII(opts.text, matches)}\n`);
  });

program
  .command("list-violations")
  .description("List recent guardrail violations")
  .option("--workspace <id>", "Filter by workspace ID")
  .option("--type <type>", "Filter by violation type")
  .option("--limit <n>", "Max results", "20")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const violations = await listViolations(sql, {
        workspaceId: opts.workspace,
        type: opts.type,
        limit: parseInt(opts.limit, 10),
      });
      if (opts.json) {
        console.log(
          JSON.stringify(
            { data: violations, count: violations.length },
            null,
            2,
          ),
        );
        return;
      }
      if (violations.length === 0) {
        console.log("No violations found.");
        return;
      }
      for (const v of violations) {
        const ts =
          v.created_at instanceof Date
            ? v.created_at.toISOString()
            : String(v.created_at);
        console.log(
          `  [${ts}] [${v.severity}] ${v.type} (${v.direction}) ${v.content_snippet ? `${v.content_snippet.slice(0, 60)}...` : ""}`,
        );
      }
      console.log(`\nShowing ${violations.length} violations`);
    } finally {
      await closeDb();
    }
  });

program
  .command("init")
  .description("Run migrations and confirm setup")
  .requiredOption("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log(
        "✓ microservice-guardrails ready\n  Schema: guardrails.*\n  Next: microservice-guardrails serve --port 3017",
      );
    } finally {
      await closeDb();
    }
  });

program
  .command("doctor")
  .description("Check configuration and DB connectivity")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    let allOk = true;
    const check = (label: string, pass: boolean, hint?: string) => {
      console.log(
        `  ${pass ? "✓" : "✗"} ${label}${!pass && hint ? `  →  ${hint}` : ""}`,
      );
      if (!pass) allOk = false;
    };
    console.log("\nmicroservice-guardrails doctor\n");
    check(
      "DATABASE_URL",
      !!process.env.DATABASE_URL,
      "set DATABASE_URL=postgres://...",
    );
    if (process.env.DATABASE_URL) {
      const sql = getDb();
      try {
        const start = Date.now();
        await sql`SELECT 1`;
        check(`PostgreSQL reachable (${Date.now() - start}ms)`, true);
        const schemas =
          await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'guardrails'`;
        check(
          "Schema 'guardrails' exists",
          schemas.length > 0,
          "run: microservice-guardrails migrate",
        );
        if (schemas.length > 0) {
          const [{ count: pCount }] =
            await sql`SELECT COUNT(*) as count FROM guardrails.policies`;
          const [{ count: vCount }] =
            await sql`SELECT COUNT(*) as count FROM guardrails.violations`;
          console.log(`  ℹ Policies: ${pCount}`);
          console.log(`  ℹ Violations logged: ${vCount}`);
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
      `\n${allOk ? "✓ All checks passed" : "✗ Some checks failed"}\n`,
    );
    if (!allOk) process.exit(1);
  });

program.parse();
