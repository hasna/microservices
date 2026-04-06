/**
 * Memory analytics — advanced insights and trend analysis for memory usage.
 */

import type { Sql } from "postgres";

export interface MemoryTrends {
  period: string;
  memories_created: number;
  memories_accessed: number;
  avg_importance: number;
  top_memory_types: Array<{ type: string; count: number }>;
  top_namespaces: Array<{ namespace: string; count: number }>;
}

export interface AccessHeatmap {
  hour: number;
  day_of_week: number;
  access_count: number;
}

export interface MemoryHealthScore {
  workspace_id: string;
  overall_score: number; // 0-100
  coverage_score: number; // are important topics covered?
  freshness_score: number; // are memories up to date?
  utilization_score: number; // how actively are memories used?
  retention_score: number; // are important memories retained?
  recommendations: string[];
}

/**
 * Get memory creation/access trends over time.
 */
export async function getMemoryTrends(
  sql: Sql,
  workspaceId: string,
  periodDays = 30,
): Promise<MemoryTrends> {
  const [created] = await sql<{ count: number }[]>`
    SELECT COUNT(*) as count FROM memory.memories m
    JOIN memory.namespaces n ON m.namespace_id = n.id
    WHERE n.workspace_id = ${workspaceId}
      AND m.created_at > NOW() - INTERVAL '${periodDays} days'
  `;

  const [accessed] = await sql<{ count: number }[]>`
    SELECT COUNT(DISTINCT mal.memory_id) as count
    FROM memory.memory_access_log mal
    JOIN memory.memories m ON mal.memory_id = m.id
    JOIN memory.namespaces n ON m.namespace_id = n.id
    WHERE n.workspace_id = ${workspaceId}
      AND mal.accessed_at > NOW() - INTERVAL '${periodDays} days'
  `;

  const [avgImp] = await sql<{ avg: number }[]>`
    SELECT COALESCE(AVG(m.importance), 0) as avg FROM memory.memories m
    JOIN memory.namespaces n ON m.namespace_id = n.id
    WHERE n.workspace_id = ${workspaceId}
  `;

  const topTypes = await sql<{ memory_type: string; count: number }[]>`
    SELECT memory_type, COUNT(*) as count
    FROM memory.memories m
    JOIN memory.namespaces n ON m.namespace_id = n.id
    WHERE n.workspace_id = ${workspaceId}
    GROUP BY memory_type
    ORDER BY count DESC
    LIMIT 5
  `;

  const topNamespaces = await sql<{ namespace_id: string; count: number }[]>`
    SELECT m.namespace_id, COUNT(*) as count
    FROM memory.memories m
    JOIN memory.namespaces n ON m.namespace_id = n.id
    WHERE n.workspace_id = ${workspaceId}
    GROUP BY m.namespace_id
    ORDER BY count DESC
    LIMIT 5
  `;

  return {
    period: `last ${periodDays} days`,
    memories_created: created?.count ?? 0,
    memories_accessed: accessed?.count ?? 0,
    avg_importance: Math.round((avgImp?.avg ?? 0) * 100) / 100,
    top_memory_types: topTypes.map((t) => ({ type: t.memory_type, count: t.count })),
    top_namespaces: topNamespaces.map((ns) => ({ namespace: ns.namespace_id, count: ns.count })),
  };
}

/**
 * Get access heatmap (hour × day-of-week).
 */
export async function getAccessHeatmap(
  sql: Sql,
  workspaceId: string,
  days = 30,
): Promise<AccessHeatmap[]> {
  const heatmap: AccessHeatmap[] = [];
  for (let h = 0; h < 24; h++) {
    for (let d = 0; d < 7; d++) {
      heatmap.push({ hour: h, day_of_week: d, access_count: 0 });
    }
  }

  const data = await sql<{ hour: number; dow: number; count: number }[]>`
    SELECT
      EXTRACT(HOUR FROM mal.accessed_at)::int as hour,
      EXTRACT(DOW FROM mal.accessed_at)::int as dow,
      COUNT(*) as count
    FROM memory.memory_access_log mal
    JOIN memory.memories m ON mal.memory_id = m.id
    JOIN memory.namespaces n ON m.namespace_id = n.id
    WHERE n.workspace_id = ${workspaceId}
      AND mal.accessed_at > NOW() - INTERVAL '${days} days'
    GROUP BY 1, 2
  `;

  for (const row of data) {
    const idx = row.dow * 24 + row.hour;
    if (idx >= 0 && idx < heatmap.length) {
      heatmap[idx].access_count = row.count;
    }
  }

  return heatmap;
}

/**
 * Compute overall health score for a workspace's memory system.
 */
export async function computeMemoryHealthScore(
  sql: Sql,
  workspaceId: string,
): Promise<MemoryHealthScore> {
  const recommendations: string[] = [];

  // Coverage: how many memories have summaries (indicates they're well-described)
  const [withSummary] = await sql<{ count: number; total: number }[]>`
    SELECT
      COUNT(*) FILTER (WHERE m.summary IS NOT NULL AND m.summary != '') as count,
      COUNT(*) as total
    FROM memory.memories m
    JOIN memory.namespaces n ON m.namespace_id = n.id
    WHERE n.workspace_id = ${workspaceId}
  `;
  const coverageScore = withSummary?.total > 0
    ? Math.round((withSummary.count / withSummary.total) * 100)
    : 0;
  if (coverageScore < 50) recommendations.push("Less than 50% of memories have summaries — consider adding summaries to improve recall");

  // Freshness: how many memories were updated in last 7 days
  const [recent] = await sql<{ count: number; total: number }[]>`
    SELECT
      COUNT(*) FILTER (WHERE m.updated_at > NOW() - INTERVAL '7 days') as count,
      COUNT(*) as total
    FROM memory.memories m
    JOIN memory.namespaces n ON m.namespace_id = n.id
    WHERE n.workspace_id = ${workspaceId}
  `;
  const freshnessScore = recent?.total > 0
    ? Math.round((recent.count / recent.total) * 100)
    : 0;
  if (freshnessScore < 20) recommendations.push("Less than 20% of memories updated recently — consider reviewing old memories");

  // Utilization: how many memories were accessed in last 30 days
  const [utilized] = await sql<{ count: number; total: number }[]>`
    SELECT
      COUNT(DISTINCT mal.memory_id) as count,
      COUNT(*) as total
    FROM memory.memories m
    JOIN memory.namespaces n ON m.namespace_id = n.id
    LEFT JOIN memory.memory_access_log mal ON mal.memory_id = m.id
      AND mal.accessed_at > NOW() - INTERVAL '30 days'
    WHERE n.workspace_id = ${workspaceId}
  `;
  const utilizationScore = utilized?.total > 0
    ? Math.round(((utilized.count ?? 0) / utilized.total) * 100)
    : 0;
  if (utilizationScore < 30) recommendations.push("Less than 30% of memories accessed in last month — consider pruning unused memories");

  // Retention: how many high-importance memories are still present
  const [retained] = await sql<{ count: number; total: number }[]>`
    SELECT
      COUNT(*) FILTER (WHERE m.importance >= 0.7) as count,
      COUNT(*) FILTER (WHERE m.importance >= 0.7) as total
    FROM memory.memories m
    JOIN memory.namespaces n ON m.namespace_id = n.id
    WHERE n.workspace_id = ${workspaceId}
  `;
  const retentionScore = retained?.total > 0 ? 100 : 0; // simplified

  const overallScore = Math.round(
    (coverageScore + freshnessScore + utilizationScore + retentionScore) / 4,
  );

  return {
    workspace_id: workspaceId,
    overall_score: overallScore,
    coverage_score: coverageScore,
    freshness_score: freshnessScore,
    utilization_score: utilizationScore,
    retention_score: retentionScore,
    recommendations,
  };
}

/**
 * Get memory type distribution over time.
 */
export async function getMemoryTypeTrend(
  sql: Sql,
  workspaceId: string,
  days = 30,
): Promise<Array<{
  date: string;
  episodic: number;
  semantic: number;
  procedural: number;
  context: number;
}>> {
  const data = await sql<{ date: string; memory_type: string; count: number }[]>`
    SELECT
      DATE(m.created_at)::text as date,
      m.memory_type,
      COUNT(*) as count
    FROM memory.memories m
    JOIN memory.namespaces n ON m.namespace_id = n.id
    WHERE n.workspace_id = ${workspaceId}
      AND m.created_at > NOW() - INTERVAL '${days} days'
    GROUP BY 1, 2
    ORDER BY 1
  `;

  // Pivot into date-indexed structure
  const byDate = new Map<string, { episodic: number; semantic: number; procedural: number; context: number }>();
  for (const row of data) {
    if (!byDate.has(row.date)) {
      byDate.set(row.date, { episodic: 0, semantic: 0, procedural: 0, context: 0 });
    }
    const entry = byDate.get(row.date)!;
    if (row.memory_type in entry) {
      (entry as any)[row.memory_type] = row.count;
    }
  }

  return [...byDate.entries()].map(([date, counts]) => ({ date, ...counts }));
}
