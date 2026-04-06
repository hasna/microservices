/**
 * Job analytics — worker stats, queue depth trends, dead letter management.
 */
import type { Sql } from "postgres";

export interface WorkerStats {
  worker_id: string;
  name: string | null;
  jobs_completed: number;
  jobs_failed: number;
  avg_latency_ms: number;
  last_completed_at: string | null;
}

export interface QueueDepthTrend {
  timestamp: string;
  queue: string;
  pending: number;
  running: number;
}

/**
 * Get per-worker completion statistics for a time window.
 */
export async function getWorkerStats(
  sql: Sql,
  opts: { workspace_id?: string; hours?: number } = {},
): Promise<WorkerStats[]> {
  const hours = opts.hours ?? 24;
  const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
  const rows = await sql<any[]>`
    SELECT
      w.worker_id,
      w.name,
      COUNT(CASE WHEN j.status = 'completed' THEN 1 END) as jobs_completed,
      COUNT(CASE WHEN j.status = 'failed' THEN 1 END) as jobs_failed,
      AVG(EXTRACT(EPOCH FROM (j.completed_at - j.started_at)) * 1000) as avg_latency_ms,
      MAX(j.completed_at) as last_completed_at
    FROM jobs.workers w
    LEFT JOIN jobs.jobs j ON j.worker_id = w.worker_id AND j.completed_at > ${cutoff}
    WHERE (${opts.workspace_id ?? null} IS NULL OR j.workspace_id = ${opts.workspace_id ?? null})
    GROUP BY w.worker_id, w.name
    ORDER BY jobs_completed DESC`;
  return rows.map(r => ({
    worker_id: r.worker_id,
    name: r.name,
    jobs_completed: parseInt(r.jobs_completed, 10),
    jobs_failed: parseInt(r.jobs_failed, 10),
    avg_latency_ms: parseFloat(r.avg_latency_ms) || 0,
    last_completed_at: r.last_completed_at,
  }));
}

/**
 * Get queue depth trend — counts per status per hour for the last N hours.
 */
export async function getQueueDepthTrend(
  sql: Sql,
  opts: { queue?: string; hours?: number } = {},
): Promise<QueueDepthTrend[]> {
  const hours = opts.hours ?? 24;
  const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
  const rows = await sql<any[]>`
    SELECT
      date_trunc('hour', created_at) as timestamp,
      queue,
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'running') as running
    FROM jobs.jobs
    WHERE created_at > ${cutoff}
      AND (${opts.queue ?? null} IS NULL OR queue = ${opts.queue ?? null})
    GROUP BY date_trunc('hour', created_at), queue
    ORDER BY timestamp ASC`;
  return rows.map(r => ({
    timestamp: r.timestamp,
    queue: r.queue,
    pending: parseInt(r.pending, 10),
    running: parseInt(r.running, 10),
  }));
}

/**
 * Get top failing job types for debugging.
 */
export async function getTopFailingJobTypes(
  sql: Sql,
  opts: { workspace_id?: string; hours?: number; limit?: number } = {},
): Promise<{ type: string; count: number; last_error: string | null }[]> {
  const hours = opts.hours ?? 24;
  const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
  const rows = await sql<any[]>`
    SELECT type, COUNT(*) as count, MAX(error) as last_error
    FROM jobs.jobs
    WHERE status = 'failed' AND failed_at > ${cutoff}
      AND (${opts.workspace_id ?? null} IS NULL OR workspace_id = ${opts.workspace_id ?? null})
    GROUP BY type
    ORDER BY count DESC
    LIMIT ${opts.limit ?? 10}`;
  return rows.map(r => ({
    type: r.type,
    count: parseInt(r.count, 10),
    last_error: r.last_error,
  }));
}

/**
 * Clear all dead letter jobs for a queue.
 */
export async function clearDeadLetterJobs(
  sql: Sql,
  queue?: string,
): Promise<number> {
  const result = await sql`
    DELETE FROM jobs.dead_letter
    WHERE (${queue ?? null} IS NULL OR queue = ${queue ?? null})`;
  return result.count;
}

/**
 * Get dead letter queue summary.
 */
export async function getDeadLetterStats(
  sql: Sql,
): Promise<{ queue: string; count: number; oldest_failed_at: string | null }[]> {
  const rows = await sql<any[]>`
    SELECT queue, COUNT(*) as count, MIN(failed_at) as oldest_failed_at
    FROM jobs.dead_letter
    GROUP BY queue
    ORDER BY count DESC`;
  return rows.map(r => ({
    queue: r.queue,
    count: parseInt(r.count, 10),
    oldest_failed_at: r.oldest_failed_at,
  }));
}
