/**
 * Prompt search — full-text search across prompt content, name, and description.
 */
import type { Sql } from "postgres";

export async function searchPrompts(
  sql: Sql,
  workspaceId: string,
  query: string,
  opts?: { limit?: number },
): Promise<any[]> {
  const q = '%' + query + '%';
  return sql<any[]>`
    SELECT p.*, v.content, v.version_number, v.model, v.variables
    FROM prompts.prompts p
    LEFT JOIN prompts.versions v ON v.id = p.current_version_id
    WHERE p.workspace_id = ${workspaceId}
      AND (
        p.name ILIKE ${q}
        OR p.description ILIKE ${q}
        OR v.content ILIKE ${q}
      )
    ORDER BY p.updated_at DESC
    LIMIT ${opts?.limit ?? 50}`;
}
