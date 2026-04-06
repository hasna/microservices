/**
 * Fork pinning — allow users to explicitly pin important forks so they
 * are protected from automatic archival or cleanup policies.
 *
 * Unlike the conversation-level `is_fork_pinned` flag (which protects an
 * individual fork from being auto-archived), this module tracks explicit
 * pin records with metadata: who pinned it, when, and why.
 */

import type { Sql } from "postgres";

export interface ForkPin {
  fork_id: string;
  pinned_by: string | null;      // user_id of the person who pinned it
  pinned_at: string;             // ISO timestamp
  pin_note: string | null;       // optional reason/note
  auto_protect: boolean;         // if true, fork is protected from ALL auto-policies
}

export interface PinForkOpts {
  pinnedBy?: string | null;
  pinNote?: string | null;
  autoProtect?: boolean;
}

export interface UnpinForkOpts {
  pinNote?: string | null;
}

/**
 * Pin a fork so it cannot be auto-archived or auto-deleted.
 * If the fork is already pinned, updates the metadata.
 */
export async function pinFork(
  sql: Sql,
  forkId: string,
  opts: PinForkOpts = {},
): Promise<ForkPin> {
  const { pinnedBy = null, pinNote = null, autoProtect = true } = opts;

  const [row] = await sql<ForkPin[]>`
    INSERT INTO sessions.fork_pins (fork_id, pinned_by, pin_note, auto_protect)
    VALUES (${forkId}, ${pinnedBy}, ${pinNote}, ${autoProtect})
    ON CONFLICT (fork_id) DO UPDATE SET
      pinned_by   = COALESCE(EXCLUDED.pinned_by, fork_pins.pinned_by),
      pin_note    = COALESCE(EXCLUDED.pin_note, fork_pins.pin_note),
      auto_protect = EXCLUDED.auto_protect,
      pinned_at   = NOW()
    RETURNING *
  `;
  return row;
}

/**
 * Remove the pin from a fork. The fork then follows normal lifecycle policies.
 */
export async function unpinFork(
  sql: Sql,
  forkId: string,
  opts: UnpinForkOpts = {},
): Promise<boolean> {
  const { pinNote = null } = opts;
  const result = await sql`
    DELETE FROM sessions.fork_pins
    WHERE fork_id = ${forkId}
  `;
  return (result.count ?? 0) > 0;
}

/**
 * Check if a fork is currently pinned.
 */
export async function isForkPinned(
  sql: Sql,
  forkId: string,
): Promise<boolean> {
  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM sessions.fork_pins WHERE fork_id = ${forkId}
  `;
  return (row?.count ?? 0) > 0;
}

/**
 * Get the pin record for a fork.
 */
export async function getForkPin(
  sql: Sql,
  forkId: string,
): Promise<ForkPin | null> {
  const [row] = await sql<ForkPin[]>`
    SELECT * FROM sessions.fork_pins WHERE fork_id = ${forkId}
  `;
  return row ?? null;
}

/**
 * List all pinned forks for a workspace.
 */
export async function listPinnedForks(
  sql: Sql,
  workspaceId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<(ForkPin & { title: string | null; parent_id: string | null })[]> {
  const { limit = 50, offset = 0 } = opts;

  return sql`
    SELECT fp.*, c.title, c.parent_id
    FROM sessions.fork_pins fp
    JOIN sessions.conversations c ON c.id = fp.fork_id
    WHERE c.workspace_id = ${workspaceId}
    ORDER BY fp.pinned_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}

/**
 * List forks that are pinned for a specific user.
 */
export async function listPinnedForksByUser(
  sql: Sql,
  workspaceId: string,
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<ForkPin[]> {
  const { limit = 50, offset = 0 } = opts;

  return sql<ForkPin[]>`
    SELECT fp.*
    FROM sessions.fork_pins fp
    JOIN sessions.conversations c ON c.id = fp.fork_id
    WHERE c.workspace_id = ${workspaceId}
      AND fp.pinned_by = ${userId}
    ORDER BY fp.pinned_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}

/**
 * Count total pinned forks in a workspace.
 */
export async function countPinnedForks(
  sql: Sql,
  workspaceId: string,
): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int as count
    FROM sessions.fork_pins fp
    JOIN sessions.conversations c ON c.id = fp.fork_id
    WHERE c.workspace_id = ${workspaceId}
  `;
  return row?.count ?? 0;
}

/**
 * Bulk pin multiple forks at once. Returns count of successfully pinned forks.
 */
export async function bulkPinForks(
  sql: Sql,
  forkIds: string[],
  opts: PinForkOpts = {},
): Promise<number> {
  if (forkIds.length === 0) return 0;
  let pinned = 0;
  for (const forkId of forkIds) {
    await pinFork(sql, forkId, opts);
    pinned++;
  }
  return pinned;
}

/**
 * Get full pin metadata including fork details (title, created_at, parent).
 */
export async function getPinDetails(
  sql: Sql,
  forkId: string,
): Promise<(ForkPin & { title: string | null; parent_id: string | null; fork_created_at: string }) | null> {
  const [row] = await sql`
    SELECT fp.*, c.title, c.parent_id, c.created_at AS fork_created_at
    FROM sessions.fork_pins fp
    JOIN sessions.conversations c ON c.id = fp.fork_id
    WHERE fp.fork_id = ${forkId}
  `;
  return row ?? null;
}
