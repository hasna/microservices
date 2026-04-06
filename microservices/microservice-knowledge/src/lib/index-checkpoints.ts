/**
 * Incremental indexing checkpoints — track per-document indexed versions
 * to enable chunk-level delta updates instead of full re-index.
 */

import type { Sql } from "postgres";

export interface IndexCheckpoint {
  id: string;
  documentId: string;
  version: number;
  contentHash: string;
  chunkCount: number;
  totalTokens: number;
  indexedAt: Date;
}

export interface DeltaChunk {
  id: string;
  checkpointId: string;
  chunkId: string | null;
  deltaType: "insert" | "update" | "delete";
  chunkSequence: number;
  oldContentHash: string | null;
  newContentHash: string | null;
  createdAt: Date;
}

/**
 * Create an index checkpoint after a successful full index.
 */
export async function createIndexCheckpoint(
  sql: Sql,
  documentId: string,
  contentHash: string,
  chunkCount: number,
  totalTokens: number,
): Promise<IndexCheckpoint> {
  // Increment version for this document
  const [latest] = await sql<{ max_version: number }[]>`
    SELECT COALESCE(MAX(version), 0) as max_version
    FROM knowledge.index_checkpoints
    WHERE document_id = ${documentId}
  `;
  const nextVersion = Number(latest?.max_version ?? 0) + 1;

  const [row] = await sql<IndexCheckpoint[]>`
    INSERT INTO knowledge.index_checkpoints (document_id, version, content_hash, chunk_count, total_tokens)
    VALUES (${documentId}, ${nextVersion}, ${contentHash}, ${chunkCount}, ${totalTokens})
    RETURNING *
  `;
  return {
    id: row.id,
    documentId: row.document_id,
    version: row.version,
    contentHash: row.content_hash,
    chunkCount: row.chunk_count,
    totalTokens: row.total_tokens,
    indexedAt: row.indexed_at,
  };
}

/**
 * Get the latest checkpoint for a document.
 */
export async function getLatestCheckpoint(
  sql: Sql,
  documentId: string,
): Promise<IndexCheckpoint | null> {
  const [row] = await sql<IndexCheckpoint[]>`
    SELECT * FROM knowledge.index_checkpoints
    WHERE document_id = ${documentId}
    ORDER BY version DESC
    LIMIT 1
  `;
  return row
    ? {
        id: row.id,
        documentId: row.document_id,
        version: row.version,
        contentHash: row.content_hash,
        chunkCount: row.chunk_count,
        totalTokens: row.total_tokens,
        indexedAt: row.indexed_at,
      }
    : null;
}

/**
 * Compute what changed between two checkpoints and record delta chunks.
 * Returns the new checkpoint and delta summary.
 */
export async function computeDelta(
  sql: Sql,
  documentId: string,
  newContentHash: string,
  newChunkCount: number,
  newTotalTokens: number,
): Promise<{ checkpoint: IndexCheckpoint; deltaCount: number }> {
  const oldCheckpoint = await getLatestCheckpoint(sql, documentId);

  // Create new checkpoint
  const checkpoint = await createIndexCheckpoint(sql, documentId, newContentHash, newChunkCount, newTotalTokens);

  if (!oldCheckpoint) {
    return { checkpoint, deltaCount: 0 };
  }

  // Record delta if content hash changed
  if (oldCheckpoint.contentHash !== newContentHash) {
    await sql`
      INSERT INTO knowledge.delta_chunks (checkpoint_id, chunk_id, delta_type, chunk_sequence, new_content_hash, old_content_hash)
      SELECT ${checkpoint.id}, id, 'update', sequence, ${newContentHash}, ${oldCheckpoint.contentHash}
      FROM knowledge.chunks
      WHERE document_id = ${documentId}
      ORDER BY sequence
    `;
  }

  const [deltaCount] = await sql<[{ c: number }]>`
    SELECT COUNT(*) as c FROM knowledge.delta_chunks WHERE checkpoint_id = ${checkpoint.id}
  `;

  return { checkpoint, deltaCount: Number(deltaCount?.c ?? 0) };
}

/**
 * List all checkpoints for a document.
 */
export async function listCheckpoints(
  sql: Sql,
  documentId: string,
): Promise<IndexCheckpoint[]> {
  const rows = await sql<IndexCheckpoint[]>`
    SELECT * FROM knowledge.index_checkpoints
    WHERE document_id = ${documentId}
    ORDER BY version DESC
  `;
  return rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    version: row.version,
    contentHash: row.content_hash,
    chunkCount: row.chunk_count,
    totalTokens: row.total_tokens,
    indexedAt: row.indexed_at,
  }));
}

/**
 * Prune old checkpoints keeping only the last N versions.
 */
export async function pruneOldCheckpoints(
  sql: Sql,
  documentId: string,
  keepVersions: number = 3,
): Promise<number> {
  const oldVersions = await sql.unsafe(
    `DELETE FROM knowledge.index_checkpoints
     WHERE document_id = $1
       AND version NOT IN (
         SELECT version FROM knowledge.index_checkpoints
         WHERE document_id = $1
         ORDER BY version DESC
         LIMIT $2
       )
     RETURNING id`,
    [documentId, keepVersions],
  );
  return oldVersions.count ?? 0;
}

/**
 * Get delta chunks for a checkpoint.
 */
export async function getDeltaChunks(
  sql: Sql,
  checkpointId: string,
): Promise<DeltaChunk[]> {
  const rows = await sql<DeltaChunk[]>`
    SELECT * FROM knowledge.delta_chunks
    WHERE checkpoint_id = ${checkpointId}
    ORDER BY chunk_sequence
  `;
  return rows.map((row) => ({
    id: row.id,
    checkpointId: row.checkpoint_id,
    chunkId: row.chunk_id ?? null,
    deltaType: row.delta_type,
    chunkSequence: row.chunk_sequence,
    oldContentHash: row.old_content_hash ?? null,
    newContentHash: row.new_content_hash ?? null,
    createdAt: row.created_at,
  }));
}