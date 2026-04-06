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
  metadata: any;
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
    metadata?: any;
    uploaded_by?: string;
  },
): Promise<FileRecord> {
  if (data.size_bytes <= 0)
    throw new Error("size_bytes must be greater than 0");

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

export async function getFile(
  sql: Sql,
  id: string,
): Promise<FileRecord | null> {
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
  } = {},
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
    metadata?: any;
  },
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

export async function countFiles(
  sql: Sql,
  workspaceId: string,
): Promise<number> {
  const [{ count }] = await sql<[{ count: string }]>`
    SELECT COUNT(*) as count FROM files.files
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
  `;
  return parseInt(count, 10);
}

export async function renameFile(
  sql: Sql,
  id: string,
  name: string,
): Promise<FileRecord | null> {
  const [f] = await sql<
    FileRecord[]
  >`UPDATE files.files SET name = ${name}, updated_at = NOW() WHERE id = ${id} AND deleted_at IS NULL RETURNING *`;
  return f ?? null;
}

export async function moveFile(
  sql: Sql,
  id: string,
  folderId: string | null,
): Promise<FileRecord | null> {
  const [f] = await sql<
    FileRecord[]
  >`UPDATE files.files SET folder_id = ${folderId}, updated_at = NOW() WHERE id = ${id} AND deleted_at IS NULL RETURNING *`;
  return f ?? null;
}

export async function bulkSoftDelete(sql: Sql, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result =
    await sql`UPDATE files.files SET deleted_at = NOW(), updated_at = NOW() WHERE id = ANY(${ids}::uuid[]) AND deleted_at IS NULL`;
  return result.count;
}

export async function getStorageStats(
  sql: Sql,
  workspaceId: string,
): Promise<{
  total_files: number;
  total_bytes: number;
  by_mime_type: { mime_type: string; count: number; bytes: number }[];
}> {
  const [stats] = await sql<[{ total_files: string; total_bytes: string }]>`
    SELECT COUNT(*) as total_files, COALESCE(SUM(size_bytes), 0) as total_bytes
    FROM files.files WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL`;
  const by_mime = await sql<
    { mime_type: string; count: string; bytes: string }[]
  >`
    SELECT mime_type, COUNT(*) as count, SUM(size_bytes) as bytes
    FROM files.files WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
    GROUP BY mime_type ORDER BY SUM(size_bytes) DESC`;
  return {
    total_files: parseInt(stats.total_files, 10),
    total_bytes: parseInt(stats.total_bytes, 10),
    by_mime_type: by_mime.map((r) => ({
      mime_type: r.mime_type,
      count: parseInt(r.count, 10),
      bytes: parseInt(r.bytes, 10),
    })),
  };
}

export async function findDuplicates(
  sql: Sql,
  workspaceId: string,
): Promise<{ content_hash: string; files: FileRecord[] }[]> {
  const dupes = await sql<{ content_hash: string }[]>`
    SELECT content_hash FROM files.files
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL AND content_hash IS NOT NULL
    GROUP BY content_hash HAVING COUNT(*) > 1`;
  const result = [];
  for (const { content_hash } of dupes) {
    const files = await sql<
      FileRecord[]
    >`SELECT * FROM files.files WHERE content_hash = ${content_hash} AND workspace_id = ${workspaceId} AND deleted_at IS NULL`;
    result.push({ content_hash, files });
  }
  return result;
}

/**
 * Upload a file from a URL — fetches content and stores it.
 * Returns the created FileRecord.
 */
export async function uploadFromUrl(
  sql: Sql,
  data: {
    workspace_id?: string;
    folder_id?: string;
    name: string;
    url: string;
    mime_type?: string;
    access?: "public" | "private" | "signed";
    metadata?: any;
    uploaded_by?: string;
  },
): Promise<FileRecord> {
  const response = await fetch(data.url);
  if (!response.ok) throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const size_bytes = buffer.length;
  const mime_type = data.mime_type ?? response.headers.get("content-type") ?? "application/octet-stream";
  // Determine storage backend
  const storage: "s3" | "local" = process.env.S3_BUCKET ? "s3" : "local";
  const storage_key = `${data.workspace_id ?? "common"}/${Date.now()}-${data.name}`;
  let url: string | undefined;
  if (storage === "s3") {
    // Upload to S3 using env vars
    const { S3_BUCKET, AWS_REGION } = process.env as Record<string, string>;
    url = `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${storage_key}`;
    // S3 upload would go here — for now use the url field as provided
  } else {
    // Local storage
    const localPath = `./storage/${storage_key}`;
    const localDir = localPath.substring(0, localPath.lastIndexOf("/"));
    await import("fs/promises").then(fs => fs.mkdir(localDir, { recursive: true }));
    await import("fs/promises").then(fs => fs.writeFile(localPath, buffer));
    url = `/storage/${storage_key}`;
  }
  const [file] = await sql<FileRecord[]>`
    INSERT INTO files.files (
      workspace_id, folder_id, name, original_name, mime_type,
      size_bytes, storage, storage_key, url, access, metadata, uploaded_by
    ) VALUES (
      ${data.workspace_id ?? null},
      ${data.folder_id ?? null},
      ${data.name},
      ${data.name},
      ${mime_type},
      ${size_bytes},
      ${storage},
      ${storage_key},
      ${url},
      ${data.access ?? "private"},
      ${JSON.stringify(data.metadata ?? {})},
      ${data.uploaded_by ?? null}
    )
    RETURNING *
  `;
  return file;
}

/**
 * Restore a soft-deleted file.
 */
export async function restoreFile(sql: Sql, id: string): Promise<boolean> {
  const result = await sql`
    UPDATE files.files SET deleted_at = NULL, updated_at = NOW()
    WHERE id = ${id} AND deleted_at IS NOT NULL
  `;
  return result.count > 0;
}

/**
 * Bulk restore multiple soft-deleted files.
 */
export async function bulkRestore(sql: Sql, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await sql`
    UPDATE files.files SET deleted_at = NULL, updated_at = NOW()
    WHERE id = ANY(${ids}::uuid[]) AND deleted_at IS NOT NULL
  `;
  return result.count;
}

/**
 * List soft-deleted files in a workspace.
 */
export async function listDeletedFiles(
  sql: Sql,
  workspaceId: string,
  options?: { limit?: number; offset?: number },
): Promise<FileRecord[]> {
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;
  return sql<FileRecord[]>`
    SELECT * FROM files.files
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}

/**
 * Get file content as base64 string.
 */
export async function getFileContent(
  sql: Sql,
  id: string,
): Promise<{ content: string; mime_type: string; name: string } | null> {
  const file = await getFile(sql, id);
  if (!file) return null;
  if (file.storage === "local") {
    const fs = await import("fs/promises");
    const path = await import("path");
    const localPath = path.join(process.cwd(), "storage", file.storage_key);
    const buffer = await fs.readFile(localPath);
    return { content: buffer.toString("base64"), mime_type: file.mime_type, name: file.name };
  }
  // For S3, return URL reference
  return { content: file.url ?? "", mime_type: file.mime_type, name: file.name };
}
