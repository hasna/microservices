/**
 * Folder management — create, get, list, delete, path building.
 */

import type { Sql } from "postgres";

export interface Folder {
  id: string;
  workspace_id: string | null;
  name: string;
  parent_id: string | null;
  path: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function buildPath(name: string, parentPath?: string): string {
  if (!parentPath || parentPath === "/") {
    return `/${name}`;
  }
  const normalized = parentPath.endsWith("/")
    ? parentPath.slice(0, -1)
    : parentPath;
  return `${normalized}/${name}`;
}

export async function createFolder(
  sql: Sql,
  data: {
    workspace_id?: string;
    name: string;
    parent_id?: string;
    created_by?: string;
  },
): Promise<Folder> {
  let parentPath: string | undefined;

  if (data.parent_id) {
    const [parent] = await sql<Folder[]>`
      SELECT * FROM files.folders WHERE id = ${data.parent_id}
    `;
    if (!parent) throw new Error(`Parent folder ${data.parent_id} not found`);
    parentPath = parent.path;
  }

  const path = buildPath(data.name, parentPath);

  const [folder] = await sql<Folder[]>`
    INSERT INTO files.folders (workspace_id, name, parent_id, path, created_by)
    VALUES (
      ${data.workspace_id ?? null},
      ${data.name},
      ${data.parent_id ?? null},
      ${path},
      ${data.created_by ?? null}
    )
    RETURNING *
  `;
  return folder;
}

export async function getFolder(sql: Sql, id: string): Promise<Folder | null> {
  const [folder] = await sql<Folder[]>`
    SELECT * FROM files.folders WHERE id = ${id}
  `;
  return folder ?? null;
}

export async function listFolders(
  sql: Sql,
  workspaceId: string,
  parentId?: string | null,
): Promise<Folder[]> {
  if (parentId !== undefined) {
    if (parentId === null) {
      return sql<Folder[]>`
        SELECT * FROM files.folders
        WHERE workspace_id = ${workspaceId} AND parent_id IS NULL
        ORDER BY name ASC
      `;
    }
    return sql<Folder[]>`
      SELECT * FROM files.folders
      WHERE workspace_id = ${workspaceId} AND parent_id = ${parentId}
      ORDER BY name ASC
    `;
  }

  return sql<Folder[]>`
    SELECT * FROM files.folders
    WHERE workspace_id = ${workspaceId}
    ORDER BY path ASC
  `;
}

export async function deleteFolder(
  sql: Sql,
  id: string,
  options?: { recursive?: boolean },
): Promise<{ deleted_folders: number; deleted_files: number }> {
  if (options?.recursive) {
    // Get all descendant folder IDs
    const descendants = await getDescendantFolderIds(sql, id);
    const allFolderIds = [id, ...descendants.map(d => d.id)];
    // Delete all files in these folders
    const fileResult = await sql`DELETE FROM files.files WHERE folder_id = ANY(${allFolderIds}::uuid[])`;
    // Delete all folders
    const folderResult = await sql`DELETE FROM files.folders WHERE id = ANY(${allFolderIds}::uuid[])`;
    return { deleted_folders: folderResult.count, deleted_files: fileResult.count };
  }
  // Non-recursive: only delete if empty
  const [childFiles] = await sql<[{ count: string }]>`SELECT COUNT(*) as count FROM files.files WHERE folder_id = ${id} AND deleted_at IS NULL`;
  if (parseInt(childFiles.count, 10) > 0) {
    throw new Error("Folder is not empty. Use recursive=true to delete non-empty folders.");
  }
  const [childFolders] = await sql<[{ count: string }]>`SELECT COUNT(*) as count FROM files.folders WHERE parent_id = ${id}`;
  if (parseInt(childFolders.count, 10) > 0) {
    throw new Error("Folder has sub-folders. Use recursive=true to delete non-empty folders.");
  }
  const result = await sql`DELETE FROM files.folders WHERE id = ${id}`;
  return { deleted_folders: result.count, deleted_files: 0 };
}

async function getDescendantFolderIds(sql: Sql, parentId: string): Promise<{ id: string }[]> {
  return sql<{ id: string }[]>`
    WITH RECURSIVE descendants AS (
      SELECT id FROM files.folders WHERE parent_id = ${parentId}
      UNION ALL
      SELECT f.id FROM files.folders f JOIN descendants d ON f.parent_id = d.id
    )
    SELECT id FROM descendants
  `;
}

/**
 * Rename a folder (updates name and recalculates path for all descendants).
 */
export async function renameFolder(sql: Sql, id: string, newName: string): Promise<Folder | null> {
  const [folder] = await sql<Folder[]>`
    UPDATE files.folders SET name = ${newName}, updated_at = NOW()
    WHERE id = ${id} RETURNING *
  `;
  if (!folder) return null;

  // Recalculate path for this folder
  const parentPath = folder.parent_id
    ? (await getFolder(sql, folder.parent_id))?.path ?? "/"
    : "/";
  const newPath = buildPath(newName, parentPath);

  await sql`UPDATE files.folders SET path = ${newPath}, updated_at = NOW() WHERE id = ${id}`;

  // Update all descendant paths
  const descendants = await getDescendantFolderIds(sql, id);
  for (const desc of descendants) {
    const [descFolder] = await sql<Folder[]>`SELECT * FROM files.folders WHERE id = ${desc.id}`;
    if (descFolder) {
      const descNewPath = buildPath(descFolder.name, newPath);
      await sql`UPDATE files.folders SET path = ${descNewPath}, updated_at = NOW() WHERE id = ${desc.id}`;
    }
  }

  return { ...folder, name: newName, path: newPath };
}

/**
 * Move a folder to a new parent (recalculates path for folder and all descendants).
 */
export async function moveFolder(sql: Sql, id: string, newParentId: string | null): Promise<Folder | null> {
  const [folder] = await sql<Folder[]>`
    UPDATE files.folders SET parent_id = ${newParentId}, updated_at = NOW()
    WHERE id = ${id} RETURNING *
  `;
  if (!folder) return null;

  // Calculate new parent path
  const parentPath = newParentId
    ? (await getFolder(sql, newParentId))?.path ?? "/"
    : "/";
  const newPath = buildPath(folder.name, parentPath);

  await sql`UPDATE files.folders SET path = ${newPath}, updated_at = NOW() WHERE id = ${id}`;

  // Update all descendant paths
  const descendants = await getDescendantFolderIds(sql, id);
  for (const desc of descendants) {
    const [descFolder] = await sql<Folder[]>`SELECT * FROM files.folders WHERE id = ${desc.id}`;
    if (descFolder) {
      // Find the parent path of this descendant
      const descParentPath = descFolder.parent_id
        ? (await getFolder(sql, descFolder.parent_id))?.path ?? "/"
        : "/";
      const descNewPath = buildPath(descFolder.name, descParentPath);
      await sql`UPDATE files.folders SET path = ${descNewPath}, updated_at = NOW() WHERE id = ${desc.id}`;
    }
  }

  return { ...folder, parent_id: newParentId, path: newPath };
}
