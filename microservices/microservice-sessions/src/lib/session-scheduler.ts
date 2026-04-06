/**
 * Session scheduled archival — creates and processes scheduled archival tasks
 * for sessions. Supports archive, delete, snapshot_then_delete, and summarize
 * actions at specified times.
 *
 * Scheduled archivals are created by retention policies or explicitly by users
 * and processed by a background worker (not part of this module — the worker
 * should call processScheduledArchivals() periodically).
 */

import type { Sql } from "postgres";

export type ScheduledAction = "archive" | "delete" | "snapshot_then_delete" | "summarize";
export type ScheduledStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled";

export interface ScheduledArchival {
  id: string;
  session_id: string;
  scheduled_for: string;
  action: ScheduledAction;
  status: ScheduledStatus;
  retention_policy_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CreateScheduledArchivalOpts {
  sessionId: string;
  scheduledFor: Date;
  action: ScheduledAction;
  retentionPolicyId?: string;
}

/**
 * Create a scheduled archival task.
 */
export async function createScheduledArchival(
  sql: Sql,
  opts: CreateScheduledArchivalOpts,
): Promise<ScheduledArchival> {
  const [row] = await sql<ScheduledArchival[]>`
    INSERT INTO sessions.scheduled_archivals (
      session_id, scheduled_for, action, retention_policy_id
    )
    VALUES (
      ${opts.sessionId},
      ${opts.scheduledFor},
      ${opts.action},
      ${opts.retentionPolicyId ?? null}
    )
    RETURNING *
  `;
  return row;
}

/**
 * Cancel a scheduled archival.
 */
export async function cancelScheduledArchival(
  sql: Sql,
  archivalId: string,
): Promise<boolean> {
  const [row] = await sql<ScheduledArchival[]>`
    UPDATE sessions.scheduled_archivals
    SET status = 'cancelled', updated_at = NOW()
    WHERE id = ${archivalId} AND status = 'pending'
    RETURNING *
  `;
  return !!row;
}

/**
 * Get a scheduled archival by ID.
 */
export async function getScheduledArchival(
  sql: Sql,
  archivalId: string,
): Promise<ScheduledArchival | null> {
  const [row] = await sql<ScheduledArchival[]>`
    SELECT * FROM sessions.scheduled_archivals WHERE id = ${archivalId}
  `;
  return row ?? null;
}

/**
 * List pending archivals that are due (scheduled_for <= now).
 */
export async function listDueArchivals(
  sql: Sql,
  limit = 50,
): Promise<ScheduledArchival[]> {
  return sql<ScheduledArchival[]>`
    SELECT * FROM sessions.scheduled_archivals
    WHERE status = 'pending'
      AND scheduled_for <= NOW()
    ORDER BY scheduled_for ASC
    LIMIT ${limit}
  `;
}

/**
 * List all pending archivals for a session.
 */
export async function listPendingArchivalsForSession(
  sql: Sql,
  sessionId: string,
): Promise<ScheduledArchival[]> {
  return sql<ScheduledArchival[]>`
    SELECT * FROM sessions.scheduled_archivals
    WHERE session_id = ${sessionId}
      AND status = 'pending'
    ORDER BY scheduled_for ASC
  `;
}

/**
 * Mark a scheduled archival as in-progress.
 */
export async function startArchival(
  sql: Sql,
  archivalId: string,
): Promise<boolean> {
  const [row] = await sql<ScheduledArchival[]>`
    UPDATE sessions.scheduled_archivals
    SET status = 'in_progress', updated_at = NOW()
    WHERE id = ${archivalId} AND status = 'pending'
    RETURNING *
  `;
  return !!row;
}

/**
 * Mark a scheduled archival as completed.
 */
export async function completeArchival(
  sql: Sql,
  archivalId: string,
): Promise<boolean> {
  const [row] = await sql<ScheduledArchival[]>`
    UPDATE sessions.scheduled_archivals
    SET status = 'completed', updated_at = NOW(), completed_at = NOW()
    WHERE id = ${archivalId} AND status = 'in_progress'
    RETURNING *
  `;
  return !!row;
}

/**
 * Mark a scheduled archival as failed with an error message.
 */
export async function failArchival(
  sql: Sql,
  archivalId: string,
  errorMessage: string,
): Promise<boolean> {
  const [row] = await sql<ScheduledArchival[]>`
    UPDATE sessions.scheduled_archivals
    SET status = 'failed', updated_at = NOW(), error_message = ${errorMessage}
    WHERE id = ${archivalId} AND status = 'in_progress'
    RETURNING *
  `;
  return !!row;
}

/**
 * Process a scheduled archival — executes the action (archive/delete/snapshot_then_delete/summarize).
 * Returns the updated archival record.
 */
export async function processScheduledArchival(
  sql: Sql,
  archivalId: string,
  opts: {
    archiveConversation: (sql: Sql, id: string) => Promise<void>;
    deleteConversation: (sql: Sql, id: string) => Promise<void>;
    createSnapshot: (sql: Sql, id: string, label: string) => Promise<void>;
    summarizeSession: (sql: Sql, id: string) => Promise<void>;
  },
): Promise<ScheduledArchival | null> {
  const started = await startArchival(sql, archivalId);
  if (!started) return null;

  const archival = await getScheduledArchival(sql, archivalId);
  if (!archival) return null;

  try {
    switch (archival.action) {
      case "archive":
        await opts.archiveConversation(sql, archival.session_id);
        break;
      case "delete":
        await opts.deleteConversation(sql, archival.session_id);
        break;
      case "snapshot_then_delete":
        await opts.createSnapshot(sql, archival.session_id, "auto-snapshot-before-delete");
        await opts.deleteConversation(sql, archival.session_id);
        break;
      case "summarize":
        await opts.summarizeSession(sql, archival.session_id);
        break;
    }
    await completeArchival(sql, archivalId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failArchival(sql, archivalId, message);
  }

  return getScheduledArchival(sql, archivalId);
}

/**
 * Reschedule an archival to a new time.
 */
export async function rescheduleArchival(
  sql: Sql,
  archivalId: string,
  newScheduledFor: Date,
): Promise<ScheduledArchival | null> {
  const [row] = await sql<ScheduledArchival[]>`
    UPDATE sessions.scheduled_archivals
    SET scheduled_for = ${newScheduledFor},
        status = 'pending',
        updated_at = NOW(),
        error_message = NULL
    WHERE id = ${archivalId}
      AND status IN ('pending', 'failed', 'cancelled')
    RETURNING *
  `;
  return row ?? null;
}

/**
 * Schedule archival for all sessions matching a retention policy.
 * Creates scheduled_archivals records for sessions that meet the policy's conditions.
 */
export async function scheduleArchivalsForPolicy(
  sql: Sql,
  policyId: string,
  opts: {
    action: ScheduledAction;
    minAgeDays: number;
    maxAgeDays?: number;
    workspaceId?: string;
    userId?: string;
    dryRun?: boolean;
  },
): Promise<{ scheduled: number; sessionIds: string[] }> {
  const sessions = await sql<{ id: string }[]>`
    SELECT c.id FROM sessions.conversations c
    LEFT JOIN sessions.session_importance si ON si.session_id = c.id
    WHERE c.is_archived = FALSE
      AND c.is_pinned = FALSE
      AND c.is_fork_pinned = FALSE
      AND (${opts.workspaceId ? sql`c.workspace_id = ${opts.workspaceId}` : sql`TRUE`})
      AND (${opts.userId ? sql`c.user_id = ${opts.userId}` : sql`TRUE`})
      AND c.created_at < NOW() - INTERVAL '${sql.unsafe(String(opts.minAgeDays))} days'
      AND (${opts.maxAgeDays
        ? sql`c.created_at > NOW() - INTERVAL '${sql.unsafe(String(opts.maxAgeDays))} days'`
        : sql`TRUE`})
      AND (${opts.action !== 'summarize' ? sql`c.summary IS NULL` : sql`TRUE`})
      AND c.id NOT IN (
        SELECT session_id FROM sessions.scheduled_archivals
        WHERE status IN ('pending', 'in_progress')
      )
  `;

  const sessionIds = sessions.map(s => s.id);

  if (opts.dryRun) {
    return { scheduled: 0, sessionIds };
  }

  // Schedule each session for archival 1 hour from now
  const scheduledFor = new Date(Date.now() + 60 * 60 * 1000);
  for (const { id } of sessions) {
    await createScheduledArchival(sql, {
      sessionId: id,
      scheduledFor,
      action: opts.action,
      retentionPolicyId: policyId,
    });
  }

  return { scheduled: sessionIds.length, sessionIds };
}

/**
 * Count archivals by status for a workspace.
 */
export async function getArchivalStats(
  sql: Sql,
  workspaceId?: string,
): Promise<Record<ScheduledStatus, number>> {
  const rows = await sql<{ status: ScheduledStatus; count: number }[]>`
    SELECT sa.status, COUNT(*)::int as count
    FROM sessions.scheduled_archivals sa
    JOIN sessions.conversations c ON c.id = sa.session_id
    WHERE ${workspaceId ? sql`c.workspace_id = ${workspaceId}` : sql`TRUE`}
    GROUP BY sa.status
  `;

  const stats: Record<ScheduledStatus, number> = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const row of rows) {
    stats[row.status] = row.count;
  }
  return stats;
}
