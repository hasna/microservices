/**
 * Namespace management for memory — namespaces partition a workspace's
 * memory into isolated subspaces (e.g. per-project, per-agent, per-session).
 */

import type { Sql } from "postgres";

export interface MemoryNamespace {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  defaultTtlSeconds: number | null;
  defaultMemoryType: string;
  memoryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNamespaceInput {
  workspaceId: string;
  name: string;
  description?: string;
  defaultTtlSeconds?: number | null;
  defaultMemoryType?: string;
}

export async function createNamespace(
  sql: Sql,
  input: CreateNamespaceInput,
): Promise<MemoryNamespace> {
  const [ns] = await sql<any[]>`
    INSERT INTO memory.namespaces (
      workspace_id, name, description,
      default_ttl_seconds, default_memory_type
    )
    VALUES (
      ${input.workspaceId},
      ${input.name},
      ${input.description ?? null},
      ${input.defaultTtlSeconds ?? null},
      ${input.defaultMemoryType ?? "semantic"}
    )
    RETURNING *
  `;

  return formatNamespace(ns);
}

export async function getNamespace(
  sql: Sql,
  workspaceId: string,
  name: string,
): Promise<MemoryNamespace | null> {
  const [row] = await sql<any[]>`
    SELECT * FROM memory.namespaces
    WHERE workspace_id = ${workspaceId} AND name = ${name}
  `;

  return row ? formatNamespace(row) : null;
}

export async function deleteNamespace(
  sql: Sql,
  workspaceId: string,
  name: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM memory.namespaces
    WHERE workspace_id = ${workspaceId} AND name = ${name}
  `;
  return Number(result.count ?? 0) > 0;
}

export async function listNamespaces(
  sql: Sql,
  workspaceId: string,
): Promise<MemoryNamespace[]> {
  const rows = await sql<any[]>`
    SELECT
      n.*,
      COUNT(m.id)::int AS memory_count
    FROM memory.namespaces n
    LEFT JOIN memory.memories m
      ON m.workspace_id = n.workspace_id
      AND m.metadata->>'namespace' = n.name
    WHERE n.workspace_id = ${workspaceId}
    GROUP BY n.id
    ORDER BY n.name
  `;

  return rows.map(formatNamespace);
}

export async function updateNamespace(
  sql: Sql,
  opts: {
    workspaceId: string;
    name: string;
    description?: string;
    defaultTtlSeconds?: number | null;
    defaultMemoryType?: string;
  },
): Promise<MemoryNamespace | null> {
  const [ns] = await sql<any[]>`
    UPDATE memory.namespaces
    SET
      description = COALESCE(${opts.description ?? null}, description),
      default_ttl_seconds = COALESCE(${opts.defaultTtlSeconds ?? null}, default_ttl_seconds),
      default_memory_type = COALESCE(${opts.defaultMemoryType ?? null}, default_memory_type),
      updated_at = NOW()
    WHERE workspace_id = ${opts.workspaceId} AND name = ${opts.name}
    RETURNING *
  `;

  return ns ? formatNamespace(ns) : null;
}

export async function renameNamespace(
  sql: Sql,
  workspaceId: string,
  oldName: string,
  newName: string,
): Promise<boolean> {
  const result = await sql`
    WITH updated AS (
      UPDATE memory.namespaces
      SET name = ${newName}, updated_at = NOW()
      WHERE workspace_id = ${workspaceId} AND name = ${oldName}
      RETURNING id
    )
    UPDATE memory.memories
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'),
      '{namespace}',
      to_jsonb(${newName}::text)
    )
    WHERE workspace_id = ${workspaceId}
      AND metadata->>'namespace' = ${oldName}
  `;

  return Number(result.count ?? 0) >= 0; // memories may not exist
}

export async function getNamespaceStats(
  sql: Sql,
  workspaceId: string,
  name: string,
): Promise<{
  memoryCount: number;
  episodicCount: number;
  semanticCount: number;
  proceduralCount: number;
  contextCount: number;
  avgImportance: number;
  pinnedCount: number;
  expiredCount: number;
} | null> {
  const [row] = await sql<any[]>`
    SELECT
      COUNT(*)::int AS memory_count,
      COUNT(*) FILTER (WHERE m.memory_type = 'episodic')::int AS episodic_count,
      COUNT(*) FILTER (WHERE m.memory_type = 'semantic')::int AS semantic_count,
      COUNT(*) FILTER (WHERE m.memory_type = 'procedural')::int AS procedural_count,
      COUNT(*) FILTER (WHERE m.memory_type = 'context')::int AS context_count,
      ROUND(AVG(m.importance)::numeric, 3)::float AS avg_importance,
      COUNT(*) FILTER (WHERE m.is_pinned = true)::int AS pinned_count,
      COUNT(*) FILTER (WHERE m.expires_at < NOW())::int AS expired_count
    FROM memory.namespaces n
    LEFT JOIN memory.memories m
      ON m.workspace_id = n.workspace_id
      AND m.metadata->>'namespace' = n.name
    WHERE n.workspace_id = ${workspaceId} AND n.name = ${name}
    GROUP BY n.id
  `;

  if (!row) return null;

  return {
    memoryCount: row.memory_count,
    episodicCount: row.episodic_count,
    semanticCount: row.semantic_count,
    proceduralCount: row.procedural_count,
    contextCount: row.context_count,
    avgImportance: Number(row.avg_importance ?? 0),
    pinnedCount: row.pinned_count,
    expiredCount: row.expired_count,
  };
}

function formatNamespace(r: any): MemoryNamespace {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    description: r.description,
    defaultTtlSeconds: r.default_ttl_seconds,
    defaultMemoryType: r.default_memory_type,
    memoryCount: r.memory_count ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Get namespace usage analytics — total memories, by memory type,
 * importance distribution, and quota usage.
 */
export async function getNamespaceAnalytics(
  sql: Sql,
  workspaceId: string,
  namespace: string,
): Promise<{
  totalMemories: number;
  byType: Record<string, number>;
  avgImportance: number;
  quotaUsed: number | null;
  quotaLimit: number | null;
  mostAccessed: Array<{ id: string; content_preview: string; access_count: number }>;
  oldestMemory: string | null;
  newestMemory: string | null;
}> {
  const [stats] = await sql.unsafe(`
    SELECT
      COUNT(m.id)::int AS total_memories,
      AVG(m.importance)::float AS avg_importance,
      MAX(m.created_at)::text AS newest_memory,
      MIN(m.created_at)::text AS oldest_memory
    FROM memory.memories m
    JOIN memory.collections c ON c.id = m.collection_id
    WHERE m.workspace_id = $1 AND c.namespace = $2
  `, [workspaceId, namespace]) as any[];

  const byTypeRows = await sql.unsafe(`
    SELECT m.memory_type, COUNT(*)::int AS count
    FROM memory.memories m
    JOIN memory.collections c ON c.id = m.collection_id
    WHERE m.workspace_id = $1 AND c.namespace = $2
    GROUP BY m.memory_type
  `, [workspaceId, namespace]) as any[];

  const quotaRow = await sql.unsafe(`
    SELECT nqu.quota_limit
    FROM memory.namespace_quotas nqu
    JOIN memory.namespaces n ON n.id = nqu.namespace_id
    WHERE n.workspace_id = $1 AND n.name = $2
  `, [workspaceId, namespace]) as any[];

  const topMemories = await sql.unsafe(`
    SELECT m.id, LEFT(m.content, 80) AS content_preview, COUNT(al.id)::int AS access_count
    FROM memory.memories m
    JOIN memory.collections c ON c.id = m.collection_id
    LEFT JOIN memory.access_logs al ON al.memory_id = m.id
    WHERE m.workspace_id = $1 AND c.namespace = $2
    GROUP BY m.id, m.content
    ORDER BY access_count DESC
    LIMIT 5
  `, [workspaceId, namespace]) as any[];

  return {
    totalMemories: stats.total_memories ?? 0,
    byType: Object.fromEntries(byTypeRows.map((r: any) => [r.memory_type, r.count])),
    avgImportance: stats.avg_importance ?? 0,
    quotaUsed: stats.total_memories,
    quotaLimit: quotaRow[0]?.quota_limit ?? null,
    mostAccessed: topMemories,
    oldestMemory: stats.oldest_memory ?? null,
    newestMemory: stats.newest_memory ?? null,
  };
}

/**
 * Search across multiple namespaces within a workspace.
 * Useful for workspace-wide queries when you don't know which namespace holds the data.
 */
export async function searchAcrossNamespaces(
  sql: Sql,
  opts: {
    workspaceId: string;
    query: string;
    namespaces?: string[];
    memoryTypes?: string[];
    limit?: number;
    offset?: number;
  },
): Promise<Array<{ memory_id: string; namespace: string; collection_id: string; content_preview: string; importance: number; created_at: string }>> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const nsFilter = opts.namespaces?.length
    ? `AND c.namespace IN (${opts.namespaces.map((_, i) => `$${i + 3}`).join(",")})`
    : "";
  const typeFilter = opts.memoryTypes?.length
    ? `AND m.memory_type IN (${opts.memoryTypes.map((_, i) => `$${opts.namespaces?.length ?? 0 + i + 3}`).join(",")})`
    : "";

  const params = [opts.workspaceId, opts.query, limit, offset, ...(opts.namespaces ?? []), ...(opts.memoryTypes ?? [])];
  return sql.unsafe(`
    SELECT m.id AS memory_id, c.namespace, m.collection_id, LEFT(m.content, 120) AS content_preview, m.importance, m.created_at::text
    FROM memory.memories m
    JOIN memory.collections c ON c.id = m.collection_id
    WHERE m.workspace_id = $1
      AND to_tsvector('english', m.content) @@ plainto_tsquery('english', $2)
      ${nsFilter}
      ${typeFilter}
    ORDER BY m.importance DESC, m.created_at DESC
    LIMIT $3 OFFSET $4
  `, params) as any[];
}
