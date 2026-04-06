/**
 * Cross-namespace memory search — search across multiple namespaces in a workspace
 * in a single query, returning memories tagged with their namespace.
 */

import type { Sql } from "postgres";
import { generateEmbedding } from "./embeddings.js";
import type { Memory, SearchQuery } from "./memories.js";

export interface CrossNamespaceSearchQuery {
  workspaceId: string;
  text: string;
  namespaces: string[]; // List of namespaces to search across
  userId?: string;
  mode?: "semantic" | "text" | "hybrid";
  limit?: number;
  collectionId?: string;
  memoryType?: Memory["memory_type"];
}

export interface CrossNamespaceSearchResult {
  memory: Memory;
  namespace: string;
  collectionName: string | null;
}

/**
 * Search memories across multiple namespaces simultaneously.
 * Returns memories with their namespace and collection name attached.
 */
export async function searchCrossNamespace(
  sql: Sql,
  query: CrossNamespaceSearchQuery,
): Promise<CrossNamespaceSearchResult[]> {
  const limit = query.limit ?? 20;
  const mode = query.mode ?? "text";
  const hasPgvector = await checkPgvector(sql);

  if ((mode === "semantic" || mode === "hybrid") && hasPgvector) {
    const embedding = await generateEmbedding(query.text);
    if (embedding) {
      return semanticCrossNamespaceSearch(sql, query, embedding, limit);
    }
  }

  return textCrossNamespaceSearch(sql, query, limit);
}

async function checkPgvector(sql: Sql): Promise<boolean> {
  try {
    await sql`SELECT 1::vector`;
    return true;
  } catch {
    return false;
  }
}

async function semanticCrossNamespaceSearch(
  sql: Sql,
  query: CrossNamespaceSearchQuery,
  embedding: number[],
  limit: number,
): Promise<CrossNamespaceSearchResult[]> {
  const embeddingStr = `[${embedding.join(",")}]`;
  const rows = await sql<any[]>`
    SELECT
      m.*,
      c.name AS collection_name,
      c.namespace
    FROM memory.memories m
    JOIN memory.collections c ON m.collection_id = c.id
    WHERE m.workspace_id = ${query.workspaceId}
      AND c.namespace = ANY(${query.namespaces})
      ${query.userId ? sql`AND (m.user_id = ${query.userId} OR m.user_id IS NULL)` : sql``}
      ${query.collectionId ? sql`AND m.collection_id = ${query.collectionId}` : sql``}
      ${query.memoryType ? sql`AND m.memory_type = ${query.memoryType}` : sql``}
      AND (m.expires_at IS NULL OR m.expires_at > NOW())
      AND m.embedding IS NOT NULL
    ORDER BY m.embedding <=> ${embeddingStr}::vector, m.priority DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    memory: r as unknown as Memory,
    namespace: r.namespace,
    collectionName: r.collection_name ?? null,
  }));
}

async function textCrossNamespaceSearch(
  sql: Sql,
  query: CrossNamespaceSearchQuery,
  limit: number,
): Promise<CrossNamespaceSearchResult[]> {
  const rows = await sql<any[]>`
    SELECT
      m.*,
      c.name AS collection_name,
      c.namespace
    FROM memory.memories m
    JOIN memory.collections c ON m.collection_id = c.id
    WHERE m.workspace_id = ${query.workspaceId}
      AND c.namespace = ANY(${query.namespaces})
      ${query.userId ? sql`AND (m.user_id = ${query.userId} OR m.user_id IS NULL)` : sql``}
      ${query.collectionId ? sql`AND m.collection_id = ${query.collectionId}` : sql``}
      ${query.memoryType ? sql`AND m.memory_type = ${query.memoryType}` : sql``}
      AND (m.expires_at IS NULL OR m.expires_at > NOW())
      AND to_tsvector('english', m.content) @@ plainto_tsquery('english', ${query.text})
    ORDER BY ts_rank(to_tsvector('english', m.content), plainto_tsquery('english', ${query.text})) DESC,
             m.priority DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    memory: r as unknown as Memory,
    namespace: r.namespace,
    collectionName: r.collection_name ?? null,
  }));
}

/**
 * Get a summary of memory counts per namespace for a workspace.
 */
export async function getNamespaceMemoryCounts(
  sql: Sql,
  workspaceId: string,
): Promise<Array<{ namespace: string; memory_count: number; oldest: string | null; newest: string | null }>> {
  return sql<any[]>`
    SELECT
      c.namespace,
      COUNT(m.id)::int AS memory_count,
      MIN(m.created_at)::text AS oldest,
      MAX(m.created_at)::text AS newest
    FROM memory.collections c
    LEFT JOIN memory.memories m ON m.collection_id = c.id
      AND (m.expires_at IS NULL OR m.expires_at > NOW())
    WHERE c.workspace_id = ${workspaceId}
    GROUP BY c.namespace
    ORDER BY memory_count DESC
  `;
}
