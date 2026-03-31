import type { Sql } from "postgres";
import { enqueue, getJob, listJobs, cancelJob, listDeadLetterJobs, retryDeadLetterJob } from "../lib/queue.js";
import { createSchedule, listSchedules, updateSchedule, deleteSchedule } from "../lib/schedules.js";

export function makeRouter(sql: Sql) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url); const p = url.pathname; const m = req.method;
    try {
      if (m === "GET" && p === "/health") return json({ ok: true, service: "microservice-jobs" });
      if (m === "POST" && p === "/jobs/enqueue") return json(await enqueue(sql, await req.json()), 201);
      if (m === "GET" && p === "/jobs") return json(await listJobs(sql, { queue: url.searchParams.get("queue") ?? undefined, status: url.searchParams.get("status") ?? undefined, workspaceId: url.searchParams.get("workspace_id") ?? undefined }));
      if (m === "GET" && p.match(/^\/jobs\/[^/]+$/) && !p.includes("dead-letter") && !p.includes("schedules")) {
        const j = await getJob(sql, p.split("/")[2]); return j ? json(j) : json({ error: "Not found" }, 404);
      }
      if (m === "DELETE" && p.match(/^\/jobs\/[^/]+$/)) return json({ cancelled: await cancelJob(sql, p.split("/")[2]) });
      if (m === "GET" && p === "/jobs/dead-letter") return json(await listDeadLetterJobs(sql, url.searchParams.get("queue") ?? undefined));
      if (m === "POST" && p.match(/^\/jobs\/dead-letter\/[^/]+\/retry$/)) return json(await retryDeadLetterJob(sql, p.split("/")[3]));
      if (m === "POST" && p === "/jobs/schedules") return json(await createSchedule(sql, await req.json()), 201);
      if (m === "GET" && p === "/jobs/schedules") return json(await listSchedules(sql));
      if (m === "PATCH" && p.match(/^\/jobs\/schedules\/[^/]+$/)) { await updateSchedule(sql, p.split("/")[3], await req.json()); return json({ ok: true }); }
      if (m === "DELETE" && p.match(/^\/jobs\/schedules\/[^/]+$/)) return json({ deleted: await deleteSchedule(sql, p.split("/")[3]) });
      return json({ error: "Not found" }, 404);
    } catch (e) { return json({ error: e instanceof Error ? e.message : "Server error" }, 500); }
  };
}

function json(d: unknown, s = 200): Response { return new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } }); }
