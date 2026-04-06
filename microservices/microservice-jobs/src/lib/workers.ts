import type { Sql } from "postgres";

export interface Worker {
  id: string;
  worker_id: string;
  name: string | null;
  queues: string[];
  status: string;
  last_seen_at: string;
  registered_at: string;
  metadata: any;
}

/**
 * Register a new worker.
 */
export async function registerWorker(
  sql: Sql,
  data: { workerId: string; name?: string; queues?: string[]; metadata?: any },
): Promise<Worker> {
  const [w] = await sql<Worker[]>`
    INSERT INTO jobs.workers (worker_id, name, queues, metadata)
    VALUES (${data.workerId}, ${data.name ?? null}, ${data.queues ?? ["default"]},
            ${JSON.stringify(data.metadata ?? {})})
    ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = NOW(), status = 'alive'
    RETURNING *`;
  return w;
}

/**
 * Heartbeat — update last_seen_at. Marks dead workers (no heartbeat > 60s) as dead.
 */
export async function heartbeatWorker(
  sql: Sql,
  workerId: string,
): Promise<{ alive: boolean; was_dead: boolean }> {
  const cutoff = new Date(Date.now() - 60000).toISOString();
  const [existing] = await sql<[{ status: string } | undefined]>`SELECT status FROM jobs.workers WHERE worker_id = ${workerId}`;
  const wasDead = existing?.status === "dead";
  await sql`UPDATE jobs.workers SET last_seen_at = NOW(), status = 'alive' WHERE worker_id = ${workerId}`;
  // Mark stale workers as dead
  await sql`UPDATE jobs.workers SET status = 'dead' WHERE last_seen_at < ${cutoff} AND status = 'alive'`;
  return { alive: true, was_dead: wasDead };
}

/**
 * Deregister a worker.
 */
export async function deregisterWorker(
  sql: Sql,
  workerId: string,
): Promise<boolean> {
  const r = await sql`DELETE FROM jobs.workers WHERE worker_id = ${workerId}`;
  return r.count > 0;
}

/**
 * List active workers.
 */
export async function listWorkers(
  sql: Sql,
  opts?: { queue?: string; status?: string },
): Promise<Worker[]> {
  return sql<Worker[]>`
    SELECT * FROM jobs.workers
    WHERE (${opts?.status ?? null} IS NULL OR status = ${opts?.status ?? null})
      AND (${opts?.queue ?? null} IS NULL OR ${opts?.queue} = ANY(queues))
    ORDER BY last_seen_at DESC`;
}

/**
 * Mark a worker as dead (e.g., on unexpected shutdown).
 */
export async function markWorkerDead(
  sql: Sql,
  workerId: string,
): Promise<boolean> {
  const r = await sql`UPDATE jobs.workers SET status = 'dead' WHERE worker_id = ${workerId}`;
  return r.count > 0;
}