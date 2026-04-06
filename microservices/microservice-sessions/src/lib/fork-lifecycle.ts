/**
 * Fork lifecycle management — tracks forks through their lifecycle states:
 *   active → archived → orphaned → promoted → deleted
 *
 * - active: fork is in use and accessible
 * - archived: fork has been explicitly archived by the user
 * - orphaned: parent session was deleted; fork exists independently
 * - promoted: fork was promoted to be a standalone session (merged back)
 * - deleted: fork was permanently deleted
 *
 * This enables intelligent fork retention: forks are kept based on
 * their importance, relationship to active sessions, and user intent.
 */

import type { Sql } from "postgres";

export type ForkLifecycleState = "active" | "archived" | "orphaned" | "promoted" | "deleted";

export interface ForkLifecycle {
  fork_id: string;
  parent_session_id: string | null;
  lifecycle_state: ForkLifecycleState;
  archived_at: string | null;
  deleted_at: string | null;
  promoted_to_session_id: string | null;
  preservation_reason: string | null;
  last_accessed_at: string;
  created_at: string;
}

export interface TransitionForkStateOpts {
  newState: ForkLifecycleState;
  preservationReason?: string;
  promotedToSessionId?: string;
}

/**
 * Get the lifecycle record for a fork.
 */
export async function getForkLifecycle(
  sql: Sql,
  forkId: string,
): Promise<ForkLifecycle | null> {
  const [row] = await sql<ForkLifecycle[]>`
    SELECT * FROM sessions.fork_lifecycle WHERE fork_id = ${forkId}
  `;
  return row ?? null;
}

/**
 * Create or update the lifecycle record when a fork is created.
 */
export async function initForkLifecycle(
  sql: Sql,
  forkId: string,
  parentSessionId: string | null,
): Promise<ForkLifecycle> {
  const [row] = await sql<ForkLifecycle[]>`
    INSERT INTO sessions.fork_lifecycle (fork_id, parent_session_id, lifecycle_state, last_accessed_at)
    VALUES (${forkId}, ${parentSessionId}, 'active', NOW())
    ON CONFLICT (fork_id) DO UPDATE SET
      parent_session_id = COALESCE(fork_lifecycle.parent_session_id, EXCLUDED.parent_session_id),
      lifecycle_state = COALESCE(
        NULLIF(fork_lifecycle.lifecycle_state, 'deleted'),
        'active'
      ),
      last_accessed_at = NOW()
    RETURNING *
  `;
  return row;
}

/**
 * Transition a fork to a new lifecycle state.
 */
export async function transitionForkState(
  sql: Sql,
  forkId: string,
  opts: TransitionForkStateOpts,
): Promise<ForkLifecycle | null> {
  const stateUpdates: Partial<ForkLifecycle> = {
    lifecycle_state: opts.newState,
    last_accessed_at: new Date().toISOString() as any,
  };

  if (opts.newState === "archived") {
    (stateUpdates as any).archived_at = sql`NOW()`;
  }
  if (opts.newState === "deleted") {
    (stateUpdates as any).deleted_at = sql`NOW()`;
  }
  if (opts.newState === "promoted") {
    (stateUpdates as any).promoted_to_session_id = opts.promotedToSessionId ?? null;
  }
  if (opts.preservationReason) {
    stateUpdates.preservation_reason = opts.preservationReason;
  }

  const setClauses: string[] = [];
  const values: any[] = [];
  let idx = 1;

  for (const [key, val] of Object.entries(stateUpdates)) {
    if (key === "last_accessed_at" || key === "archived_at" || key === "deleted_at") {
      setClauses.push(`${key} = ${val}`);
    } else if (key === "promoted_to_session_id") {
      setClauses.push(`promoted_to_session_id = $${idx++}`);
      values.push(opts.promotedToSessionId ?? null);
    } else if (key === "preservation_reason") {
      setClauses.push(`preservation_reason = $${idx++}`);
      values.push(opts.preservationReason ?? null);
    } else {
      setClauses.push(`${key} = $${idx++}`);
      values.push(val);
    }
  }
  setClauses.push("last_accessed_at = NOW()");

  const [row] = await sql<ForkLifecycle[]>`
    UPDATE sessions.fork_lifecycle
    SET ${sql.unsafe(setClauses.join(", "))}
    WHERE fork_id = ${forkId}
    RETURNING *
  `;
  return row ?? null;
}

/**
 * Archive a fork (explicit user action).
 */
export async function archiveFork(
  sql: Sql,
  forkId: string,
  reason?: string,
): Promise<ForkLifecycle | null> {
  return transitionForkState(sql, forkId, { newState: "archived", preservationReason: reason });
}

/**
 * Delete a fork permanently.
 */
export async function deleteFork(
  sql: Sql,
  forkId: string,
): Promise<ForkLifecycle | null> {
  return transitionForkState(sql, forkId, { newState: "deleted" });
}

/**
 * Promote a fork to be a standalone session (merge it back or treat as independent).
 */
export async function promoteFork(
  sql: Sql,
  forkId: string,
  newSessionId: string,
): Promise<ForkLifecycle | null> {
  return transitionForkState(sql, forkId, {
    newState: "promoted",
    promotedToSessionId: newSessionId,
  });
}

/**
 * Mark forks as orphaned when their parent session is deleted.
 */
export async function orphanChildForks(
  sql: Sql,
  parentSessionId: string,
): Promise<number> {
  const result = await sql`
    UPDATE sessions.fork_lifecycle
    SET lifecycle_state = 'orphaned',
        last_accessed_at = NOW()
    WHERE parent_session_id = ${parentSessionId}
      AND lifecycle_state = 'active'
  `;
  return result.count ?? 0;
}

/**
 * Record a fork access (updates last_accessed_at).
 */
export async function recordForkAccess(
  sql: Sql,
  forkId: string,
): Promise<void> {
  await sql`
    UPDATE sessions.fork_lifecycle
    SET last_accessed_at = NOW()
    WHERE fork_id = ${forkId}
  `;
}

/**
 * List forks by lifecycle state.
 */
export async function listForksByState(
  sql: Sql,
  workspaceId: string,
  state: ForkLifecycleState,
  opts: { limit?: number; offset?: number } = {},
): Promise<ForkLifecycle[]> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  return sql<ForkLifecycle[]>`
    SELECT fl.* FROM sessions.fork_lifecycle fl
    JOIN sessions.conversations c ON c.id = fl.fork_id
    WHERE c.workspace_id = ${workspaceId}
      AND fl.lifecycle_state = ${state}
    ORDER BY fl.last_accessed_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}

/**
 * List orphaned forks (parent deleted) that haven't been accessed recently.
 */
export async function listStaleOrphanedForks(
  sql: Sql,
  workspaceId: string,
  staleDays = 30,
): Promise<ForkLifecycle[]> {
  return sql<ForkLifecycle[]>`
    SELECT fl.* FROM sessions.fork_lifecycle fl
    JOIN sessions.conversations c ON c.id = fl.fork_id
    WHERE c.workspace_id = ${workspaceId}
      AND fl.lifecycle_state = 'orphaned'
      AND fl.last_accessed_at < NOW() - INTERVAL '${sql.unsafe(String(staleDays))} days'
    ORDER BY fl.last_accessed_at ASC
  `;
}

/**
 * Get fork statistics for a workspace.
 */
export async function getForkStats(
  sql: Sql,
  workspaceId: string,
): Promise<Record<ForkLifecycleState, number>> {
  const rows = await sql<{ lifecycle_state: ForkLifecycleState; count: number }[]>`
    SELECT fl.lifecycle_state, COUNT(*)::int as count
    FROM sessions.fork_lifecycle fl
    JOIN sessions.conversations c ON c.id = fl.fork_id
    WHERE c.workspace_id = ${workspaceId}
    GROUP BY fl.lifecycle_state
  `;

  const stats: Record<ForkLifecycleState, number> = {
    active: 0,
    archived: 0,
    orphaned: 0,
    promoted: 0,
    deleted: 0,
  };
  for (const row of rows) {
    stats[row.lifecycle_state] = row.count;
  }
  return stats;
}
