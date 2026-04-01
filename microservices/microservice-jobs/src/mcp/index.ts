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
  enqueue,
  getJob,
  getQueueStats,
  listDeadLetterJobs,
  listJobs,
  purgeJobs,
  retryDeadLetterJob,
  retryFailedJobs,
} from "../lib/queue.js";
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
} from "../lib/schedules.js";

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

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
