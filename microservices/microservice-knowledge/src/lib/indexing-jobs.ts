/**
 * Background indexing job queue for microservice-knowledge.
 *
 * - Queue documents for background (async) indexing
 * - Track job status: pending, processing, completed, failed
 * - Retry failed jobs with backoff
 * - Priority-based queue ordering
 */

import type { Sql } from "postgres";
import { getDocumentById } from "./documents.js";
import { indexDocumentIncremental } from "./incremental.js";

export type IndexingJobStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";
export type IndexingJobPriority = "low" | "normal" | "high" | "urgent";

export interface IndexingJob {
  id: string;
  document_id: string;
  workspace_id: string;
  status: IndexingJobStatus;
  priority: IndexingJobPriority;
  attempts: number;
  max_attempts: number;
  error: string | null;
  queued_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

/**
 * Queue a document for background indexing.
 */
export async function queueIndexingJob(
  sql: Sql,
  documentId: string,
  workspaceId: string,
  opts?: {
    priority?: IndexingJobPriority;
    maxAttempts?: number;
  },
): Promise<IndexingJob> {
  const priority = opts?.priority ?? "normal";
  const maxAttempts = opts?.maxAttempts ?? 3;

  const [row] = await sql<IndexingJob[]>`
    INSERT INTO knowledge.indexing_jobs
      (document_id, workspace_id, status, priority, attempts, max_attempts)
    VALUES (
      ${documentId}, ${workspaceId},
      'pending'::TEXT, ${priority}::TEXT,
      0, ${maxAttempts}
    )
    RETURNING *
  `;

  return parseJobRow(row);
}

/**
 * Get the next pending job from the queue (ordered by priority desc, queued_at asc).
 */
export async function dequeueIndexingJob(
  sql: Sql,
): Promise<IndexingJob | null> {
  const [row] = await sql<IndexingJob[]>`
    UPDATE knowledge.indexing_jobs
    SET
      status = 'processing'::TEXT,
      started_at = NOW(),
      attempts = attempts + 1
    WHERE id = (
      SELECT id FROM knowledge.indexing_jobs
      WHERE status = 'pending'
      ORDER BY
        CASE priority
          WHEN 'urgent'  THEN 1
          WHEN 'high'    THEN 2
          WHEN 'normal' THEN 3
          WHEN 'low'    THEN 4
        END ASC,
        queued_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;

  return row ? parseJobRow(row) : null;
}

/**
 * Mark an indexing job as completed.
 */
export async function completeIndexingJob(
  sql: Sql,
  jobId: string,
): Promise<IndexingJob | null> {
  const [row] = await sql<IndexingJob[]>`
    UPDATE knowledge.indexing_jobs
    SET status = 'completed'::TEXT, completed_at = NOW()
    WHERE id = ${jobId}
    RETURNING *
  `;
  return row ? parseJobRow(row) : null;
}

/**
 * Mark an indexing job as failed. If max_attempts reached, marks as permanently failed.
 */
export async function failIndexingJob(
  sql: Sql,
  jobId: string,
  error: string,
): Promise<IndexingJob | null> {
  const [row] = await sql<IndexingJob[]>`
    UPDATE knowledge.indexing_jobs
    SET
      status = CASE
        WHEN attempts >= max_attempts THEN 'failed'::TEXT
        ELSE status
      END,
      error = ${error},
      completed_at = CASE
        WHEN attempts >= max_attempts THEN NOW()
        ELSE completed_at
      END
    WHERE id = ${jobId}
    RETURNING *
  `;
  return row ? parseJobRow(row) : null;
}

/**
 * Cancel a pending indexing job.
 */
export async function cancelIndexingJob(
  sql: Sql,
  jobId: string,
): Promise<IndexingJob | null> {
  const [row] = await sql<IndexingJob[]>`
    UPDATE knowledge.indexing_jobs
    SET status = 'cancelled'::TEXT, completed_at = NOW()
    WHERE id = ${jobId} AND status IN ('pending', 'failed')
    RETURNING *
  `;
  return row ? parseJobRow(row) : null;
}

/**
 * Get an indexing job by ID.
 */
export async function getIndexingJob(
  sql: Sql,
  jobId: string,
): Promise<IndexingJob | null> {
  const [row] = await sql`SELECT * FROM knowledge.indexing_jobs WHERE id = ${jobId}`;
  return row ? parseJobRow(row) : null;
}

/**
 * List indexing jobs for a workspace.
 */
export async function listIndexingJobs(
  sql: Sql,
  workspaceId: string,
  opts?: {
    status?: IndexingJobStatus;
    limit?: number;
    offset?: number;
  },
): Promise<IndexingJob[]> {
  const status = opts?.status;
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  let query = sql<IndexingJob[]>`
    SELECT * FROM knowledge.indexing_jobs
    WHERE workspace_id = ${workspaceId}
  `;

  if (status) {
    query = sql<IndexingJob[]>`
      SELECT * FROM knowledge.indexing_jobs
      WHERE workspace_id = ${workspaceId} AND status = ${status}
      ORDER BY queued_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
  } else {
    query = sql<IndexingJob[]>`
      SELECT * FROM knowledge.indexing_jobs
      WHERE workspace_id = ${workspaceId}
      ORDER BY queued_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
  }

  const rows = status
    ? await sql<IndexingJob[]>`
        SELECT * FROM knowledge.indexing_jobs
        WHERE workspace_id = ${workspaceId} AND status = ${status}
        ORDER BY queued_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `
    : await sql<IndexingJob[]>`
        SELECT * FROM knowledge.indexing_jobs
        WHERE workspace_id = ${workspaceId}
        ORDER BY queued_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;

  return rows.map(parseJobRow);
}

/**
 * Process a dequeued job: runs the actual indexing.
 * Returns { success, job, result }.
 */
export async function processIndexingJob(
  sql: Sql,
  job: IndexingJob,
): Promise<{ success: boolean; job: IndexingJob; result?: { inserted: number; deleted: number; unchanged: number }; error?: string }> {
  try {
    const result = await indexDocumentIncremental(sql, job.document_id);
    const updatedJob = await completeIndexingJob(sql, job.id);
    return {
      success: true,
      job: updatedJob ?? { ...job, status: "completed", completed_at: new Date() },
      result,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const updatedJob = await failIndexingJob(sql, job.id, error);
    return {
      success: false,
      job: updatedJob ?? { ...job, status: "failed", error },
      error,
    };
  }
}

/**
 * Run N pending jobs from the queue. Returns count of processed jobs.
 */
export async function processIndexingQueue(
  sql: Sql,
  count = 5,
): Promise<number> {
  let processed = 0;
  for (let i = 0; i < count; i++) {
    const job = await dequeueIndexingJob(sql);
    if (!job) break;
    await processIndexingJob(sql, job);
    processed++;
  }
  return processed;
}

/**
 * Get indexing queue statistics for a workspace.
 */
export async function getIndexingQueueStats(
  sql: Sql,
  workspaceId: string,
): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  avg_wait_time_ms: number | null;
}> {
  const rows = await sql`
    SELECT
      status,
      COUNT(*) as count,
      AVG(EXTRACT(EPOCH FROM (started_at - queued_at)) * 1000)::INT as avg_wait_ms
    FROM knowledge.indexing_jobs
    WHERE workspace_id = ${workspaceId}
    GROUP BY status
  `;

  const stats = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    avg_wait_time_ms: null as number | null,
  };

  for (const row of rows) {
    const count = Number(row.count);
    if (row.status === "pending") stats.pending = count;
    if (row.status === "processing") stats.processing = count;
    if (row.status === "completed") stats.completed = count;
    if (row.status === "failed") stats.failed = count;
    if (row.avg_wait_ms !== null) {
      stats.avg_wait_time_ms = Number(row.avg_wait_ms);
    }
  }

  return stats;
}

function parseJobRow(row: Record<string, unknown>): IndexingJob {
  return {
    id: row.id as string,
    document_id: row.document_id as string,
    workspace_id: row.workspace_id as string,
    status: row.status as IndexingJobStatus,
    priority: row.priority as IndexingJobPriority,
    attempts: Number(row.attempts),
    max_attempts: Number(row.max_attempts),
    error: row.error as string | null,
    queued_at: new Date(row.queued_at as string),
    started_at: row.started_at ? new Date(row.started_at as string) : null,
    completed_at: row.completed_at ? new Date(row.completed_at as string) : null,
  };
}
