/**
 * Job queue — enqueue, dequeue (SKIP LOCKED), complete, fail.
 */
import type { Sql } from "postgres";

export interface Job {
  id: string; queue: string; type: string; payload: Record<string, unknown>;
  status: string; priority: number; attempts: number; max_attempts: number;
  run_at: string; started_at: string | null; completed_at: string | null;
  failed_at: string | null; error: string | null; result: unknown | null;
  worker_id: string | null; workspace_id: string | null; created_at: string;
}

export async function enqueue(sql: Sql, data: {
  type: string; payload?: Record<string, unknown>; queue?: string;
  priority?: number; runAt?: Date; maxAttempts?: number; workspaceId?: string;
}): Promise<Job> {
  const [job] = await sql<Job[]>`
    INSERT INTO jobs.jobs (type, payload, queue, priority, run_at, max_attempts, workspace_id)
    VALUES (${data.type}, ${JSON.stringify(data.payload ?? {})}, ${data.queue ?? "default"},
            ${data.priority ?? 0}, ${data.runAt?.toISOString() ?? sql`NOW()`},
            ${data.maxAttempts ?? 3}, ${data.workspaceId ?? null})
    RETURNING *`;
  return job;
}

/** Claim the next available job using SKIP LOCKED (prevents double-processing) */
export async function dequeue(sql: Sql, queue: string = "default", workerId: string): Promise<Job | null> {
  const [job] = await sql<Job[]>`
    UPDATE jobs.jobs SET
      status = 'running', started_at = NOW(), worker_id = ${workerId},
      attempts = attempts + 1, updated_at = NOW()
    WHERE id = (
      SELECT id FROM jobs.jobs
      WHERE queue = ${queue} AND status = 'pending' AND run_at <= NOW()
      ORDER BY priority DESC, run_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
  return job ?? null;
}

export async function completeJob(sql: Sql, id: string, result?: unknown): Promise<void> {
  await sql`UPDATE jobs.jobs SET status = 'completed', completed_at = NOW(), result = ${JSON.stringify(result ?? null)}, updated_at = NOW() WHERE id = ${id}`;
}

/** Fail a job; if retries exhausted, move to dead letter queue */
export async function failJob(sql: Sql, id: string, error: string): Promise<void> {
  const [job] = await sql<Job[]>`
    UPDATE jobs.jobs SET status = 'failed', failed_at = NOW(), error = ${error}, updated_at = NOW()
    WHERE id = ${id} RETURNING *`;
  if (!job) return;

  if (job.attempts >= job.max_attempts) {
    // Move to dead letter
    await sql`INSERT INTO jobs.dead_letter (job_id, queue, type, payload, error, attempts) VALUES (${job.id}, ${job.queue}, ${job.type}, ${JSON.stringify(job.payload)}, ${error}, ${job.attempts})`;
  } else {
    // Schedule retry with exponential backoff
    const backoffSeconds = Math.min(Math.pow(2, job.attempts) * 5, 3600);
    await sql`UPDATE jobs.jobs SET status = 'pending', run_at = NOW() + ${backoffSeconds} * INTERVAL '1 second', updated_at = NOW() WHERE id = ${id}`;
  }
}

export async function cancelJob(sql: Sql, id: string): Promise<boolean> {
  const r = await sql`UPDATE jobs.jobs SET status = 'cancelled', updated_at = NOW() WHERE id = ${id} AND status IN ('pending') `;
  return r.count > 0;
}

export async function getJob(sql: Sql, id: string): Promise<Job | null> {
  const [j] = await sql<Job[]>`SELECT * FROM jobs.jobs WHERE id = ${id}`;
  return j ?? null;
}

export async function listJobs(sql: Sql, opts: { queue?: string; status?: string; type?: string; workspaceId?: string; limit?: number; offset?: number } = {}): Promise<Job[]> {
  return sql<Job[]>`
    SELECT * FROM jobs.jobs
    WHERE (${opts.queue ?? null} IS NULL OR queue = ${opts.queue ?? null})
      AND (${opts.status ?? null} IS NULL OR status = ${opts.status ?? null})
      AND (${opts.type ?? null} IS NULL OR type = ${opts.type ?? null})
      AND (${opts.workspaceId ?? null} IS NULL OR workspace_id = ${opts.workspaceId ?? null})
    ORDER BY created_at DESC LIMIT ${opts.limit ?? 50} OFFSET ${opts.offset ?? 0}`;
}

export interface QueueStats {
  queue: string;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
}

export async function getQueueStats(sql: Sql, queue?: string): Promise<QueueStats[]> {
  const rows = await sql<{ queue: string; status: string; count: string }[]>`
    SELECT queue, status, COUNT(*) as count FROM jobs.jobs
    WHERE (${queue ?? null} IS NULL OR queue = ${queue ?? null})
    GROUP BY queue, status`;

  const stats: Record<string, QueueStats> = {};
  for (const r of rows) {
    if (!stats[r.queue]) stats[r.queue] = { queue: r.queue, pending: 0, running: 0, completed: 0, failed: 0, total: 0 };
    const s = stats[r.queue];
    const count = parseInt(r.count);
    s.total += count;
    if (r.status === "pending") s.pending = count;
    else if (r.status === "running") s.running = count;
    else if (r.status === "completed") s.completed = count;
    else if (r.status === "failed") s.failed = count;
  }
  return Object.values(stats).sort((a, b) => a.queue.localeCompare(b.queue));
}

export async function retryFailedJobs(sql: Sql, queue: string): Promise<number> {
  const result = await sql`
    UPDATE jobs.jobs SET status = 'pending', run_at = NOW(), error = NULL, updated_at = NOW()
    WHERE queue = ${queue} AND status = 'failed' AND attempts < max_attempts`;
  return result.count;
}

export async function purgeJobs(sql: Sql, opts: { queue?: string; status?: string; olderThanDays?: number }): Promise<number> {
  const cutoff = new Date(Date.now() - (opts.olderThanDays ?? 7) * 86400000).toISOString();
  const result = await sql`
    DELETE FROM jobs.jobs
    WHERE (${opts.queue ?? null} IS NULL OR queue = ${opts.queue ?? null})
      AND (${opts.status ?? null} IS NULL OR status = ${opts.status ?? null})
      AND created_at < ${cutoff}
      AND status NOT IN ('pending', 'running')`;
  return result.count;
}

export async function updateJobProgress(sql: Sql, id: string, progress: number, message?: string): Promise<void> {
  // progress stored in result jsonb as {progress: N, message: "..."}
  await sql`
    UPDATE jobs.jobs SET
      result = jsonb_build_object('progress', ${Math.min(100, Math.max(0, progress))}, 'message', ${message ?? null}),
      updated_at = NOW()
    WHERE id = ${id} AND status = 'running'`;
}

export async function listDeadLetterJobs(sql: Sql, queue?: string): Promise<unknown[]> {
  return sql`SELECT * FROM jobs.dead_letter WHERE (${queue ?? null} IS NULL OR queue = ${queue ?? null}) ORDER BY failed_at DESC LIMIT 100`;
}

export async function retryDeadLetterJob(sql: Sql, deadLetterId: string): Promise<Job> {
  const [dl] = await sql<[{ job_id: string; queue: string; type: string; payload: Record<string, unknown> }]>`
    SELECT * FROM jobs.dead_letter WHERE id = ${deadLetterId}`;
  if (!dl) throw new Error("Dead letter job not found");
  await sql`DELETE FROM jobs.dead_letter WHERE id = ${deadLetterId}`;
  return enqueue(sql, { type: dl.type, payload: dl.payload, queue: dl.queue });
}
