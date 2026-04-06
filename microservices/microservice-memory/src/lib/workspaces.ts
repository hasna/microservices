/**
 * Memory workspaces / multi-tenancy.
 * Allows sharing memories across workspaces with fine-grained permissions.
 */

import type { Sql } from "postgres";
import type { Memory } from "./memories.js";

export type WorkspacePermission = "read" | "write" | "admin";

export interface WorkspaceMemoryEntry {
  workspace_id: string;
  memory_id: string;
  added_by: string | null;
  added_at: Date;
  permissions: WorkspacePermission;
  memory: Memory;
}

export interface MemoryPermissions {
  workspace_id: string;
  permissions: WorkspacePermission;
  added_at: Date;
}

/**
 * Share a memory to another workspace with given permissions.
 */
export async function shareMemoryToWorkspace(
  sql: Sql,
  memoryId: string,
  targetWorkspaceId: string,
  permissions: WorkspacePermission = "read",
): Promise<void> {
  await sql`
    INSERT INTO memory.workspace_memories (workspace_id, memory_id, permissions)
    VALUES (${targetWorkspaceId}, ${memoryId}, ${permissions})
    ON CONFLICT (workspace_id, memory_id) DO UPDATE SET permissions = ${permissions}
  `;
}

/**
 * List all memories shared to a workspace.
 * Optionally filter by namespace.
 */
export async function listWorkspaceMemories(
  sql: Sql,
  workspaceId: string,
  namespace?: string,
): Promise<WorkspaceMemoryEntry[]> {
  if (namespace) {
    return sql.unsafe(`
      SELECT wm.workspace_id, wm.memory_id, wm.added_by, wm.added_at, wm.permissions, m.*
      FROM memory.workspace_memories wm
      JOIN memory.memories m ON m.id = wm.memory_id
      JOIN memory.collections c ON m.collection_id = c.id
      WHERE wm.workspace_id = $1 AND c.namespace = $2
      ORDER BY wm.added_at DESC
    `, [workspaceId, namespace]) as any;
  }
  return sql.unsafe(`
    SELECT wm.workspace_id, wm.memory_id, wm.added_by, wm.added_at, wm.permissions, m.*
    FROM memory.workspace_memories wm
    JOIN memory.memories m ON m.id = wm.memory_id
    WHERE wm.workspace_id = $1
    ORDER BY wm.added_at DESC
  `, [workspaceId]) as any;
}

/**
 * Revoke workspace access to a memory.
 */
export async function revokeWorkspaceMemoryAccess(
  sql: Sql,
  memoryId: string,
  workspaceId: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM memory.workspace_memories
    WHERE memory_id = ${memoryId} AND workspace_id = ${workspaceId}
  `;
  return (result.count ?? 0) > 0;
}

/**
 * Get all workspaces that have access to a memory, with their permission levels.
 */
export async function getMemoryPermissions(
  sql: Sql,
  memoryId: string,
): Promise<MemoryPermissions[]> {
  const rows = await sql`
    SELECT workspace_id, permissions, added_at
    FROM memory.workspace_memories
    WHERE memory_id = ${memoryId}
    ORDER BY added_at DESC
  `;
  return rows as MemoryPermissions[];
}
