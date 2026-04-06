/**
 * Search analytics: track queries, result counts, and citation click-throughs.
 * Enables understanding search patterns, knowledge gaps, and content gaps.
 */

import type { Sql } from "postgres";
import { createHash } from "crypto";

export interface SearchAnalyticsEntry {
  id: string;
  collection_id: string;
  workspace_id: string;
  query_text: string;
  query_hash: string;
  result_count: number;
  mode: "semantic" | "text" | "hybrid";
  response_time_ms: number | null;
  cited_document_ids: string[] | null;
  clicked_document_ids: string[] | null;
  accessed_by: string | null;
  created_at: Date;
}

export interface SearchAnalyticsSummary {
  total_queries: number;
  total_results: number;
  avg_result_count: number;
  zero_result_count: number;
  avg_response_time_ms: number;
  top_modes: Record<string, number>;
  unique_queries: number;
}

export interface TopQuery {
  query_text: string;
  query_count: number;
  avg_result_count: number;
  last_seen: Date;
}

/**
 * Hash a query string for deduplication.
 */
export function hashQuery(query: string): string {
  return createHash("sha256").update(query.toLowerCase().trim()).digest("hex").slice(0, 32);
}

/**
 * Log a search query and its results.
 */
export async function logSearchQuery(
  sql: Sql,
  opts: {
    collectionId: string;
    workspaceId: string;
    queryText: string;
    resultCount: number;
    mode?: "semantic" | "text" | "hybrid";
    responseTimeMs?: number;
    citedDocumentIds?: string[];
    accessedBy?: string;
  },
): Promise<SearchAnalyticsEntry> {
  const {
    collectionId,
    workspaceId,
    queryText,
    resultCount,
    mode = "text",
    responseTimeMs,
    citedDocumentIds,
    accessedBy,
  } = opts;

  const [entry] = await sql<SearchAnalyticsEntry[]>`
    INSERT INTO knowledge.search_analytics_log (
      collection_id, workspace_id, query_text, query_hash,
      result_count, mode, response_time_ms, cited_document_ids, accessed_by
    )
    VALUES (
      ${collectionId},
      ${workspaceId},
      ${queryText},
      ${hashQuery(queryText)},
      ${resultCount},
      ${mode},
      ${responseTimeMs ?? null},
      ${citedDocumentIds ? sql.json(citedDocumentIds) : null},
      ${accessedBy ?? null}
    )
    RETURNING *
  `;
  return entry!;
}

/**
 * Record clicks (citation interactions) after a search.
 */
export async function recordSearchClicks(
  sql: Sql,
  logId: string,
  clickedDocumentIds: string[],
): Promise<void> {
  await sql`
    UPDATE knowledge.search_analytics_log
    SET clicked_document_ids = ${sql.json(clickedDocumentIds)}
    WHERE id = ${logId}
  `;
}

/**
 * Get search analytics summary for a workspace.
 */
export async function getSearchAnalytics(
  sql: Sql,
  workspaceId: string,
  fromHours = 24,
): Promise<SearchAnalyticsSummary> {
  const since = new Date(Date.now() - fromHours * 3600 * 1000);

  const [summary] = await sql<[{
    total_queries: number;
    total_results: number;
    zero_result_count: number;
    avg_response_time_ms: string | null;
    top_modes: Record<string, number>;
    unique_queries: number;
  }]>`
    SELECT
      COUNT(*) AS total_queries,
      COALESCE(SUM(result_count), 0)::int AS total_results,
      COUNT(*) FILTER (WHERE result_count = 0) AS zero_result_count,
      COALESCE(AVG(response_time_ms), 0)::int AS avg_response_time_ms,
      COUNT(DISTINCT query_hash) AS unique_queries,
      jsonb_object_agg(mode, count) FILTER (WHERE mode IS NOT NULL) AS top_modes
    FROM knowledge.search_analytics_log
    WHERE workspace_id = ${workspaceId}
      AND created_at >= ${since}
  `;

  return {
    total_queries: Number(summary?.total_queries ?? 0),
    total_results: Number(summary?.total_results ?? 0),
    avg_result_count: summary?.total_queries > 0
      ? Math.round((summary!.total_results / summary!.total_queries) * 100) / 100
      : 0,
    zero_result_count: Number(summary?.zero_result_count ?? 0),
    avg_response_time_ms: Number(summary?.avg_response_time_ms ?? 0),
    unique_queries: Number(summary?.unique_queries ?? 0),
    top_modes: (summary?.top_modes ?? {}) as Record<string, number>,
  };
}

/**
 * Get top queries by frequency in a workspace.
 */
export async function getTopQueries(
  sql: Sql,
  workspaceId: string,
  limit = 20,
  fromHours = 168,
): Promise<TopQuery[]> {
  const since = new Date(Date.now() - fromHours * 3600 * 1000);

  const rows = await sql<Array<{
    query_text: string;
    query_count: number;
    avg_result_count: number;
    last_seen: Date;
  }>>`
    SELECT
      query_text,
      COUNT(*) AS query_count,
      AVG(result_count)::int AS avg_result_count,
      MAX(created_at) AS last_seen
    FROM knowledge.search_analytics_log
    WHERE workspace_id = ${workspaceId}
      AND created_at >= ${since}
    GROUP BY query_text
    ORDER BY query_count DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    query_text: r.query_text,
    query_count: Number(r.query_count),
    avg_result_count: Number(r.avg_result_count),
    last_seen: r.last_seen,
  }));
}

/**
 * Get queries that returned zero results — signals content gaps.
 */
export async function getNoResultQueries(
  sql: Sql,
  workspaceId: string,
  limit = 50,
  fromHours = 168,
): Promise<TopQuery[]> {
  const since = new Date(Date.now() - fromHours * 3600 * 1000);

  const rows = await sql<Array<{
    query_text: string;
    query_count: number;
    avg_result_count: number;
    last_seen: Date;
  }>>`
    SELECT
      query_text,
      COUNT(*) AS query_count,
      AVG(result_count)::int AS avg_result_count,
      MAX(created_at) AS last_seen
    FROM knowledge.search_analytics_log
    WHERE workspace_id = ${workspaceId}
      AND result_count = 0
      AND created_at >= ${since}
    GROUP BY query_text
    ORDER BY query_count DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    query_text: r.query_text,
    query_count: Number(r.query_count),
    avg_result_count: 0,
    last_seen: r.last_seen,
  }));
}
