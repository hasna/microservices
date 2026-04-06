/**
 * File analytics — type distribution, storage quotas, activity timeline.
 */
import type { Sql } from "postgres";

export interface TypeDistribution {
  mime_type: string;
  count: number;
  total_bytes: number;
}

export interface StorageQuota {
  workspace_id: string;
  soft_limit_bytes: number;
  hard_limit_bytes: number;
  used_bytes: number;
  file_count: number;
  usage_pct: number;
}

/**
 * Get MIME type distribution for a workspace.
 */
export async function getTypeDistribution(
  sql: Sql,
  workspaceId: string,
): Promise<TypeDistribution[]> {
  const rows = await sql<any[]>`
    SELECT
      mime_type,
      COUNT(*) as count,
      SUM(size_bytes) as total_bytes
    FROM files.files
    WHERE workspace_id = ${workspaceId}
      AND deleted_at IS NULL
    GROUP BY mime_type
    ORDER BY count DESC
    LIMIT 50`;
  return rows.map(r => ({
    mime_type: r.mime_type,
    count: parseInt(r.count, 10),
    total_bytes: parseInt(r.total_bytes, 10),
  }));
}

/**
 * Search files by name (ILIKE) within a workspace.
 */
export async function searchFiles(
  sql: Sql,
  workspaceId: string,
  query: string,
  opts?: { folder_id?: string; mime_type?: string; limit?: number },
): Promise<any[]> {
  return sql<any[]>`
    SELECT * FROM files.files
    WHERE workspace_id = ${workspaceId}
      AND deleted_at IS NULL
      AND name ILIKE ${'%' + query + '%'}
      AND (${opts?.folder_id ?? null} IS NULL OR folder_id = ${opts?.folder_id ?? null})
      AND (${opts?.mime_type ?? null} IS NULL OR mime_type = ${opts?.mime_type ?? null})
    ORDER BY updated_at DESC
    LIMIT ${opts?.limit ?? 50}`;
}

/**
 * Get storage quota status for a workspace (soft/hard limits from metadata).
 */
export async function getStorageQuota(
  sql: Sql,
  workspaceId: string,
): Promise<StorageQuota | null> {
  const rows = await sql<any[]>`
    SELECT
      workspace_id,
      SUM(size_bytes) as used_bytes,
      COUNT(*) as file_count
    FROM files.files
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
    GROUP BY workspace_id`;
  if (!rows[0]) return null;
  const r = rows[0];
  // Soft/hard limits can be stored in workspace metadata; default to 10GB/50GB
  const softLimit = 10 * 1024 * 1024 * 1024; // 10 GB
  const hardLimit = 50 * 1024 * 1024 * 1024; // 50 GB
  return {
    workspace_id: workspaceId,
    soft_limit_bytes: softLimit,
    hard_limit_bytes: hardLimit,
    used_bytes: parseInt(r.used_bytes, 10),
    file_count: parseInt(r.file_count, 10),
    usage_pct: Math.round((parseInt(r.used_bytes, 10) / hardLimit) * 100),
  };
}

/**
 * Get largest files in a workspace.
 */
export async function getLargestFiles(
  sql: Sql,
  workspaceId: string,
  limit?: number,
): Promise<any[]> {
  return sql<any[]>`
    SELECT id, name, mime_type, size_bytes, created_at
    FROM files.files
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
    ORDER BY size_bytes DESC
    LIMIT ${limit ?? 20}`;
}

/**
 * Get file activity timeline — newly uploaded, deleted, moved per day.
 */
export async function getFileActivityTimeline(
  sql: Sql,
  workspaceId: string,
  days?: number,
): Promise<{ date: string; created: number; deleted: number }[]> {
  const daysVal = days ?? 30;
  const cutoff = new Date(Date.now() - daysVal * 86400000).toISOString();
  const rows = await sql<any[]>`
    SELECT
      date_trunc('day', created_at)::date as date,
      COUNT(*) FILTER (WHERE deleted_at IS NULL) as created,
      COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) as deleted
    FROM files.files
    WHERE workspace_id = ${workspaceId}
      AND created_at > ${cutoff}
    GROUP BY date_trunc('day', created_at)
    ORDER BY date ASC`;
  return rows.map(r => ({
    date: r.date,
    created: parseInt(r.created, 10),
    deleted: parseInt(r.deleted, 10),
  }));
}
