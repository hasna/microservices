/**
 * Span dependency matrix — analyzes which span types call which other span types.
 * Produces a directed graph of span-type relationships useful for understanding
 * system architecture, identifying cross-service calls, and optimizing latency.
 */

import type { Sql } from "postgres";

export interface SpanDependency {
  caller_type: string;
  callee_type: string;
  call_count: number;
  total_duration_ms: number;
  avg_duration_ms: number;
  error_count: number;
  error_rate: number;
}

export interface DependencyMatrix {
  workspace_id: string;
  period_start: Date;
  period_end: Date;
  nodes: SpanTypeNode[];
  edges: SpanDependency[];
}

export interface SpanTypeNode {
  span_type: string;
  total_calls: number;
  total_duration_ms: number;
  avg_duration_ms: number;
  is_entry_point: boolean; // true if it has children but no parent within the same trace
  is_leaf: boolean;        // true if it has parent but no children within the same trace
}

/**
 * Get the full dependency matrix for a workspace: which span types call which.
 */
export async function getSpanDependencyMatrix(
  sql: Sql,
  workspaceId: string,
  opts: { periodStart?: Date; periodEnd?: Date } = {},
): Promise<DependencyMatrix> {
  const { periodStart, periodEnd } = opts;
  const start = periodStart ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const end = periodEnd ?? new Date();

  // Get caller->callee dependencies
  const edges = await sql<SpanDependency[]>`
    SELECT
      parent.type                    AS caller_type,
      child.type                     AS callee_type,
      COUNT(*)                       AS call_count,
      COALESCE(SUM(child.duration_ms), 0)::bigint AS total_duration_ms,
      ROUND(COALESCE(AVG(child.duration_ms), 0)::numeric, 2) AS avg_duration_ms,
      COUNT(*) FILTER (WHERE child.status = 'error') AS error_count,
      ROUND(
        COUNT(*) FILTER (WHERE child.status = 'error')::numeric
        / NULLIF(COUNT(*), 0) * 100, 4
      ) AS error_rate
    FROM traces.spans child
    JOIN traces.spans parent ON child.parent_span_id = parent.id
    JOIN traces.traces t ON child.trace_id = t.id
    WHERE t.workspace_id = ${workspaceId}
      AND t.started_at >= ${start}
      AND t.started_at <= ${end}
    GROUP BY parent.type, child.type
    ORDER BY call_count DESC
  `;

  // Get unique span types and their properties
  const allTypes = new Set<string>();
  edges.forEach(e => {
    allTypes.add(e.caller_type);
    allTypes.add(e.callee_type);
  });

  const typeSet = Array.from(allTypes);
  const nodes: SpanTypeNode[] = [];

  for (const spanType of typeSet) {
    // A span type is an entry point if it appears as a callee with no caller in our dataset
    // (meaning it was called by something outside our trace scope, e.g., an API gateway)
    const hasIncoming = edges.some(e => e.callee_type === spanType);
    const hasOutgoing = edges.some(e => e.caller_type === spanType);

    // Get aggregate stats for this span type
    const [row] = await sql<{ total_calls: string; total_duration_ms: string; avg_duration_ms: string }>`
      SELECT
        COUNT(*)::text AS total_calls,
        COALESCE(SUM(s.duration_ms), 0)::text AS total_duration_ms,
        ROUND(COALESCE(AVG(s.duration_ms), 0)::numeric, 2)::text AS avg_duration_ms
      FROM traces.spans s
      JOIN traces.traces t ON s.trace_id = t.id
      WHERE t.workspace_id = ${workspaceId}
        AND s.type = ${spanType}
        AND t.started_at >= ${start}
        AND t.started_at <= ${end}
    `;

    nodes.push({
      span_type: spanType,
      total_calls: parseInt(row?.total_calls ?? "0", 10),
      total_duration_ms: parseInt(row?.total_duration_ms ?? "0", 10),
      avg_duration_ms: parseFloat(row?.avg_duration_ms ?? "0"),
      is_entry_point: !hasIncoming,
      is_leaf: !hasOutgoing,
    });
  }

  return {
    workspace_id: workspaceId,
    period_start: start,
    period_end: end,
    nodes,
    edges: Array.from(edges),
  };
}

/**
 * Get top N hot paths (most frequently called caller->callee chains).
 */
export async function getHotPaths(
  sql: Sql,
  workspaceId: string,
  opts: { periodStart?: Date; periodEnd?: Date; limit?: number } = {},
): Promise<SpanDependency[]> {
  const { periodStart, periodEnd, limit = 20 } = opts;
  const start = periodStart ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const end = periodEnd ?? new Date();

  return sql<SpanDependency[]>`
    SELECT
      parent.type                    AS caller_type,
      child.type                     AS callee_type,
      COUNT(*)                       AS call_count,
      COALESCE(SUM(child.duration_ms), 0)::bigint AS total_duration_ms,
      ROUND(COALESCE(AVG(child.duration_ms), 0)::numeric, 2) AS avg_duration_ms,
      COUNT(*) FILTER (WHERE child.status = 'error') AS error_count,
      ROUND(
        COUNT(*) FILTER (WHERE child.status = 'error')::numeric
        / NULLIF(COUNT(*), 0) * 100, 4
      ) AS error_rate
    FROM traces.spans child
    JOIN traces.spans parent ON child.parent_span_id = parent.id
    JOIN traces.traces t ON child.trace_id = t.id
    WHERE t.workspace_id = ${workspaceId}
      AND t.started_at >= ${start}
      AND t.started_at <= ${end}
    GROUP BY parent.type, child.type
    ORDER BY call_count DESC
    LIMIT ${limit}
  `;
}

/**
 * Get the "critical path" — the chain of spans that contributes most to total trace duration.
 * Identifies the path with highest cumulative duration along parent->child relationships.
 */
export async function getCriticalPath(
  sql: Sql,
  workspaceId: string,
  traceId: string,
): Promise<{ span_id: string; span_name: string; span_type: string; duration_ms: number; cumulative_ms: number }[]> {
  // Get all spans for this trace ordered by start time
  const spans = await sql<{ id: string; name: string; type: string; parent_span_id: string | null; duration_ms: number; started_at: Date }[]>`
    SELECT s.id, s.name, s.type, s.parent_span_id, s.duration_ms, s.started_at
    FROM traces.spans s
    JOIN traces.traces t ON s.trace_id = t.id
    WHERE t.workspace_id = ${workspaceId}
      AND t.id = ${traceId}
    ORDER BY s.started_at ASC
  `;

  if (spans.length === 0) return [];

  // Build a map of span_id -> cumulative duration (depth-first)
  const spanMap = new Map(spans.map(s => [s.id, s]));
  const cumulativeMap = new Map<string, number>();

  // Find root spans (no parent in this trace)
  const roots = spans.filter(s => !s.parent_span_id || !spanMap.has(s.parent_span_id));

  function computeCumulative(spanId: string, parentCumulative: number): number {
    if (cumulativeMap.has(spanId)) return cumulativeMap.get(spanId)!;

    const span = spanMap.get(spanId);
    if (!span) return parentCumulative;

    const cumulative = parentCumulative + Number(span.duration_ms);
    cumulativeMap.set(spanId, cumulative);
    return cumulative;
  }

  // DFS to compute cumulative durations
  function dfs(nodeId: string, parentCumulative: number): void {
    const span = spanMap.get(nodeId);
    if (!span) return;

    const cumulative = computeCumulative(nodeId, parentCumulative);

    // Find children
    const children = spans.filter(s => s.parent_span_id === nodeId);
    for (const child of children) {
      dfs(child.id, cumulative);
    }
  }

  // Start DFS from each root
  for (const root of roots) {
    dfs(root.id, 0);
  }

  // Return sorted by cumulative duration
  const result = Array.from(cumulativeMap.entries())
    .map(([span_id, cumulative_ms]) => {
      const span = spanMap.get(span_id)!;
      return {
        span_id,
        span_name: span.name,
        span_type: span.type,
        duration_ms: Number(span.duration_ms),
        cumulative_ms,
      };
    })
    .sort((a, b) => b.cumulative_ms - a.cumulative_ms);

  return result;
}
