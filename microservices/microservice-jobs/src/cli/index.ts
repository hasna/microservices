#!/usr/bin/env bun
import { Command } from "commander";
import { closeDb, getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { enqueue, getQueueStats, listJobs, purgeJobs } from "../lib/queue.js";
import { createSchedule, listSchedules } from "../lib/schedules.js";

const program = new Command();
program
  .name("microservice-jobs")
  .description("Jobs microservice — background jobs, queues, cron, retries")
  .version("0.0.1");

program
  .command("migrate")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log("✓ jobs schema migrations complete");
    } finally {
      await closeDb();
    }
  });
program
  .command("serve")
  .option("--port <n>", "Port", String(process.env.JOBS_PORT ?? "3008"))
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    await startServer(parseInt(o.port, 10));
  });
program
  .command("mcp")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    await import("../mcp/index.js");
  });
program
  .command("list")
  .description("List jobs")
  .option("--queue <q>", "Queue name")
  .option("--status <s>", "Status filter")
  .option("--db <url>")
  .option("--json", "Output as JSON")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      const jobs = await listJobs(sql, {
        queue: o.queue,
        status: o.status,
        limit: 20,
      });
      if (o.json) {
        console.log(JSON.stringify(jobs, null, 2));
      } else {
        for (const j of jobs)
          console.log(
            `  ${j.id}  ${j.type.padEnd(20)} ${j.status.padEnd(10)} ${j.queue}  attempts:${j.attempts}`,
          );
      }
    } finally {
      await closeDb();
    }
  });
program
  .command("enqueue")
  .description("Enqueue a job")
  .requiredOption("--type <t>")
  .option("--payload <json>", "JSON payload", "{}")
  .option("--queue <q>", "Queue", "default")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const j = await enqueue(sql, {
        type: o.type,
        payload: JSON.parse(o.payload),
        queue: o.queue,
      });
      console.log("✓ Enqueued:", j.id, j.type);
    } finally {
      await closeDb();
    }
  });
program
  .command("list-schedules")
  .option("--db <url>")
  .option("--json", "Output as JSON")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      const ss = await listSchedules(sql);
      if (o.json) {
        console.log(JSON.stringify(ss, null, 2));
      } else {
        for (const s of ss)
          console.log(
            `  ${s.name.padEnd(20)} ${s.cron.padEnd(15)} ${s.type}  ${s.enabled ? "✓" : "✗"}`,
          );
      }
    } finally {
      await closeDb();
    }
  });
program
  .command("status")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      const [{ version }] = await sql`SELECT version()`;
      console.log("✓ PostgreSQL:", version.split(" ").slice(0, 2).join(" "));
      const s =
        await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'jobs'`;
      console.log("  Schema 'jobs':", s.length > 0 ? "✓" : "✗ (run migrate)");
    } catch (e) {
      console.error("✗", e instanceof Error ? e.message : e);
      process.exit(1);
    } finally {
      await closeDb();
    }
  });

program
  .command("create-schedule")
  .description("Create a cron schedule")
  .requiredOption("--name <n>", "Schedule name")
  .requiredOption("--cron <expr>", "Cron expression")
  .requiredOption("--type <t>", "Job type")
  .option("--queue <q>", "Queue", "default")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      await migrate(sql);
      const s = await createSchedule(sql, {
        name: o.name,
        cron: o.cron,
        type: o.type,
        queue: o.queue,
      });
      console.log("✓ Created schedule:", s.id, o.name);
    } finally {
      await closeDb();
    }
  });

program
  .command("purge")
  .description("Purge old completed/failed jobs")
  .option("--queue <q>", "Queue filter")
  .option("--status <s>", "Status filter", "completed")
  .option("--older-than <days>", "Older than N days", "7")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      const purged = await purgeJobs(sql, {
        queue: o.queue,
        status: o.status,
        olderThanDays: parseInt(o.olderThan, 10),
      });
      console.log(`✓ Purged ${purged} jobs`);
    } finally {
      await closeDb();
    }
  });

program
  .command("stats")
  .description("Show queue depth stats")
  .option("--queue <q>", "Queue filter")
  .option("--json", "Output as JSON")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      const stats = await getQueueStats(sql, o.queue);
      if (o.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        for (const s of stats)
          console.log(
            `  ${s.queue.padEnd(20)} pending:${s.pending}  running:${s.running}  completed:${s.completed}  failed:${s.failed}  total:${s.total}`,
          );
      }
    } finally {
      await closeDb();
    }
  });

program
  .command("init")
  .description("Run migrations and confirm setup")
  .requiredOption("--db <url>")
  .action(async (o) => {
    process.env.DATABASE_URL = o.db;
    const sql = getDb();
    try {
      await migrate(sql);
      console.log(
        "✓ microservice-jobs ready\n  Schema: jobs.*\n  Next: microservice-jobs serve --port 3008",
      );
    } finally {
      await closeDb();
    }
  });

program
  .command("doctor")
  .description("Check configuration and DB connectivity")
  .option("--db <url>")
  .action(async (o) => {
    if (o.db) process.env.DATABASE_URL = o.db;
    let allOk = true;
    const check = (label: string, pass: boolean, hint?: string) => {
      console.log(
        `  ${pass ? "✓" : "✗"} ${label}${!pass && hint ? `  →  ${hint}` : ""}`,
      );
      if (!pass) allOk = false;
    };
    console.log("\nmicroservice-jobs doctor\n");
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
          await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'jobs'`;
        check(
          "Schema 'jobs' exists",
          schemas.length > 0,
          "run: microservice-jobs migrate",
        );
        if (schemas.length > 0) {
          const tables =
            await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'jobs' ORDER BY table_name`;
          check(
            `Tables (${tables.length})`,
            tables.length >= 3,
            tables.map((t: any) => t.table_name).join(", "),
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
      `\n${allOk ? "✓ All checks passed" : "✗ Some checks failed"}\n`,
    );
    if (!allOk) process.exit(1);
  });

program.parse();
