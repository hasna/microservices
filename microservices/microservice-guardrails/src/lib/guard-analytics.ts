/**
 * Guardrails analytics dashboard.
 *
 * High-level analytics for guardrails: top violations, trend analysis,
 * and rule effectiveness scores derived from audit log data.
 */

import type { Sql } from "postgres";

export interface TopViolation {
  type: string;
  severity: string;
  count: number;
  percentage: number;
  trend: "rising" | "falling" | "stable";
}

export interface RuleEffectiveness {
  ruleId: string;
  ruleName: string;
  checkCount: number;
  violationCount: number;
  falsePositiveCount: number;
  effectivenessScore: number; // 0-100; high = good (low false positive rate)
  lastUsed: Date | null;
}

export interface GuardAnalyticsSummary {
  totalChecks: number;
  totalViolations: number;
  overallViolationRate: number;
  topViolations: TopViolation[];
  mostEffectiveRules: RuleEffectiveness[];
  leastEffectiveRules: RuleEffectiveness[];
  piiTypeBreakdown: { piiType: string; count: number; percentage: number }[];
  avgLatencyMs: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface GuardTrendDataPoint {
  timestamp: Date;
  checks: number;
  violations: number;
  violationRate: number;
}

export interface GuardTrend {
  period: "hourly" | "daily" | "weekly";
  dataPoints: GuardTrendDataPoint[];
  overallTrend: "rising" | "falling" | "stable";
  violationRateChange: number; // percentage point change
}

/**
 * Get guardrails analytics summary for a workspace.
 */
export async function getGuardAnalyticsSummary(
  sql: Sql,
  workspaceId: string,
  periodHours = 24,
): Promise<GuardAnalyticsSummary> {
  const since = new Date(Date.now() - periodHours * 3600_000);
  const now = new Date();

  const [totalChecksResult, totalViolationsResult, topViolations, piiBreakdown, latencyResult] = await Promise.all([
    sql.unsafe(`
      SELECT COUNT(*) as count FROM guardrails.audit_log
      WHERE workspace_id = $1 AND created_at >= $2
    `, [workspaceId, since]) as Promise<[{ count: string }]>,

    sql.unsafe(`
      SELECT COUNT(*) as count FROM guardrails.violations
      WHERE workspace_id = $1 AND created_at >= $2
    `, [workspaceId, since]) as Promise<[{ count: string }]>,

    sql.unsafe(`
      SELECT type, severity, COUNT(*) as count
      FROM guardrails.violations
      WHERE workspace_id = $1 AND created_at >= $2
      GROUP BY type, severity
      ORDER BY count DESC
      LIMIT 10
    `, [workspaceId, since]) as Promise<{ type: string; severity: string; count: string }[]>,

    sql.unsafe(`
      SELECT pii_type, COUNT(*) as count
      FROM guardrails.violations
      WHERE workspace_id = $1 AND created_at >= $2 AND pii_type IS NOT NULL
      GROUP BY pii_type
      ORDER BY count DESC
    `, [workspaceId, since]) as Promise<{ pii_type: string; count: string }[]>,

    sql.unsafe(`
      SELECT AVG(latency_ms) as avg FROM guardrails.audit_log
      WHERE workspace_id = $1 AND created_at >= $2 AND latency_ms IS NOT NULL
    `, [workspaceId, since]) as Promise<[{ avg: string | null }]>,
  ]);

  const totalChecks = parseInt(totalChecksResult[0].count, 10);
  const totalViolations = parseInt(totalViolationsResult[0].count, 10);
  const overallViolationRate = totalChecks > 0 ? (totalViolations / totalChecks) * 100 : 0;

  // Compute trend for each top violation
  const halfPeriod = new Date(Date.now() - (periodHours / 2) * 3600_000);
  const topViolationTypes = topViolations.map(v => v.type);

  const trends = await computeTrends(sql, workspaceId, since, halfPeriod, topViolationTypes);

  const topViolationsWithTrend: TopViolation[] = topViolations.map(v => {
    const totalForType = parseInt(v.count, 10);
    const percentage = totalViolations > 0 ? (totalForType / totalViolations) * 100 : 0;
    return {
      type: v.type,
      severity: v.severity,
      count: totalForType,
      percentage,
      trend: trends[v.type] ?? "stable",
    };
  });

  const piiTypeBreakdown = piiBreakdown.map(p => ({
    piiType: p.pii_type,
    count: parseInt(p.count, 10),
    percentage: totalViolations > 0 ? (parseInt(p.count, 10) / totalViolations) * 100 : 0,
  }));

  const [mostEffective, leastEffective] = await Promise.all([
    getRuleEffectiveness(sql, workspaceId, since, "effective"),
    getRuleEffectiveness(sql, workspaceId, since, "ineffective"),
  ]);

  return {
    totalChecks,
    totalViolations,
    overallViolationRate: Math.round(overallViolationRate * 100) / 100,
    topViolations: topViolationsWithTrend,
    mostEffectiveRules: mostEffective,
    leastEffectiveRules: leastEffective,
    piiTypeBreakdown,
    avgLatencyMs: latencyResult[0].avg ? Math.round(parseFloat(latencyResult[0].avg) * 100) / 100 : 0,
    periodStart: since,
    periodEnd: now,
  };
}

async function computeTrends(
  sql: Sql,
  workspaceId: string,
  since: Date,
  halfPeriod: Date,
  types: string[],
): Promise<Record<string, "rising" | "falling" | "stable">> {
  if (types.length === 0) return {};

  // First half: $1=workspaceId, $2=since, $3=halfPeriod, $4+=types
  const firstTypePlaceholders = types.map((_, i) => "$" + (i + 4)).join(",");
  const firstHalfRows = await sql.unsafe(
    "SELECT type, COUNT(*) as count " +
    "FROM guardrails.violations " +
    "WHERE workspace_id = $1 AND created_at >= $2 AND created_at < $3 AND type IN (" + firstTypePlaceholders + ") " +
    "GROUP BY type",
    [workspaceId, since, halfPeriod, ...types],
  ) as Promise<{ type: string; count: string }[]>;

  // Second half: $1=workspaceId, $2=halfPeriod, $3+=types
  const secondTypePlaceholders = types.map((_, i) => "$" + (i + 3)).join(",");
  const secondHalfRows = await sql.unsafe(
    "SELECT type, COUNT(*) as count " +
    "FROM guardrails.violations " +
    "WHERE workspace_id = $1 AND created_at >= $2 AND type IN (" + secondTypePlaceholders + ") " +
    "GROUP BY type",
    [workspaceId, halfPeriod, ...types],
  ) as Promise<{ type: string; count: string }[]>;

  const firstHalfMap: Record<string, number> = {};
  for (const r of firstHalfRows) firstHalfMap[r.type] = parseInt(r.count, 10);

  const secondHalfMap: Record<string, number> = {};
  for (const r of secondHalfRows) secondHalfMap[r.type] = parseInt(r.count, 10);

  const result: Record<string, "rising" | "falling" | "stable"> = {};
  for (const type of types) {
    const first = firstHalfMap[type] ?? 0;
    const second = secondHalfMap[type] ?? 0;
    if (second > first * 1.2) result[type] = "rising";
    else if (second < first * 0.8) result[type] = "falling";
    else result[type] = "stable";
  }
  return result;
}

async function getRuleEffectiveness(
  sql: Sql,
  workspaceId: string,
  since: Date,
  sort: "effective" | "ineffective",
): Promise<RuleEffectiveness[]> {
  const order = sort === "effective" ? "DESC" : "ASC";
  const rows = await sql.unsafe(
    "SELECT " +
    "r.id as rule_id, " +
    "r.name as rule_name, " +
    "COUNT(a.id) as check_count, " +
    "COUNT(v.id) as violation_count, " +
    "COUNT(CASE WHEN a.result = 'pass' AND v.id IS NULL THEN 1 END) as false_positive_count, " +
    "MAX(a.created_at) as last_used " +
    "FROM guardrails.rules r " +
    "LEFT JOIN guardrails.audit_log a ON a.rule_id = r.id AND a.created_at >= $2 " +
    "LEFT JOIN guardrails.violations v ON v.rule_id = r.id AND v.created_at >= $2 " +
    "WHERE r.workspace_id = $1 " +
    "GROUP BY r.id, r.name " +
    "HAVING COUNT(a.id) > 0 " +
    "ORDER BY " +
    "CASE WHEN COUNT(v.id) = 0 THEN 0 " +
    "ELSE COUNT(CASE WHEN a.result = 'pass' THEN 1 END)::float / COUNT(a.id) END " + order + " " +
    "LIMIT 5",
    [workspaceId, since],
  ) as Promise<{
    rule_id: string;
    rule_name: string;
    check_count: string;
    violation_count: string;
    false_positive_count: string;
    last_used: Date | null;
  }[]>;

  return rows.map(r => {
    const checkCount = parseInt(r.check_count, 10);
    const violationCount = parseInt(r.violation_count, 10);
    const falsePositiveCount = parseInt(r.false_positive_count, 10);
    const effectivenessScore = checkCount > 0
      ? Math.round(((checkCount - falsePositiveCount) / checkCount) * 100)
      : 0;

    return {
      ruleId: r.rule_id,
      ruleName: r.rule_name,
      checkCount,
      violationCount,
      falsePositiveCount,
      effectivenessScore,
      lastUsed: r.last_used,
    };
  });
}

/**
 * Get guardrails trend data over time.
 */
export async function getGuardTrend(
  sql: Sql,
  workspaceId: string,
  periodHours = 168,
  granularity: "hourly" | "daily" | "weekly" = "hourly",
): Promise<GuardTrend> {
  const since = new Date(Date.now() - periodHours * 3600_000);
  const interval = granularity === "hourly" ? "1 hour" : granularity === "daily" ? "1 day" : "1 week";

  const rows = await sql.unsafe(
    "SELECT " +
    "date_trunc($3, created_at) as bucket, " +
    "COUNT(DISTINCT a.id) as checks, " +
    "COUNT(DISTINCT v.id) as violations " +
    "FROM guardrails.audit_log a " +
    "LEFT JOIN guardrails.violations v " +
    "  ON v.workspace_id = a.workspace_id " +
    "  AND v.created_at >= $2 " +
    "  AND date_trunc($3, v.created_at) = date_trunc($3, a.created_at) " +
    "WHERE a.workspace_id = $1 AND a.created_at >= $2 " +
    "GROUP BY bucket " +
    "ORDER BY bucket ASC",
    [workspaceId, since, interval],
  ) as Promise<{
    bucket: Date;
    checks: string;
    violations: string;
  }[]>;

  const dataPoints: GuardTrendDataPoint[] = rows.map(r => {
    const checks = parseInt(r.checks, 10);
    const violations = parseInt(r.violations, 10);
    return {
      timestamp: r.bucket,
      checks,
      violations,
      violationRate: checks > 0 ? (violations / checks) * 100 : 0,
    };
  });

  let overallTrend: "rising" | "falling" | "stable" = "stable";
  let violationRateChange = 0;

  if (dataPoints.length >= 2) {
    const firstRate = dataPoints[0].violationRate;
    const lastRate = dataPoints[dataPoints.length - 1].violationRate;
    violationRateChange = Math.round((lastRate - firstRate) * 100) / 100;

    if (lastRate > firstRate * 1.2) overallTrend = "rising";
    else if (lastRate < firstRate * 0.8) overallTrend = "falling";
  }

  return {
    period: granularity,
    dataPoints,
    overallTrend,
    violationRateChange,
  };
}
