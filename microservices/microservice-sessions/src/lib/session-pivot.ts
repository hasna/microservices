/**
 * Session pivot tables — multi-dimensional aggregation of session data
 * for analytics and reporting.
 */

import type { Sql } from "postgres";

export interface PivotDimension {
  field: "hour" | "day" | "week" | "month" | "user_id" | "model" | "channel" | "workspace_id";
  label: string;
}

export interface PivotCell {
  dimension_value: string;
  message_count: number;
  session_count: number;
  total_tokens: number;
  avg_session_length: number;
  unique_users: number;
}

export interface PivotTableResult {
  dimensions: PivotDimension[];
  rows: PivotCell[];
  totals: {
    message_count: number;
    session_count: number;
    total_tokens: number;
    avg_session_length: number;
    unique_users: number;
  };
}

/**
 * Run a pivot table query on session data with configurable dimensions.
 */
export async function pivotSessions(
  sql: Sql,
  workspaceId: string,
  dimensions: PivotDimension[],
  opts?: {
    since?: string;
    until?: string;
    groupLimit?: number;
  },
): Promise<PivotTableResult> {
  const since = opts?.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const until = opts?.until ?? new Date().toISOString();
  const groupLimit = opts?.groupLimit ?? 100;

  if (dimensions.length === 0) {
    throw new Error("At least one dimension is required for pivot");
  }

  // Build dimension expressions
  const dimExpressions: string[] = [];
  for (const dim of dimensions) {
    switch (dim.field) {
      case "hour":
        dimExpressions.push("EXTRACT(HOUR FROM m.created_at)::text");
        break;
      case "day":
        dimExpressions.push("DATE(m.created_at)::text");
        break;
      case "week":
        dimExpressions.push("DATE_TRUNC('week', m.created_at)::text");
        break;
      case "month":
        dimExpressions.push("TO_CHAR(m.created_at, 'YYYY-MM')");
        break;
      case "user_id":
        dimExpressions.push("c.user_id");
        break;
      case "model":
        dimExpressions.push("COALESCE(m.model, 'unknown')");
        break;
      case "channel":
        dimExpressions.push("COALESCE(m.metadata->>'channel', 'unknown')");
        break;
      case "workspace_id":
        dimExpressions.push("c.workspace_id");
        break;
    }
  }

  // Build GROUP BY clause
  const groupByClause = dimExpressions.join(", ");

  // Build the aggregation query
  const rows = await sql<{
    dimension_value: string;
    message_count: number;
    session_count: number;
    total_tokens: number;
    avg_session_length: number;
    unique_users: number;
  }[]>`
    WITH pivot_data AS (
      SELECT
        ${sql.unsafe(groupByClause)} as dim_value,
        COUNT(*)::int as message_count,
        COUNT(DISTINCT c.id)::int as session_count,
        COALESCE(SUM(m.tokens), 0)::int as total_tokens,
        COALESCE(AVG(m.total_in_session), 0)::float as avg_session_length,
        COUNT(DISTINCT c.user_id)::int as unique_users
      FROM sessions.messages m
      JOIN sessions.conversations c ON c.id = m.conversation_id
      WHERE c.workspace_id = ${workspaceId}
        AND m.created_at >= ${since}
        AND m.created_at <= ${until}
      GROUP BY ${sql.unsafe(groupByClause)}
      ORDER BY message_count DESC
      LIMIT ${groupLimit}
    )
    SELECT * FROM pivot_data
  `;

  // Calculate totals
  const [totals] = await sql<{
    message_count: number;
    session_count: number;
    total_tokens: number;
    avg_session_length: number;
    unique_users: number;
  }[]>`
    SELECT
      COUNT(*)::int as message_count,
      COUNT(DISTINCT c.id)::int as session_count,
      COALESCE(SUM(m.tokens), 0)::int as total_tokens,
      COALESCE(AVG(m.total_in_session), 0)::float as avg_session_length,
      COUNT(DISTINCT c.user_id)::int as unique_users
    FROM sessions.messages m
    JOIN sessions.conversations c ON c.id = m.conversation_id
    WHERE c.workspace_id = ${workspaceId}
      AND m.created_at >= ${since}
      AND m.created_at <= ${until}
  `;

  return {
    dimensions,
    rows: rows.map(r => ({
      dimension_value: r.dimension_value,
      message_count: r.message_count,
      session_count: r.session_count,
      total_tokens: r.total_tokens,
      avg_session_length: Math.round(r.avg_session_length * 10) / 10,
      unique_users: r.unique_users,
    })),
    totals: {
      message_count: totals.message_count,
      session_count: totals.session_count,
      total_tokens: totals.total_tokens,
      avg_session_length: Math.round(totals.avg_session_length * 10) / 10,
      unique_users: totals.unique_users,
    },
  };
}

/**
 * Run a cross-tabulation (two-dimensional pivot) query.
 */
export async function crossTabSessions(
  sql: Sql,
  workspaceId: string,
  rowDim: PivotDimension["field"],
  colDim: PivotDimension["field"],
  measure: "messages" | "sessions" | "tokens" = "messages",
  opts?: { since?: string; until?: string },
): Promise<{
  row_dim: PivotDimension["field"];
  col_dim: PivotDimension["field"];
  measure: string;
  rows: { row_value: string; cols: Record<string, number>; row_total: number }[];
  col_totals: Record<string, number>;
  row_totals: number[];
}> {
  const since = opts?.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const until = opts?.until ?? new Date().toISOString();

  const rowExpr = getDimensionExpr(rowDim, "m", "c");
  const colExpr = getDimensionExpr(colDim, "m", "c");

  const measureExpr = measure === "messages" ? "COUNT(*)" : measure === "sessions" ? "COUNT(DISTINCT c.id)" : "COALESCE(SUM(m.tokens), 0)";

  const rows = await sql<{ row_value: string; col_value: string; measure: number }[]>`
    SELECT
      ${sql.unsafe(rowExpr)} as row_value,
      ${sql.unsafe(colExpr)} as col_value,
      ${sql.unsafe(measureExpr)}::int as measure
    FROM sessions.messages m
    JOIN sessions.conversations c ON c.id = m.conversation_id
    WHERE c.workspace_id = ${workspaceId}
      AND m.created_at >= ${since}
      AND m.created_at <= ${until}
    GROUP BY ${sql.unsafe(rowExpr)}, ${sql.unsafe(colExpr)}
    ORDER BY row_value, col_value
  `;

  // Group by row value
  const rowMap = new Map<string, Record<string, number>>();
  const colTotals: Record<string, number> = {};
  const rowTotals: number[] = [];

  for (const row of rows) {
    if (!rowMap.has(row.row_value)) {
      rowMap.set(row.row_value, {});
    }
    rowMap.get(row.row_value)![row.col_value] = row.measure;
    colTotals[row.col_value] = (colTotals[row.col_value] ?? 0) + row.measure;
  }

  const resultRows = Array.from(rowMap.entries()).map(([rowValue, cols]) => {
    const rowTotal = Object.values(cols).reduce((a, b) => a + b, 0);
    rowTotals.push(rowTotal);
    return { row_value: rowValue, cols, row_total: rowTotal };
  });

  return {
    row_dim: rowDim,
    col_dim: colDim,
    measure,
    rows: resultRows,
    col_totals: colTotals,
    row_totals: rowTotals,
  };
}

function getDimensionExpr(field: PivotDimension["field"], msgAlias: string, convAlias: string): string {
  switch (field) {
    case "hour":
      return `EXTRACT(HOUR FROM ${msgAlias}.created_at)::text`;
    case "day":
      return `DATE(${msgAlias}.created_at)::text`;
    case "week":
      return `DATE_TRUNC('week', ${msgAlias}.created_at)::text`;
    case "month":
      return `TO_CHAR(${msgAlias}.created_at, 'YYYY-MM')`;
    case "user_id":
      return `${convAlias}.user_id`;
    case "model":
      return `COALESCE(${msgAlias}.model, 'unknown')`;
    case "channel":
      return `COALESCE(${msgAlias}.metadata->>'channel', 'unknown')`;
    case "workspace_id":
      return `${convAlias}.workspace_id`;
  }
}

/**
 * Get session distribution histogram (bucketed by message count).
 */
export async function getSessionDistribution(
  sql: Sql,
  workspaceId: string,
  buckets?: number[],
): Promise<{ bucket: string; count: number; pct: number }[]> {
  const bucketBoundaries = buckets ?? [1, 2, 5, 10, 20, 50, 100];

  const conditions: string[] = [];
  const params: (string | number)[] = [workspaceId];

  for (let i = 0; i < bucketBoundaries.length; i++) {
    const upper = bucketBoundaries[i];
    conditions.push(`COUNT(*) <= ${upper}`);
    params.push(upper);
  }

  const rows = await sql<{ bucket: string; count: number }[]>`
    WITH session_counts AS (
      SELECT COUNT(*)::int as msg_count
      FROM sessions.messages m
      JOIN sessions.conversations c ON c.id = m.conversation_id
      WHERE c.workspace_id = ${workspaceId}
      GROUP BY c.id
    )
    SELECT
      CASE
        ${sql.unsafe(bucketBoundaries.map((b, i) =>
          i === 0 ? `WHEN msg_count <= ${b} THEN '${b === 1 ? '1' : `<=${b}`}'`
          : i === bucketBoundaries.length - 1 ? `WHEN msg_count > ${bucketBoundaries[i-1]} THEN '>${bucketBoundaries[i-1]}'`
          : `WHEN msg_count <= ${b} THEN '${bucketBoundaries[i-1]+1}-${b}'`
        ).join(" ELSE "))}
      END as bucket,
      COUNT(*)::int as count
    FROM session_counts
    GROUP BY bucket
    ORDER BY MIN(msg_count)
  `;

  const total = rows.reduce((sum, r) => sum + r.count, 0);

  return rows.map(r => ({
    bucket: r.bucket,
    count: r.count,
    pct: total > 0 ? Math.round((r.count / total) * 10000) / 100 : 0,
  }));
}