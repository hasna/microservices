/**
 * Allowlist CRUD operations.
 */

import type { Sql } from "postgres";

export interface AllowlistEntry {
  id: string;
  workspace_id: string;
  type: string;
  value: string;
  created_at: Date;
}

export async function addAllowlistEntry(
  sql: Sql,
  workspaceId: string,
  type: string,
  value: string,
): Promise<AllowlistEntry> {
  const [row] = await sql`
    INSERT INTO guardrails.allowlists (workspace_id, type, value)
    VALUES (${workspaceId}, ${type}, ${value})
    ON CONFLICT (workspace_id, type, value) DO UPDATE SET workspace_id = EXCLUDED.workspace_id
    RETURNING *
  `;
  return row as unknown as AllowlistEntry;
}

export async function listAllowlistEntries(
  sql: Sql,
  workspaceId: string,
): Promise<AllowlistEntry[]> {
  const rows = await sql`
    SELECT * FROM guardrails.allowlists
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
  `;
  return rows as unknown as AllowlistEntry[];
}

export async function deleteAllowlistEntry(
  sql: Sql,
  id: string,
): Promise<boolean> {
  const result = await sql`DELETE FROM guardrails.allowlists WHERE id = ${id}`;
  return result.count > 0;
}
