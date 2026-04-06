/**
 * Incremental backup and restore for memories.
 * Export memories as JSON snapshots; import with conflict resolution.
 */

import type { Sql } from "postgres";

export type ConflictStrategy = "skip" | "overwrite" | "duplicate";

export interface SnapshotMetadata {
  exported_at: Date;
  workspace_id: string;
  namespace: string | null;
  total_count: number;
  namespace_breakdown: Record<string, number>;
  size_estimate_bytes: number;
}

export interface MemorySnapshot {
  workspace_id: string;
  collection_id: string | null;
  content: string;
  summary: string | null;
  importance: number;
  memory_type: string;
  priority: number;
  metadata: any;
  embedding_text: string | null;
  expires_at: Date | null;
  ttl_seconds: number;
  is_pinned: boolean;
  created_at: Date;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  overwritten: number;
  errors: string[];
}

/**
 * Export all memories for a workspace as a JSON snapshot.
 * Optionally filter by namespace.
 * Returns snapshot with metadata (no binary blobs).
 */
export async function exportMemorySnapshot(
  sql: Sql,
  workspaceId: string,
  namespace?: string,
): Promise<{ metadata: SnapshotMetadata; memories: MemorySnapshot[] }> {
  let query: string;
  let params: any[];

  if (namespace) {
    query = `
      SELECT
        m.workspace_id, m.collection_id, m.content, m.summary,
        m.importance, m.memory_type, m.priority, m.metadata,
        m.embedding_text, m.expires_at, m.ttl_seconds, m.is_pinned, m.created_at,
        c.namespace
      FROM memory.memories m
      JOIN memory.collections c ON m.collection_id = c.id
      WHERE m.workspace_id = $1 AND c.namespace = $2
      ORDER BY m.created_at DESC
    `;
    params = [workspaceId, namespace];
  } else {
    query = `
      SELECT
        m.workspace_id, m.collection_id, m.content, m.summary,
        m.importance, m.memory_type, m.priority, m.metadata,
        m.embedding_text, m.expires_at, m.ttl_seconds, m.is_pinned, m.created_at,
        c.namespace
      FROM memory.memories m
      JOIN memory.collections c ON m.collection_id = c.id
      WHERE m.workspace_id = $1
      ORDER BY m.created_at DESC
    `;
    params = [workspaceId];
  }

  const rows = await sql.unsafe(query, params) as any[];

  // Namespace breakdown
  const namespaceBreakdown: Record<string, number> = {};
  for (const row of rows) {
    const ns = row.namespace ?? "default";
    namespaceBreakdown[ns] = (namespaceBreakdown[ns] ?? 0) + 1;
  }

  // Size estimate: sum of content + metadata JSON sizes
  let sizeEstimate = 0;
  for (const row of rows) {
    sizeEstimate += Buffer.byteLength(row.content, "utf8");
    sizeEstimate += Buffer.byteLength(JSON.stringify(row.metadata ?? {}), "utf8");
  }

  const memories: MemorySnapshot[] = rows.map((row) => ({
    workspace_id: row.workspace_id,
    collection_id: row.collection_id,
    content: row.content,
    summary: row.summary,
    importance: row.importance,
    memory_type: row.memory_type,
    priority: row.priority,
    metadata: row.metadata,
    embedding_text: row.embedding_text,
    expires_at: row.expires_at,
    ttl_seconds: row.ttl_seconds,
    is_pinned: row.is_pinned,
    created_at: row.created_at,
  }));

  const metadata: SnapshotMetadata = {
    exported_at: new Date(),
    workspace_id: workspaceId,
    namespace: namespace ?? null,
    total_count: rows.length,
    namespace_breakdown: namespaceBreakdown,
    size_estimate_bytes: sizeEstimate,
  };

  return { metadata, memories };
}

/**
 * Get snapshot metadata without importing.
 */
export function getSnapshotInfo(snapshot: {
  metadata: SnapshotMetadata;
  memories: MemorySnapshot[];
}): SnapshotMetadata {
  return snapshot.metadata;
}

/**
 * Import a memory snapshot into a workspace.
 * conflictStrategy:
 *   'skip'    - skip memories whose ID already exists
 *   'overwrite' - update existing memories with same content/importance
 *   'duplicate' - always insert a new copy (new UUID)
 */
export async function importMemorySnapshot(
  sql: Sql,
  workspaceId: string,
  snapshot: { metadata: SnapshotMetadata; memories: MemorySnapshot[] },
  conflictStrategy: ConflictStrategy = "skip",
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skipped: 0, overwritten: 0, errors: [] };

  // Build a map of existing memory content hashes to IDs (for overwrite detection)
  const existingByContent = new Map<string, string>();
  if (conflictStrategy === "overwrite") {
    const existing = await sql.unsafe(`
      SELECT id, content, importance FROM memory.memories WHERE workspace_id = $1
    `, [workspaceId]) as any[];
    for (const row of existing) {
      const key = `${row.content}:${row.importance}`;
      existingByContent.set(key, row.id);
    }
  }

  for (const mem of snapshot.memories) {
    try {
      if (conflictStrategy === "skip") {
        // Check if exact content+importance combo exists
        const [existing] = await sql<any[]>`
          SELECT id FROM memory.memories
          WHERE workspace_id = ${workspaceId}
            AND content = ${mem.content}
            AND importance = ${mem.importance}
          LIMIT 1
        `;
        if (existing) {
          result.skipped++;
          continue;
        }
      }

      if (conflictStrategy === "overwrite") {
        const key = `${mem.content}:${mem.importance}`;
        const existingId = existingByContent.get(key);
        if (existingId) {
          await sql.unsafe(`
            UPDATE memory.memories
            SET summary = $1, metadata = $2, expires_at = $3, ttl_seconds = $4,
                priority = $5, is_pinned = $6, updated_at = NOW()
            WHERE id = $7
          `, [mem.summary, JSON.stringify(mem.metadata ?? {}), mem.expires_at, mem.ttl_seconds, mem.priority, mem.is_pinned, existingId]);
          result.overwritten++;
          continue;
        }
      }

      // Insert new memory (duplicate or new)
      const [newMem] = await sql<any[]>`
        INSERT INTO memory.memories
          (workspace_id, collection_id, content, summary, importance, memory_type, priority, metadata, embedding_text, expires_at, ttl_seconds, is_pinned)
        VALUES
          (${workspaceId}, ${mem.collection_id}, ${mem.content}, ${mem.summary ?? null},
           ${mem.importance}, ${mem.memory_type}, ${mem.priority}, ${sql.json(mem.metadata ?? {})},
           ${mem.embedding_text}, ${mem.expires_at}, ${mem.ttl_seconds}, ${mem.is_pinned})
        RETURNING id
      `;
      result.imported++;
    } catch (err: any) {
      result.errors.push(`Failed to import memory: ${err.message}`);
    }
  }

  return result;
}
