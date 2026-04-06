/**
 * Namespace transfer — move or copy memories between namespaces within
 * a workspace. Useful when promoting session memories to project-level
 * semantic memory after a session ends, or consolidating episodic memories
 * into a long-term memory namespace.
 */

import type { Sql } from "postgres";

export interface TransferOptions {
  sourceNamespace: string;
  targetNamespace: string;
  collectionId?: string; // only transfer from this collection
  memoryType?: string; // only transfer memories of this type
  minImportance?: number; // only transfer memories above this importance
  olderThanSeconds?: number; // only transfer memories older than this
  newerThanSeconds?: number; // only transfer memories newer than this
  deleteSource: boolean; // true = move, false = copy
  batchSize?: number; // process in batches (default 100)
  preserveImportance?: boolean; // if false, reset importance to 0.5 in target
  preserveTTL?: boolean; // if false, reset TTL in target namespace defaults
}

export interface TransferResult {
  transferredCount: number;
  sourceDeletedCount: number;
  skippedCount: number;
  targetCollectionId: string | null;
  errors: string[];
}

export interface MemoryTransferPreview {
  memoryId: string;
  content: string;
  importance: number;
  memoryType: string;
  createdAt: Date;
  expiresAt: Date | null;
  hasLinks: boolean;
  hasEmbedding: boolean;
}

/**
 * Preview what would be transferred — without actually transferring.
 */
export async function previewTransfer(
  sql: Sql,
  workspaceId: string,
  options: TransferOptions,
): Promise<MemoryTransferPreview[]> {
  const conditions: string[] = [];
  const params: any[] = [workspaceId];
  let paramIdx = 2;

  conditions.push(`m.workspace_id = $1`);
  conditions.push(`c.namespace = $${paramIdx++}`);
  params.push(options.sourceNamespace);

  if (options.collectionId) {
    conditions.push(`m.collection_id = $${paramIdx++}`);
    params.push(options.collectionId);
  }

  if (options.memoryType) {
    conditions.push(`m.memory_type = $${paramIdx++}`);
    params.push(options.memoryType);
  }

  if (options.minImportance !== undefined) {
    conditions.push(`m.importance >= $${paramIdx++}`);
    params.push(options.minImportance);
  }

  if (options.olderThanSeconds !== undefined) {
    conditions.push(`m.created_at < NOW() - INTERVAL '1 second' * $${paramIdx++}`);
    params.push(options.olderThanSeconds);
  }

  if (options.newerThanSeconds !== undefined) {
    conditions.push(`m.created_at > NOW() - INTERVAL '1 second' * $${paramIdx++}`);
    params.push(options.newerThanSeconds);
  }

  const whereClause = conditions.join(" AND ");

  const rows = await sql.unsafe(`
    SELECT
      m.id,
      LEFT(m.content, 200) AS content,
      m.importance,
      m.memory_type,
      m.created_at,
      m.expires_at,
      m.embedding IS NOT NULL AS has_embedding,
      EXISTS(SELECT 1 FROM memory.memory_links ml WHERE ml.target_memory_id = m.id OR ml.source_memory_id = m.id) AS has_links
    FROM memory.memories m
    JOIN memory.collections c ON c.id = m.collection_id
    WHERE ${whereClause}
    ORDER BY m.importance DESC, m.created_at ASC
    LIMIT 500
  `, params) as any[];

  return rows.map((r) => ({
    memoryId: r.id,
    content: r.content,
    importance: Number(r.importance),
    memoryType: r.memory_type,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    hasLinks: r.has_links,
    hasEmbedding: r.has_embedding,
  }));
}

/**
 * Transfer (move or copy) memories between namespaces.
 */
export async function transferMemories(
  sql: Sql,
  workspaceId: string,
  options: TransferOptions,
): Promise<TransferResult> {
  const errors: string[] = [];
  let transferredCount = 0;
  let sourceDeletedCount = 0;
  let skippedCount = 0;

  // Get or create target collection
  let targetCollectionId: string | null = null;
  const [existingCollection] = await sql<any[]>`
    SELECT id FROM memory.collections
    WHERE workspace_id = ${workspaceId} AND namespace = ${options.targetNamespace}
    LIMIT 1
  `;

  if (existingCollection) {
    targetCollectionId = existingCollection.id;
  } else {
    const [newCollection] = await sql<any[]>`
      INSERT INTO memory.collections (workspace_id, namespace, name, description)
      VALUES (${workspaceId}, ${options.targetNamespace}, ${options.targetNamespace}, 'Auto-created by namespace transfer')
      RETURNING id
    `;
    targetCollectionId = newCollection.id;
  }

  // Build query conditions
  const conditions: string[] = [];
  const params: any[] = [workspaceId];
  let paramIdx = 2;

  conditions.push(`m.workspace_id = $1`);
  conditions.push(`c.namespace = $${paramIdx++}`);
  params.push(options.sourceNamespace);

  if (options.collectionId) {
    conditions.push(`m.collection_id = $${paramIdx++}`);
    params.push(options.collectionId);
  }

  if (options.memoryType) {
    conditions.push(`m.memory_type = $${paramIdx++}`);
    params.push(options.memoryType);
  }

  if (options.minImportance !== undefined) {
    conditions.push(`m.importance >= $${paramIdx++}`);
    params.push(options.minImportance);
  }

  if (options.olderThanSeconds !== undefined) {
    conditions.push(`m.created_at < NOW() - INTERVAL '1 second' * $${paramIdx++}`);
    params.push(options.olderThanSeconds);
  }

  if (options.newerThanSeconds !== undefined) {
    conditions.push(`m.created_at > NOW() - INTERVAL '1 second' * $${paramIdx++}`);
    params.push(options.newerThanSeconds);
  }

  const whereClause = conditions.join(" AND ");
  const batchSize = options.batchSize ?? 100;

  // Process in batches
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const rows = await sql.unsafe(`
      SELECT m.id, m.collection_id
      FROM memory.memories m
      JOIN memory.collections c ON c.id = m.collection_id
      WHERE ${whereClause}
      ORDER BY m.importance DESC
      LIMIT ${batchSize} OFFSET ${offset}
    `, params) as any[];

    if (rows.length === 0) {
      hasMore = false;
      break;
    }

    for (const row of rows) {
      try {
        if (options.deleteSource) {
          // Move: update collection_id
          await sql`
            UPDATE memory.memories
            SET collection_id = ${targetCollectionId},
                updated_at = NOW()
            WHERE id = ${row.id}
          `;
          transferredCount++;
        } else {
          // Copy: insert new memory into target
          const [sourceMemory] = await sql<any[]>`
            SELECT * FROM memory.memories WHERE id = ${row.id}
          `;

          if (!sourceMemory) {
            skippedCount++;
            continue;
          }

          await sql`
            INSERT INTO memory.memories (
              workspace_id, user_id, collection_id, content, summary,
              importance, metadata, embedding_text, expires_at,
              memory_type, priority, ttl_seconds, is_pinned
            )
            VALUES (
              ${sourceMemory.workspace_id},
              ${sourceMemory.user_id},
              ${targetCollectionId},
              ${sourceMemory.content},
              ${sourceMemory.summary},
              ${options.preserveImportance !== false ? sourceMemory.importance : 0.5},
              ${sourceMemory.metadata},
              ${sourceMemory.embedding_text},
              ${options.preserveTTL !== false ? sourceMemory.expires_at : null},
              ${sourceMemory.memory_type},
              ${sourceMemory.priority},
              ${sourceMemory.ttl_seconds},
              ${sourceMemory.is_pinned}
            )
          `;
          transferredCount++;
        }
      } catch (err: any) {
        errors.push(`Failed to transfer memory ${row.id}: ${err.message}`);
        skippedCount++;
      }
    }

    offset += batchSize;
    if (rows.length < batchSize) {
      hasMore = false;
    }
  }

  // Delete from source if move
  if (options.deleteSource && transferredCount > 0) {
    const deleteConditions = [...conditions, `m.collection_id = target_collection_id`];
    const deleteParams = [...params];

    // Actually delete from source
    const deleted = await sql.unsafe(`
      DELETE FROM memory.memories m
      USING memory.collections target_collection
      WHERE m.collection_id = target_collection.id
        AND target_collection.namespace = $2
        AND ${whereClause.replace("$1", "$1").replace(`c.namespace = $2`, `target_collection.namespace = $2`)}
    `, deleteParams);

    sourceDeletedCount = deleted.count ?? 0;
  }

  return {
    transferredCount,
    sourceDeletedCount,
    skippedCount,
    targetCollectionId,
    errors,
  };
}

/**
 * Consolidate episodic memories into semantic — finds episodic memories
 * older than threshold and moves them to a semantic namespace.
 */
export async function consolidateEpisodicToSemantic(
  sql: Sql,
  workspaceId: string,
  olderThanHours: number = 24,
  targetNamespace: string = "semantic",
): Promise<TransferResult> {
  return transferMemories(sql, workspaceId, {
    sourceNamespace: "default",
    targetNamespace,
    memoryType: "episodic",
    olderThanSeconds: olderThanHours * 3600,
    deleteSource: false, // copy, don't delete
    preserveImportance: true,
    preserveTTL: false,
  });
}
