import type { Sql } from "postgres";
import { z } from "zod";
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
  updateSchedule,
} from "../lib/schedules.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const EnqueueSchema = z.object({
  type: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
  queue: z.string().optional(),
  priority: z.number().int().optional(),
  run_at: z.string().optional(),
  max_attempts: z.number().int().positive().optional(),
  workspace_id: z.string().optional(),
});

const CreateScheduleSchema = z.object({
  name: z.string().min(1),
  cron: z.string().min(1),
  type: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
  queue: z.string().optional(),
});

const UpdateScheduleSchema = z.object({
  enabled: z.boolean().optional(),
  payload: z.record(z.unknown()).optional(),
});

export function makeRouter(sql: Sql) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const p = url.pathname;
    const m = req.method;
    if (m === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders });
    try {
      if (m === "GET" && p === "/health") {
        try {
          const start = Date.now();
          await sql`SELECT 1`;
          return json({
            ok: true,
            service: "microservice-jobs",
            db: true,
            latency_ms: Date.now() - start,
          });
        } catch (e) {
          return json(
            {
              ok: false,
              service: "microservice-jobs",
              db: false,
              error: e instanceof Error ? e.message : "db error",
            },
            503,
          );
        }
      }
      if (m === "POST" && p === "/jobs/enqueue") {
        const parsed = await parseBody(req, EnqueueSchema);
        if ("error" in parsed) return parsed.error;
        return json(await enqueue(sql, parsed.data), 201);
      }
      if (m === "GET" && p === "/jobs") {
        const items = await listJobs(sql, {
          queue: url.searchParams.get("queue") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
          workspaceId: url.searchParams.get("workspace_id") ?? undefined,
        });
        return json({ data: items, count: items.length });
      }
      if (
        m === "GET" &&
        p.match(/^\/jobs\/[^/]+$/) &&
        !p.includes("dead-letter") &&
        !p.includes("schedules")
      ) {
        const j = await getJob(sql, p.split("/")[2]);
        return j ? json(j) : json({ error: "Not found" }, 404);
      }
      if (m === "DELETE" && p.match(/^\/jobs\/[^/]+$/))
        return json({ cancelled: await cancelJob(sql, p.split("/")[2]) });
      if (m === "GET" && p === "/jobs/dead-letter") {
        const items = await listDeadLetterJobs(
          sql,
          url.searchParams.get("queue") ?? undefined,
        );
        return json({ data: items, count: items.length });
      }
      if (m === "POST" && p.match(/^\/jobs\/dead-letter\/[^/]+\/retry$/))
        return json(await retryDeadLetterJob(sql, p.split("/")[3]));
      if (m === "POST" && p === "/jobs/schedules") {
        const parsed = await parseBody(req, CreateScheduleSchema);
        if ("error" in parsed) return parsed.error;
        return json(await createSchedule(sql, parsed.data), 201);
      }
      if (m === "GET" && p === "/jobs/schedules") {
        const items = await listSchedules(sql);
        return json({ data: items, count: items.length });
      }
      if (m === "PATCH" && p.match(/^\/jobs\/schedules\/[^/]+$/)) {
        const parsed = await parseBody(req, UpdateScheduleSchema);
        if ("error" in parsed) return parsed.error;
        await updateSchedule(sql, p.split("/")[3], parsed.data);
        return json({ ok: true });
      }
      if (m === "DELETE" && p.match(/^\/jobs\/schedules\/[^/]+$/))
        return json({ deleted: await deleteSchedule(sql, p.split("/")[3]) });
      if (m === "GET" && p === "/jobs/stats") {
        const stats = await getQueueStats(
          sql,
          url.searchParams.get("queue") ?? undefined,
        );
        return json({ data: stats, count: stats.length });
      }
      if (m === "POST" && p === "/jobs/retry-failed") {
        const parsed = await parseBody(
          req,
          z.object({ queue: z.string().min(1) }),
        );
        if ("error" in parsed) return parsed.error;
        const retried = await retryFailedJobs(sql, parsed.data.queue);
        return json({ retried });
      }
      if (m === "DELETE" && p === "/jobs/purge") {
        const queue = url.searchParams.get("queue") ?? undefined;
        const status = url.searchParams.get("status") ?? undefined;
        const olderThanDays = url.searchParams.get("older_than_days")
          ? parseInt(url.searchParams.get("older_than_days")!, 10)
          : undefined;
        const purged = await purgeJobs(sql, { queue, status, olderThanDays });
        return json({ purged });
      }
      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json(
        { error: e instanceof Error ? e.message : "Server error" },
        500,
      );
    }
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function apiError(
  code: string,
  message: string,
  fields?: Record<string, string>,
  status = 400,
): Response {
  return json(
    { error: { code, message, ...(fields ? { fields } : {}) } },
    status,
  );
}

async function parseBody<T>(
  req: Request,
  schema: z.ZodSchema<T>,
): Promise<{ data: T } | { error: Response }> {
  try {
    const raw = await req.json();
    const result = schema.safeParse(raw);
    if (!result.success) {
      const fields = Object.fromEntries(
        result.error.errors.map((e) => [e.path.join(".") || "body", e.message]),
      );
      return {
        error: apiError("VALIDATION_ERROR", "Invalid request body", fields),
      };
    }
    return { data: result.data };
  } catch {
    return {
      error: apiError("INVALID_JSON", "Request body must be valid JSON"),
    };
  }
}
