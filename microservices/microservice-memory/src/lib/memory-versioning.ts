/**
 * Memory versioning — track version history of memory content changes.
 */

import type { Sql } from "postgres";

export interface MemoryVersion {
  id: string;
  memory_id: string;
  version_number: number;
  content: string;
  summary: string | null;
  importance: number;
  memory_type: string;
  changed_by: string | null;
  changed_at: string;
  change_reason: string | null;
}

export interface CreateVersionOptions {
  memoryId: string;
  content: string;
  summary?: string;
  importance: number;
  memoryType: string;
  changedBy?: string;
  changeReason?: string;
}

/**
 * Create a new version entry for a memory (called before update).
 */
export async function createMemoryVersion(
  sql: Sql,
  opts: CreateVersionOptions,
): Promise<MemoryVersion> {
  const [existing] = await sql<{ id: string; version_number: number }[]>`
    SELECT id, version_number
    FROM memory.memory_versions
    WHERE memory_id = ${opts.memoryId}
    ORDER BY version_number DESC
    LIMIT 1
  `;
  const nextVersion = existing ? existing.version_number + 1 : 1;

  const [version] = await sql<MemoryVersion[]>`
    INSERT INTO memory.memory_versions (
      memory_id, version_number, content, summary,
      importance, memory_type, changed_by, change_reason
    )
    VALUES (
      ${opts.memoryId}, ${nextVersion}, ${opts.content},
      ${opts.summary ?? null}, ${opts.importance}, ${opts.memoryType},
      ${opts.changedBy ?? null}, ${opts.changeReason ?? null}
    )
    RETURNING
      id, memory_id, version_number, content, summary,
      importance::text, memory_type, changed_by,
      changed_at::text, change_reason
  `;
  return version;
}

/**
 * Get all versions of a memory.
 */
export async function getMemoryVersions(
  sql: Sql,
  memoryId: string,
  limit = 20,
): Promise<MemoryVersion[]> {
  return sql<MemoryVersion[]>`
    SELECT id, memory_id, version_number, content, summary,
           importance::text, memory_type, changed_by,
           changed_at::text, change_reason
    FROM memory.memory_versions
    WHERE memory_id = ${memoryId}
    ORDER BY version_number DESC
    LIMIT ${limit}
  `;
}

/**
 * Get a specific version of a memory.
 */
export async function getMemoryVersion(
  sql: Sql,
  memoryId: string,
  versionNumber: number,
): Promise<MemoryVersion | null> {
  const [version] = await sql<MemoryVersion[]>`
    SELECT id, memory_id, version_number, content, summary,
           importance::text, memory_type, changed_by,
           changed_at::text, change_reason
    FROM memory.memory_versions
    WHERE memory_id = ${memoryId}
      AND version_number = ${versionNumber}
  `;
  return version ?? null;
}

/**
 * Restore a memory to a previous version.
 */
export async function restoreMemoryVersion(
  sql: Sql,
  memoryId: string,
  versionNumber: number,
  restoredBy?: string,
): Promise<{ restored: boolean; new_version: number }> {
  const version = await getMemoryVersion(sql, memoryId, versionNumber);
  if (!version) return { restored: false, new_version: 0 };

  const [existing] = await sql<{ id: string; version_number: number }[]>`
    SELECT id, version_number
    FROM memory.memory_versions
    WHERE memory_id = ${memoryId}
    ORDER BY version_number DESC
    LIMIT 1
  `;
  const nextVersion = existing ? existing.version_number + 1 : 1;

  // Update the current memory with the old version's content
  await sql`
    UPDATE memory.memories
    SET content = ${version.content},
        summary = ${version.summary},
        importance = ${parseFloat(version.importance)},
        memory_type = ${version.memory_type},
        updated_at = NOW()
    WHERE id = ${memoryId}
  `;

  // Record this restore as a new version
  await sql`
    INSERT INTO memory.memory_versions (
      memory_id, version_number, content, summary,
      importance, memory_type, changed_by, change_reason
    )
    VALUES (
      ${memoryId}, ${nextVersion}, ${version.content},
      ${version.summary}, ${parseFloat(version.importance)}, ${version.memory_type},
      ${restoredBy ?? null}, ${`Restored from version ${versionNumber}`}
    )
  `;

  return { restored: true, new_version: nextVersion };
}

/**
 * Compare two versions of a memory.
 */
export async function compareMemoryVersions(
  sql: Sql,
  memoryId: string,
  versionA: number,
  versionB: number,
): Promise<{
  version_a: MemoryVersion | null;
  version_b: MemoryVersion | null;
  content_changed: boolean;
  summary_changed: boolean;
  importance_changed: boolean;
  type_changed: boolean;
}> {
  const [vA, vB] = await Promise.all([
    getMemoryVersion(sql, memoryId, versionA),
    getMemoryVersion(sql, memoryId, versionB),
  ]);

  return {
    version_a: vA,
    version_b: vB,
    content_changed: vA?.content !== vB?.content,
    summary_changed: vA?.summary !== vB?.summary,
    importance_changed: vA?.importance !== vB?.importance,
    type_changed: vA?.memory_type !== vB?.memory_type,
  };
}

/**
 * Get version count for a memory.
 */
export async function getMemoryVersionCount(
  sql: Sql,
  memoryId: string,
): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*) as count FROM memory.memory_versions
    WHERE memory_id = ${memoryId}
  `;
  return row?.count ?? 0;
}

/**
 * Prune old versions, keeping only the last N versions.
 */
export async function pruneMemoryVersions(
  sql: Sql,
  memoryId: string,
  keepLast = 10,
): Promise<number> {
  const result = await sql`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY version_number DESC) as rn
      FROM memory.memory_versions
      WHERE memory_id = ${memoryId}
    )
    DELETE FROM memory.memory_versions
    WHERE id IN (
      SELECT id FROM ranked WHERE rn > ${keepLast}
    )
    RETURNING id
  `;
  return result.count;
}
