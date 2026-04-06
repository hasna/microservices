/**
 * Memory version diff — compare two versions of a memory to show what changed.
 */

import type { Sql } from "postgres";

export interface MemoryVersion {
  version_id: string;
  memory_id: string;
  content: string;
  importance: number;
  tags: string[];
  created_at: string;
}

export interface MemoryVersionDiff {
  memory_id: string;
  from_version: MemoryVersion | null;
  to_version: MemoryVersion | null;
  content_changed: boolean;
  importance_delta: number;
  tags_added: string[];
  tags_removed: string[];
  tag_changes: { added: string[]; removed: string[]; preserved: string[] };
}

export interface MemoryVersionList {
  versions: MemoryVersion[];
  total_count: number;
}

/**
 * Get a specific version of a memory.
 */
export async function getVersionDiff(
  sql: Sql,
  memoryId: string,
  versionId: string,
): Promise<MemoryVersion | null> {
  const [v] = await sql<{
    version_id: string;
    memory_id: string;
    content: string;
    importance: number;
    tags: string[];
    created_at: string;
  }[]>`
    SELECT
      v.id as version_id,
      v.memory_id,
      v.content,
      v.importance,
      v.tags,
      v.created_at
    FROM memory.memory_versions v
    WHERE v.memory_id = ${memoryId} AND v.id = ${versionId}
  `;

  return v ? formatVersion(v) : null;
}

/**
 * List all versions of a memory, newest first.
 */
export async function listVersionDiffs(
  sql: Sql,
  memoryId: string,
  limit = 20,
  offset = 0,
): Promise<MemoryVersionList> {
  const versions = await sql<{
    version_id: string;
    memory_id: string;
    content: string;
    importance: number;
    tags: string[];
    created_at: string;
  }[]>`
    SELECT
      v.id as version_id,
      v.memory_id,
      v.content,
      v.importance,
      v.tags,
      v.created_at
    FROM memory.memory_versions v
    WHERE v.memory_id = ${memoryId}
    ORDER BY v.created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  const [countResult] = await sql<[{ count: number }]>`
    SELECT COUNT(*)::int as count FROM memory.memory_versions WHERE memory_id = ${memoryId}
  `;

  return {
    versions: versions.map(formatVersion),
    total_count: countResult.count,
  };
}

/**
 * Compare two versions of a memory and return the diff.
 */
export async function diffMemoryVersions(
  sql: Sql,
  memoryId: string,
  fromVersionId: string,
  toVersionId: string,
): Promise<MemoryVersionDiff | null> {
  const [fromV] = await sql<any>`
    SELECT * FROM memory.memory_versions WHERE memory_id = ${memoryId} AND id = ${fromVersionId}
  `;
  const [toV] = await sql<any>`
    SELECT * FROM memory.memory_versions WHERE memory_id = ${memoryId} AND id = ${toVersionId}
  `;

  if (!fromV || !toV) return null;

  const fromVersion = formatVersion(fromV);
  const toVersion = formatVersion(toV);

  const contentChanged = fromVersion.content !== toVersion.content;
  const importanceDelta = toVersion.importance - fromVersion.importance;

  const fromTags = new Set(fromVersion.tags);
  const toTags = new Set(toVersion.tags);

  const tagsAdded = toVersion.tags.filter(t => !fromTags.has(t));
  const tagsRemoved = fromVersion.tags.filter(t => !toTags.has(t));
  const tagsPreserved = fromVersion.tags.filter(t => toTags.has(t));

  return {
    memory_id: memoryId,
    from_version: fromVersion,
    to_version: toVersion,
    content_changed: contentChanged,
    importance_delta: importanceDelta,
    tags_added: tagsAdded,
    tags_removed: tagsRemoved,
    tag_changes: {
      added: tagsAdded,
      removed: tagsRemoved,
      preserved: tagsPreserved,
    },
  };
}

/**
 * Get the diff between consecutive versions (version N vs N+1).
 */
export async function diffMemoryVersionConsecutive(
  sql: Sql,
  memoryId: string,
  versionId: string,
): Promise<MemoryVersionDiff | null> {
  const [v] = await sql<{ created_at: string }[]>`
    SELECT created_at FROM memory.memory_versions
    WHERE memory_id = ${memoryId} AND id = ${versionId}
  `;

  if (!v) return null;

  // Find the next older version
  const [nextV] = await sql<{ id: string }[]>`
    SELECT id FROM memory.memory_versions
    WHERE memory_id = ${memoryId} AND created_at < ${v.created_at}
    ORDER BY created_at DESC LIMIT 1
  `;

  if (!nextV) return null;

  return diffMemoryVersions(sql, memoryId, versionId, nextV.id);
}

/**
 * Get a summary of all changes across a memory's lifetime.
 */
export async function getMemoryVersionTimeline(
  sql: Sql,
  memoryId: string,
): Promise<{
  total_versions: number;
  content_change_count: number;
  importance_changes: { from: number; to: number; at: string }[];
  tag_history: { added: string; at: string }[];
}> {
  const versions = await sql<any[]>`
    SELECT * FROM memory.memory_versions
    WHERE memory_id = ${memoryId}
    ORDER BY created_at ASC
  `;

  let contentChangeCount = 0;
  const importanceChanges: { from: number; to: number; at: string }[] = [];
  const tagHistory: { added: string; at: string }[] = [];
  let prevContent = "";
  let prevImportance = 0;
  let prevTags: string[] = [];

  for (const v of versions) {
    if (v.content !== prevContent && prevContent !== "") {
      contentChangeCount++;
    }
    if (v.importance !== prevImportance && prevImportance !== 0) {
      importanceChanges.push({ from: prevImportance, to: v.importance, at: v.created_at });
    }
    const tags: string[] = v.tags ?? [];
    const added = tags.filter(t => !prevTags.includes(t));
    for (const tag of added) {
      tagHistory.push({ added: tag, at: v.created_at });
    }
    prevContent = v.content;
    prevImportance = v.importance;
    prevTags = tags;
  }

  return {
    total_versions: versions.length,
    content_change_count: contentChangeCount,
    importance_changes: importanceChanges,
    tag_history: tagHistory,
  };
}

function formatVersion(v: any): MemoryVersion {
  return {
    version_id: v.version_id,
    memory_id: v.memory_id,
    content: v.content,
    importance: Number(v.importance),
    tags: v.tags ?? [],
    created_at: v.created_at,
  };
}