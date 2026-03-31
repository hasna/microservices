/**
 * Collection CRUD operations.
 */

import type { Sql } from "postgres";
import type { ChunkingStrategy } from "./chunking.js";

export interface Collection {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  chunk_size: number;
  chunk_overlap: number;
  chunking_strategy: ChunkingStrategy;
  embedding_model: string;
  document_count: number;
  chunk_count: number;
  created_at: Date;
}

export interface CreateCollectionInput {
  workspaceId: string;
  name: string;
  description?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  chunkingStrategy?: ChunkingStrategy;
  embeddingModel?: string;
}

export async function createCollection(sql: Sql, data: CreateCollectionInput): Promise<Collection> {
  const [col] = await sql<Collection[]>`
    INSERT INTO knowledge.collections (workspace_id, name, description, chunk_size, chunk_overlap, chunking_strategy, embedding_model)
    VALUES (
      ${data.workspaceId},
      ${data.name},
      ${data.description ?? null},
      ${data.chunkSize ?? 1000},
      ${data.chunkOverlap ?? 200},
      ${data.chunkingStrategy ?? "recursive"},
      ${data.embeddingModel ?? "text-embedding-3-small"}
    )
    RETURNING *
  `;
  return col!;
}

export async function getCollection(sql: Sql, id: string): Promise<Collection | null> {
  const [col] = await sql<Collection[]>`SELECT * FROM knowledge.collections WHERE id = ${id}`;
  return col ?? null;
}

export async function listCollections(sql: Sql, workspaceId: string): Promise<Collection[]> {
  return sql<Collection[]>`
    SELECT * FROM knowledge.collections
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
  `;
}

export async function deleteCollection(sql: Sql, id: string): Promise<boolean> {
  const result = await sql`DELETE FROM knowledge.collections WHERE id = ${id}`;
  return (result.count ?? 0) > 0;
}
