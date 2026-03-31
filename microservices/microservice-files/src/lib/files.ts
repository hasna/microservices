/**
 * File record management — create, get, list, update, delete.
 */

import type { Sql } from "postgres";

export interface FileRecord {
  id: string;
  workspace_id: string | null;
  folder_id: string | null;
  name: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  storage: "s3" | "local";
  storage_key: string;
  url: string | null;
  access: "public" | "private" | "signed";
  metadata: Record<string, unknown>;
  uploaded_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function createFileRecord(
  sql: Sql,
  data: {
    workspace_id?: string;
    folder_id?: string;
    name: string;
    original_name: string;
    mime_type: string;
    size_bytes: number;
    storage: "s3" | "local";
    storage_key: string;
    url?: string;
    access?: "public" | "private" | "signed";
    metadata?: Record<string, unknown>;
    uploaded_by?: string;
  }
): Promise<FileRecord> {
  if (data.size_bytes <= 0) throw new Error("size_bytes must be greater than 0");

  const [file] = await sql<FileRecord[]>`
    INSERT INTO files.files (
      workspace_id, folder_id, name, original_name, mime_type,
      size_bytes, storage, storage_key, url, access, metadata, uploaded_by
    ) VALUES (
      ${data.workspace_id ?? null},
      ${data.folder_id ?? null},
      ${data.name},
      ${data.original_name},
      ${data.mime_type},
      ${data.size_bytes},
      ${data.storage},
      ${data.storage_key},
      ${data.url ?? null},
      ${data.access ?? "private"},
      ${JSON.stringify(data.metadata ?? {})}::jsonb,
      ${data.uploaded_by ?? null}
    )
    RETURNING *
  `;
  return file;
}

export async function getFile(sql: Sql, id: string): Promise<FileRecord | null> {
  const [file] = await sql<FileRecord[]>`
    SELECT * FROM files.files WHERE id = ${id}
  `;
  return file ?? null;
}

export async function listFiles(
  sql: Sql,
  workspaceId: string,
  opts: {
    folderId?: string;
    includeDeleted?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<FileRecord[]> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  if (opts.folderId) {
    if (opts.includeDeleted) {
      return sql<FileRecord[]>`
        SELECT * FROM files.files
        WHERE workspace_id = ${workspaceId} AND folder_id = ${opts.folderId}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }
    return sql<FileRecord[]>`
      SELECT * FROM files.files
      WHERE workspace_id = ${workspaceId} AND folder_id = ${opts.folderId} AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  if (opts.includeDeleted) {
    return sql<FileRecord[]>`
      SELECT * FROM files.files
      WHERE workspace_id = ${workspaceId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  return sql<FileRecord[]>`
    SELECT * FROM files.files
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export async function updateFile(
  sql: Sql,
  id: string,
  data: {
    name?: string;
    folder_id?: string | null;
    url?: string;
    access?: "public" | "private" | "signed";
    metadata?: Record<string, unknown>;
  }
): Promise<FileRecord | null> {
  const [file] = await sql<FileRecord[]>`
    UPDATE files.files SET
      name = COALESCE(${data.name ?? null}, name),
      folder_id = CASE WHEN ${data.folder_id !== undefined ? "true" : "false"} = 'true' THEN ${data.folder_id ?? null} ELSE folder_id END,
      url = COALESCE(${data.url ?? null}, url),
      access = COALESCE(${data.access ?? null}, access),
      metadata = CASE WHEN ${data.metadata ?? null}::jsonb IS NOT NULL THEN ${data.metadata ? JSON.stringify(data.metadata) : null}::jsonb ELSE metadata END,
      updated_at = NOW()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING *
  `;
  return file ?? null;
}

export async function softDeleteFile(sql: Sql, id: string): Promise<boolean> {
  const result = await sql`
    UPDATE files.files SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND deleted_at IS NULL
  `;
  return result.count > 0;
}

export async function hardDeleteFile(sql: Sql, id: string): Promise<boolean> {
  const result = await sql`DELETE FROM files.files WHERE id = ${id}`;
  return result.count > 0;
}

export async function countFiles(sql: Sql, workspaceId: string): Promise<number> {
  const [{ count }] = await sql<[{ count: string }]>`
    SELECT COUNT(*) as count FROM files.files
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
  `;
  return parseInt(count, 10);
}
