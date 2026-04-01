#!/usr/bin/env bun
import { Command } from "commander";
import { closeDb, getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import type { SpanWithChildren } from "../lib/query.js";
import { getTraceTree, listTraces } from "../lib/query.js";
import { getTraceStats } from "../lib/stats.js";

const program = new Command();

program
  .name("microservice-traces")
  .description(
    "Traces microservice — LLM trace and span tracking with stats and tree visualization",
  )
  .version("0.0.1");

program
  .command("migrate")
  .description("Run database migrations (creates traces.* schema)")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ traces schema migrations complete");
    } finally {
      await closeDb();
    }
  });

program
  .command("serve")
  .description("Start the HTTP API server")
  .option("--port <n>", "Port", String(process.env.TRACES_PORT ?? "3019"))
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
    console.log("\nmicroservice-traces doctor\n");
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
          await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'traces'`;
        check(
          "Schema 'traces' exists",
          schemas.length > 0,
          "run: microservice-traces migrate",
        );
        if (schemas.length > 0) {
          const [{ count }] =
            await sql`SELECT COUNT(*) as count FROM traces.traces`;
          console.log(`  ℹ Traces stored: ${count}`);
          const [{ span_count }] =
            await sql`SELECT COUNT(*) as span_count FROM traces.spans`;
          console.log(`  ℹ Spans stored: ${span_count}`);
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
        "✓ microservice-traces ready\n  Schema: traces.*\n  Next: microservice-traces serve --port 3019",
      );
    } finally {
      await closeDb();
    }
  });

program
  .command("list")
  .description("List traces for a workspace")
  .requiredOption("--workspace <id>", "Workspace ID")
  .option("--status <status>", "Filter by status")
  .option("--since <date>", "Filter from date (ISO string)")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const traces = await listTraces(sql, opts.workspace, {
        status: opts.status,
        since: opts.since ? new Date(opts.since) : undefined,
      });
      if (opts.json) {
        console.log(
          JSON.stringify({ data: traces, count: traces.length }, null, 2),
        );
        return;
      }
      if (traces.length === 0) {
        console.log("No traces found.");
        return;
      }
      for (const t of traces) {
        const ts =
          t.started_at instanceof Date
            ? t.started_at.toISOString()
            : String(t.started_at);
        const dur =
          t.total_duration_ms != null ? `${t.total_duration_ms}ms` : "running";
        console.log(
          `  [${ts}] ${t.name} (${t.status}) ${dur} — ${t.span_count} spans, ${t.total_tokens} tokens`,
        );
      }
      console.log(`\n${traces.length} traces`);
    } finally {
      await closeDb();
    }
  });

program
  .command("show <trace-id>")
  .description("Show a trace with spans as tree")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (traceId, opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const trace = await getTraceTree(sql, traceId);
      if (!trace) {
        console.error(`✗ Trace ${traceId} not found`);
        process.exit(1);
      }
      const dur =
        trace.total_duration_ms != null
          ? `${trace.total_duration_ms}ms`
          : "running";
      console.log(`\nTrace: ${trace.name} (${trace.status})`);
      console.log(`  ID: ${trace.id}`);
      console.log(`  Duration: ${dur}`);
      console.log(`  Tokens: ${trace.total_tokens}`);
      console.log(`  Cost: $${trace.total_cost_usd}`);
      console.log(`  Spans: ${trace.span_count}`);
      if (trace.error) console.log(`  Error: ${trace.error}`);
      if (trace.spans.length > 0) {
        console.log("\n  Span tree:");
        printSpanTree(trace.spans, "    ");
      }
    } finally {
      await closeDb();
    }
  });

program
  .command("stats")
  .description("Show trace statistics for a workspace")
  .requiredOption("--workspace <id>", "Workspace ID")
  .option("--since <date>", "Since date (ISO string)")
  .option("--json", "Output as JSON")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const since = opts.since ? new Date(opts.since) : undefined;
      const stats = await getTraceStats(sql, opts.workspace, since);
      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }
      console.log(`\nTrace stats for workspace: ${opts.workspace}\n`);
      console.log(`  Total traces: ${stats.total_traces}`);
      console.log(`  Completed: ${stats.completed}`);
      console.log(`  Errored: ${stats.errored}`);
      console.log(`  Avg duration: ${stats.avg_duration_ms}ms`);
      console.log(`  Avg tokens: ${stats.avg_tokens}`);
      console.log(`  Avg cost: $${stats.avg_cost_usd}`);
      console.log(`  P50 duration: ${stats.p50_duration_ms}ms`);
      console.log(`  P95 duration: ${stats.p95_duration_ms}ms`);
      if (stats.by_span_type.length > 0) {
        console.log("\n  By span type:");
        for (const s of stats.by_span_type) {
          console.log(
            `    ${s.type}: ${s.count} spans, avg ${s.avg_duration_ms}ms, ${s.total_tokens} tokens, $${s.total_cost_usd}`,
          );
        }
      }
      if (stats.top_errors.length > 0) {
        console.log("\n  Top errors:");
        for (const e of stats.top_errors) {
          console.log(`    ${e.error}: ${e.count}`);
        }
      }
      if (stats.traces_per_day.length > 0) {
        console.log("\n  Traces per day:");
        for (const d of stats.traces_per_day) {
          console.log(`    ${d.date}: ${d.count}`);
        }
      }
    } finally {
      await closeDb();
    }
  });

function printSpanTree(spans: SpanWithChildren[], indent: string): void {
  for (const span of spans) {
    const dur = span.duration_ms != null ? `${span.duration_ms}ms` : "running";
    const tokens = (span.tokens_in ?? 0) + (span.tokens_out ?? 0);
    const tokenStr = tokens > 0 ? ` ${tokens}tok` : "";
    const model = span.model ? ` [${span.model}]` : "";
    const err = span.status === "error" && span.error ? ` ✗ ${span.error}` : "";
    console.log(
      `${indent}├─ ${span.name} (${span.type}) ${dur}${model}${tokenStr}${err}`,
    );
    if (span.children.length > 0) {
      printSpanTree(span.children, `${indent}│  `);
    }
  }
}

program.parse();
