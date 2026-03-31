#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { enqueue, getJob, listJobs, cancelJob, listDeadLetterJobs, retryDeadLetterJob, getQueueStats, retryFailedJobs, purgeJobs } from "../lib/queue.js";
import { createSchedule, listSchedules, deleteSchedule } from "../lib/schedules.js";

const server = new Server({ name: "microservice-jobs", version: "0.0.1" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: "jobs_enqueue", description: "Enqueue a background job", inputSchema: { type: "object", properties: { type: { type: "string" }, payload: { type: "object" }, queue: { type: "string" }, priority: { type: "number" } }, required: ["type"] } },
  { name: "jobs_get", description: "Get a job by ID", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "jobs_list", description: "List jobs", inputSchema: { type: "object", properties: { queue: { type: "string" }, status: { type: "string" }, limit: { type: "number" } }, required: [] } },
  { name: "jobs_cancel", description: "Cancel a pending job", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "jobs_list_dead_letter", description: "List dead letter jobs", inputSchema: { type: "object", properties: { queue: { type: "string" } }, required: [] } },
  { name: "jobs_retry_dead_letter", description: "Retry a dead letter job", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "jobs_create_schedule", description: "Create a cron schedule", inputSchema: { type: "object", properties: { name: { type: "string" }, cron: { type: "string" }, type: { type: "string" }, payload: { type: "object" } }, required: ["name", "cron", "type"] } },
  { name: "jobs_list_schedules", description: "List all schedules", inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "jobs_delete_schedule", description: "Delete a schedule", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "jobs_get_stats", description: "Get queue depth stats per queue", inputSchema: { type: "object", properties: { queue: { type: "string" } }, required: [] } },
  { name: "jobs_retry_failed", description: "Retry all failed retryable jobs in a queue", inputSchema: { type: "object", properties: { queue: { type: "string" } }, required: ["queue"] } },
  { name: "jobs_purge", description: "Purge old completed/failed jobs", inputSchema: { type: "object", properties: { queue: { type: "string" }, status: { type: "string" }, older_than_days: { type: "number" } }, required: [] } },
]}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb(); const { name, arguments: args } = req.params; const a = args as Record<string, unknown>;
  const t = (d: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(d, null, 2) }] });
  if (name === "jobs_enqueue") return t(await enqueue(sql, { type: String(a.type), payload: a.payload as any, queue: a.queue as string | undefined, priority: a.priority as number | undefined }));
  if (name === "jobs_get") return t(await getJob(sql, String(a.id)));
  if (name === "jobs_list") return t(await listJobs(sql, { queue: a.queue as string, status: a.status as string, limit: a.limit as number }));
  if (name === "jobs_cancel") return t({ cancelled: await cancelJob(sql, String(a.id)) });
  if (name === "jobs_list_dead_letter") return t(await listDeadLetterJobs(sql, a.queue as string | undefined));
  if (name === "jobs_retry_dead_letter") return t(await retryDeadLetterJob(sql, String(a.id)));
  if (name === "jobs_create_schedule") return t(await createSchedule(sql, { name: String(a.name), cron: String(a.cron), type: String(a.type), payload: a.payload as any }));
  if (name === "jobs_list_schedules") return t(await listSchedules(sql));
  if (name === "jobs_delete_schedule") return t({ deleted: await deleteSchedule(sql, String(a.id)) });
  if (name === "jobs_get_stats") return t(await getQueueStats(sql, a.queue as string | undefined));
  if (name === "jobs_retry_failed") return t({ retried: await retryFailedJobs(sql, String(a.queue)) });
  if (name === "jobs_purge") return t({ purged: await purgeJobs(sql, { queue: a.queue as string | undefined, status: a.status as string | undefined, olderThanDays: a.older_than_days as number | undefined }) });
  throw new Error(`Unknown tool: ${name}`);
});

async function main() { const sql = getDb(); await migrate(sql); await server.connect(new StdioServerTransport()); }
main().catch(console.error);
