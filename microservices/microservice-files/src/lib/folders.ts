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
  const normalized = parentPath.endsWith("/") ? parentPath.slice(0, -1) : parentPath;
  return `${normalized}/${name}`;
}

export async function createFolder(
  sql: Sql,
  data: {
    workspace_id?: string;
    name: string;
    parent_id?: string;
    created_by?: string;
  }
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
  parentId?: string | null
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

export async function deleteFolder(sql: Sql, id: string): Promise<boolean> {
  const result = await sql`DELETE FROM files.folders WHERE id = ${id}`;
  return result.count > 0;
}
