#!/usr/bin/env bun
/**
 * MCP server for microservice-jobs.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import {
  cancelJob,
  completeJob,
  dequeue,
  enqueue,
  failJob,
  getJob,
  getQueueStats,
  listDeadLetterJobs,
  listJobs,
  purgeJobs,
  retryDeadLetterJob,
  retryFailedJobs,
  updateJobProgress,
  batchEnqueue,
  enqueueIdempotent,
  getJobProgress,
} from "../lib/queue.js";
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  shouldFire,
  triggerDueSchedules,
  updateSchedule,
} from "../lib/schedules.js";
import {
  deregisterWorker,
  heartbeatWorker,
  listWorkers,
  markWorkerDead,
  registerWorker,
} from "../lib/workers.js";
import {
  getWorkerStats,
  getQueueDepthTrend,
  getTopFailingJobTypes,
  clearDeadLetterJobs,
  getDeadLetterStats,
} from "../lib/analytics.js";
import { dequeue } from "../lib/queue.js";

const server = new McpServer({
  name: "microservice-jobs",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

server.tool(
  "jobs_enqueue",
  "Enqueue a background job",
  {
    type: z.string(),
    payload: z.record(z.any()).optional().default({}),
    queue: z.string().optional(),
    priority: z.number().optional(),
  },
  async (jobData) => text(await enqueue(sql, jobData)),
);

server.tool(
  "jobs_get",
  "Get a job by ID",
  { id: z.string() },
  async ({ id }) => text(await getJob(sql, id)),
);

server.tool(
  "jobs_list",
  "List jobs",
  {
    queue: z.string().optional(),
    status: z.string().optional(),
    limit: z.number().optional().default(50),
  },
  async (opts) => text(await listJobs(sql, opts as any)),
);

server.tool(
  "jobs_cancel",
  "Cancel a pending job",
  { id: z.string() },
  async ({ id }) => text({ cancelled: await cancelJob(sql, id) }),
);

server.tool(
  "jobs_list_dead_letter",
  "List dead letter jobs",
  { queue: z.string().optional() },
  async ({ queue }) => text(await listDeadLetterJobs(sql, queue)),
);

server.tool(
  "jobs_retry_dead_letter",
  "Retry a dead letter job",
  { id: z.string() },
  async ({ id }) => text(await retryDeadLetterJob(sql, id)),
);

server.tool(
  "jobs_create_schedule",
  "Create a cron schedule",
  {
    name: z.string(),
    cron: z.string(),
    type: z.string(),
    payload: z.record(z.any()).optional().default({}),
  },
  async (scheduleData) => text(await createSchedule(sql, scheduleData)),
);

server.tool(
  "jobs_list_schedules",
  "List all schedules",
  {},
  async () => text(await listSchedules(sql)),
);

server.tool(
  "jobs_delete_schedule",
  "Delete a schedule",
  { id: z.string() },
  async ({ id }) => text({ deleted: await deleteSchedule(sql, id) }),
);

server.tool(
  "jobs_get_stats",
  "Get queue depth stats per queue",
  { queue: z.string().optional() },
  async ({ queue }) => text(await getQueueStats(sql, queue)),
);

server.tool(
  "jobs_retry_failed",
  "Retry all failed retryable jobs in a queue",
  { queue: z.string() },
  async ({ queue }) => text({ retried: await retryFailedJobs(sql, queue) }),
);

server.tool(
  "jobs_purge",
  "Purge old completed/failed jobs",
  {
    queue: z.string().optional(),
    status: z.string().optional(),
    older_than_days: z.number().optional(),
  },
  async ({ queue, status, older_than_days }) =>
    text({
      purged: await purgeJobs(sql, {
        queue,
        status,
        olderThanDays: older_than_days,
      }),
    }),
);

server.tool(
  "jobs_enqueue_idempotent",
  "Enqueue a job with idempotency key for deduplication",
  {
    type: z.string(),
    idempotency_key: z.string(),
    payload: z.record(z.any()).optional().default({}),
    queue: z.string().optional(),
    priority: z.number().optional(),
    max_attempts: z.number().optional(),
    workspace_id: z.string().optional(),
    dedup_window_minutes: z.number().optional(),
  },
  async (opts) => text(await enqueueIdempotent(sql, opts as any)),
);

server.tool(
  "jobs_batch_enqueue",
  "Enqueue multiple jobs in a batch",
  {
    jobs: z.array(z.object({
      type: z.string(),
      payload: z.record(z.any()).optional().default({}),
      queue: z.string().optional(),
      priority: z.number().optional(),
      max_attempts: z.number().optional(),
      workspace_id: z.string().optional(),
    })),
  },
  async ({ jobs }) => text(await batchEnqueue(sql, jobs as any)),
);

server.tool(
  "jobs_get_progress",
  "Get job progress",
  { id: z.string() },
  async ({ id }) => text(await getJobProgress(sql, id)),
);

server.tool(
  "jobs_register_worker",
  "Register a new worker",
  {
    worker_id: z.string(),
    name: z.string().optional(),
    queues: z.array(z.string()).optional(),
    metadata: z.record(z.any()).optional(),
  },
  async (opts) => text(await registerWorker(sql, opts as any)),
);

server.tool(
  "jobs_heartbeat",
  "Send worker heartbeat",
  { worker_id: z.string() },
  async ({ worker_id }) => text(await heartbeatWorker(sql, worker_id)),
);

server.tool(
  "jobs_list_workers",
  "List workers",
  {
    queue: z.string().optional(),
    status: z.string().optional(),
  },
  async (opts) => text(await listWorkers(sql, opts as any)),
);

server.tool(
  "jobs_complete",
  "Mark a job as completed with optional result",
  {
    id: z.string(),
    result: z.record(z.any()).optional(),
  },
  async ({ id, result }) => text({ completed: await completeJob(sql, id, result) }),
);

server.tool(
  "jobs_fail",
  "Mark a job as failed with an error message",
  {
    id: z.string(),
    error: z.string().optional(),
  },
  async ({ id, error }) => text({ failed: await failJob(sql, id, error) }),
);

server.tool(
  "jobs_update_progress",
  "Update a job's progress percentage (0-100)",
  {
    id: z.string(),
    progress: z.number().min(0).max(100),
  },
  async ({ id, progress }) => text({ updated: await updateJobProgress(sql, id, progress) }),
);

server.tool(
  "jobs_should_fire",
  "Check if a schedule should fire at a given time",
  { schedule_id: z.string(), at: z.string().optional() },
  async ({ schedule_id, at }) =>
    text({ shouldFire: await shouldFire(sql, schedule_id, at ? new Date(at) : undefined) }),
);

server.tool(
  "jobs_trigger_schedules",
  "Manually trigger all due schedules (useful for cron Catchup)",
  { limit: z.number().optional().default(100) },
  async ({ limit }) => text({ triggered: await triggerDueSchedules(sql, limit) }),
);

server.tool(
  "jobs_update_schedule",
  "Update a schedule's cron expression or payload",
  {
    id: z.string(),
    cron: z.string().optional(),
    payload: z.record(z.any()).optional(),
    active: z.boolean().optional(),
  },
  async ({ id, ...rest }) => text(await updateSchedule(sql, id, rest)),
);

server.tool(
  "jobs_deregister_worker",
  "Deregister a worker (does not affect its jobs)",
  { worker_id: z.string() },
  async ({ worker_id }) => text({ deregistered: await deregisterWorker(sql, worker_id) }),
);

server.tool(
  "jobs_mark_worker_dead",
  "Mark a worker as dead and re-queue its jobs",
  { worker_id: z.string() },
  async ({ worker_id }) => text({ dead: await markWorkerDead(sql, worker_id) }),
);

// ─── Dequeue ───────────────────────────────────────────────────────────────────

server.tool(
  "jobs_dequeue",
  "Dequeue the next available job for a worker (uses SKIP LOCKED to prevent double-assignment)",
  {
    worker_id: z.string().describe("Worker ID claiming the job"),
    queue: z.string().optional().default("default").describe("Queue to dequeue from"),
  },
  async ({ worker_id, queue }) => text(await dequeue(sql, queue, worker_id)),
);

// ─── Worker Analytics ──────────────────────────────────────────────────────────

server.tool(
  "jobs_get_worker_stats",
  "Get per-worker completion/failure stats and average latency",
  {
    workspace_id: z.string().optional().describe("Filter by workspace"),
    hours: z.number().optional().default(24).describe("Time window in hours"),
  },
  async ({ workspace_id, hours }) =>
    text(await getWorkerStats(sql, { workspace_id, hours })),
);

server.tool(
  "jobs_get_queue_depth_trend",
  "Get hourly queue depth trend for the last N hours",
  {
    queue: z.string().optional().describe("Queue to analyze"),
    hours: z.number().optional().default(24).describe("Hours of history"),
  },
  async ({ queue, hours }) =>
    text(await getQueueDepthTrend(sql, { queue, hours })),
);

server.tool(
  "jobs_get_top_failing_types",
  "Get the most frequently failing job types for debugging",
  {
    workspace_id: z.string().optional().describe("Filter by workspace"),
    hours: z.number().optional().default(24).describe("Time window in hours"),
    limit: z.number().optional().default(10).describe("Max results"),
  },
  async ({ workspace_id, hours, limit }) =>
    text(await getTopFailingJobTypes(sql, { workspace_id, hours, limit })),
);

// ─── Dead Letter Management ───────────────────────────────────────────────────

server.tool(
  "jobs_get_dead_letter_stats",
  "Get dead letter queue summary per queue",
  {},
  async () => text(await getDeadLetterStats(sql)),
);

server.tool(
  "jobs_clear_dead_letter",
  "Clear all dead letter jobs for a queue (irreversible)",
  { queue: z.string().optional().describe("Queue to clear (all queues if omitted)") },
  async ({ queue }) => text({ cleared: await clearDeadLetterJobs(sql, queue) }),
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
