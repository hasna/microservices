#!/usr/bin/env bun
import { Command } from "commander";
import { getDb, closeDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";
import { listJobs, enqueue } from "../lib/queue.js";
import { listSchedules, createSchedule } from "../lib/schedules.js";

const program = new Command();
program.name("microservice-jobs").description("Jobs microservice — background jobs, queues, cron, retries").version("0.0.1");

program.command("migrate").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { await migrate(sql); console.log("✓ jobs schema migrations complete"); } finally { await closeDb(); }
});
program.command("serve").option("--port <n>", "Port", String(process.env["JOBS_PORT"] ?? "3008")).option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db; await startServer(parseInt(o.port, 10));
});
program.command("mcp").option("--db <url>").action(async o => { if (o.db) process.env["DATABASE_URL"] = o.db; await import("../mcp/index.js"); });
program.command("list").description("List jobs").option("--queue <q>", "Queue name").option("--status <s>", "Status filter").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { const jobs = await listJobs(sql, { queue: o.queue, status: o.status, limit: 20 }); for (const j of jobs) console.log(`  ${j.id}  ${j.type.padEnd(20)} ${j.status.padEnd(10)} ${j.queue}  attempts:${j.attempts}`); } finally { await closeDb(); }
});
program.command("enqueue").description("Enqueue a job").requiredOption("--type <t>").option("--payload <json>", "JSON payload", "{}").option("--queue <q>", "Queue", "default").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { await migrate(sql); const j = await enqueue(sql, { type: o.type, payload: JSON.parse(o.payload), queue: o.queue }); console.log("✓ Enqueued:", j.id, j.type); } finally { await closeDb(); }
});
program.command("list-schedules").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { const ss = await listSchedules(sql); for (const s of ss) console.log(`  ${s.name.padEnd(20)} ${s.cron.padEnd(15)} ${s.type}  ${s.enabled ? "✓" : "✗"}`); } finally { await closeDb(); }
});
program.command("status").option("--db <url>").action(async o => {
  if (o.db) process.env["DATABASE_URL"] = o.db;
  const sql = getDb(); try { const [{ version }] = await sql`SELECT version()`; console.log("✓ PostgreSQL:", version.split(" ").slice(0,2).join(" ")); const s = await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'jobs'`; console.log("  Schema 'jobs':", s.length > 0 ? "✓" : "✗ (run migrate)"); } catch (e) { console.error("✗", e instanceof Error ? e.message : e); process.exit(1); } finally { await closeDb(); }
});

program.parse();
