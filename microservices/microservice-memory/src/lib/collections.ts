/**
 * Collection CRUD operations.
 */

import type { Sql } from "postgres";

export interface Collection {
  id: string;
  workspace_id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  created_at: Date;
}

export interface CreateCollectionInput {
  workspaceId: string;
  userId?: string;
  name: string;
  description?: string;
}

export async function createCollection(
  sql: Sql,
  data: CreateCollectionInput,
): Promise<Collection> {
  const [col] = await sql<Collection[]>`
    INSERT INTO memory.collections (workspace_id, user_id, name, description)
    VALUES (${data.workspaceId}, ${data.userId ?? null}, ${data.name}, ${data.description ?? null})
    RETURNING *
  `;
  return col!;
}

export async function getCollection(
  sql: Sql,
  id: string,
): Promise<Collection | null> {
  const [col] = await sql<
    Collection[]
  >`SELECT * FROM memory.collections WHERE id = ${id}`;
  return col ?? null;
}

export async function listCollections(
  sql: Sql,
  workspaceId: string,
  userId?: string,
): Promise<Collection[]> {
  if (userId) {
    return sql<Collection[]>`
      SELECT * FROM memory.collections
      WHERE workspace_id = ${workspaceId}
        AND (user_id = ${userId} OR user_id IS NULL)
      ORDER BY created_at DESC
    `;
  }
  return sql<Collection[]>`
    SELECT * FROM memory.collections
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
  `;
}

export async function deleteCollection(sql: Sql, id: string): Promise<boolean> {
  const result = await sql`DELETE FROM memory.collections WHERE id = ${id}`;
  return (result.count ?? 0) > 0;
}

export interface CollectionStats {
  collection_id: string;
  total_memories: number;
  episodic_count: number;
  semantic_count: number;
  procedural_count: number;
  context_count: number;
  pinned_count: number;
  expired_count: number;
  avg_importance: number;
  avg_ttl_seconds: number;
}

export async function getCollectionStats(
  sql: Sql,
  collectionId: string,
): Promise<CollectionStats | null> {
  const [row] = await sql<any[]>`
    SELECT
      m.collection_id,
      COUNT(m.id) AS total_memories,
      COUNT(m.id) FILTER (WHERE m.memory_type = 'episodic') AS episodic_count,
      COUNT(m.id) FILTER (WHERE m.memory_type = 'semantic') AS semantic_count,
      COUNT(m.id) FILTER (WHERE m.memory_type = 'procedural') AS procedural_count,
      COUNT(m.id) FILTER (WHERE m.memory_type = 'context') AS context_count,
      COUNT(m.id) FILTER (WHERE m.is_pinned = true) AS pinned_count,
      COUNT(m.id) FILTER (WHERE m.expires_at < NOW()) AS expired_count,
      COALESCE(AVG(m.importance), 0) AS avg_importance,
      COALESCE(AVG(m.ttl_seconds) FILTER (WHERE m.ttl_seconds > 0), 0) AS avg_ttl_seconds
    FROM memory.memories m
    WHERE m.collection_id = ${collectionId}
    GROUP BY m.collection_id
  `;
  if (!row) return null;
  return {
    collection_id: row.collection_id,
    total_memories: Number(row.total_memories),
    episodic_count: Number(row.episodic_count),
    semantic_count: Number(row.semantic_count),
    procedural_count: Number(row.procedural_count),
    context_count: Number(row.context_count),
    pinned_count: Number(row.pinned_count),
    expired_count: Number(row.expired_count),
    avg_importance: parseFloat(row.avg_importance),
    avg_ttl_seconds: Math.round(parseFloat(row.avg_ttl_seconds)),
  };
}

export async function updateCollectionTTL(
  sql: Sql,
  collectionId: string,
  defaultTtlSeconds: number | null,
): Promise<Collection | null> {
  const [col] = await sql<Collection[]>`
    UPDATE memory.collections
    SET default_ttl_seconds = ${defaultTtlSeconds}
    WHERE id = ${collectionId}
    RETURNING *
  `;
  return col ?? null;
}
