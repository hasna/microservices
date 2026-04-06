/**
 * Collection permissions — share knowledge collections with workspaces
 * and control read/write access at the collection level.
 */

import type { Sql } from "postgres";

export type CollectionPermission = "read" | "write" | "admin";

export interface CollectionShare {
  id: string;
  collection_id: string;
  workspace_id: string;
  permission: CollectionPermission;
  shared_by: string | null;
  created_at: string;
}

/**
 * Share a collection with a workspace.
 */
export async function shareCollection(
  sql: Sql,
  collectionId: string,
  workspaceId: string,
  permission: CollectionPermission = "read",
  sharedBy?: string,
): Promise<CollectionShare> {
  const [existing] = await sql<[{ id: string }]>`
    SELECT id FROM knowledge.collection_shares
    WHERE collection_id = ${collectionId} AND workspace_id = ${workspaceId}
  `;

  if (existing) {
    const [updated] = await sql<CollectionShare[]>`
      UPDATE knowledge.collection_shares
      SET permission = ${permission}, shared_by = ${sharedBy ?? null}
      WHERE collection_id = ${collectionId} AND workspace_id = ${workspaceId}
      RETURNING *
    `;
    return updated;
  }

  const [share] = await sql<CollectionShare[]>`
    INSERT INTO knowledge.collection_shares (collection_id, workspace_id, permission, shared_by)
    VALUES (${collectionId}, ${workspaceId}, ${permission}, ${sharedBy ?? null})
    RETURNING *
  `;
  return share;
}

/**
 * Revoke a collection share from a workspace.
 */
export async function revokeCollectionShare(
  sql: Sql,
  collectionId: string,
  workspaceId: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM knowledge.collection_shares
    WHERE collection_id = ${collectionId} AND workspace_id = ${workspaceId}
  `;
  return Number(result.count ?? 0) > 0;
}

/**
 * List all workspaces a collection is shared with.
 */
export async function listCollectionShares(
  sql: Sql,
  collectionId: string,
): Promise<CollectionShare[]> {
  return sql<CollectionShare[]>`
    SELECT * FROM knowledge.collection_shares
    WHERE collection_id = ${collectionId}
    ORDER BY created_at DESC
  `;
}

/**
 * List all collections shared with a workspace.
 */
export async function listWorkspaceCollections(
  sql: Sql,
  workspaceId: string,
): Promise<Array<{ collection_id: string; name: string; permission: CollectionPermission }>> {
  return sql<Array<{ collection_id: string; name: string; permission: CollectionPermission }>>`
    SELECT c.id as collection_id, c.name, s.permission
    FROM knowledge.collection_shares s
    JOIN knowledge.collections c ON c.id = s.collection_id
    WHERE s.workspace_id = ${workspaceId}
    ORDER BY c.name
  `;
}

/**
 * Check if a workspace has a given permission on a collection.
 */
export async function checkCollectionPermission(
  sql: Sql,
  collectionId: string,
  workspaceId: string,
  requiredPermission: CollectionPermission,
): Promise<boolean> {
  const PERM_RANK: Record<CollectionPermission, number> = {
    read: 1,
    write: 2,
    admin: 3,
  };

  const [share] = await sql<[{ permission: CollectionPermission }]>`
    SELECT permission FROM knowledge.collection_shares
    WHERE collection_id = ${collectionId} AND workspace_id = ${workspaceId}
  `;

  if (!share) {
    // Check if workspace owns the collection
    const [owner] = await sql<[{ workspace_id: string }]>`
      SELECT workspace_id FROM knowledge.collections WHERE id = ${collectionId}
    `;
    return owner?.workspace_id === workspaceId;
  }

  return PERM_RANK[share.permission] >= PERM_RANK[requiredPermission];
}

/**
 * Get all workspaces with access to a collection.
 */
export async function getCollectionAccessList(
  sql: Sql,
  collectionId: string,
): Promise<Array<{ workspace_id: string; permission: CollectionPermission }>> {
  return sql<Array<{ workspace_id: string; permission: CollectionPermission }>>`
    SELECT workspace_id, permission FROM knowledge.collection_shares
    WHERE collection_id = ${collectionId}
    UNION
    SELECT workspace_id, 'admin'::knowledge.collection_permission AS permission
    FROM knowledge.collections WHERE id = ${collectionId}
    ORDER BY permission DESC
  `;
}
