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
