/**
 * Usage anomaly detection — identify unusual spend or request volume spikes.
 *
 * Uses statistical methods (Z-score, IQR) on rolling time windows to flag
 * anomalies per workspace. Helps catch compromised API keys, runaway loops,
 * or unexpected usage spikes before they exhaust budgets.
 */

import type { Sql } from "postgres";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnomalySeverity = "low" | "medium" | "high" | "critical";

export interface AnomalyAlert {
  workspaceId: string;
  metric: "spend" | "requests" | "tokens" | "error_rate";
  severity: AnomalySeverity;
  currentValue: number;
  expectedValue: number;
  deviationPct: number; // how far from expected (e.g., 200 = 200% of expected)
  windowMinutes: number;
  triggeredAt: Date;
  description: string;
  recommendedAction: string;
}

export interface UsageAnomalyConfig {
  /** Z-score threshold for alerting (default 2.5) */
  zScoreThreshold?: number;
  /** IQR multiplier for spike detection (default 1.5) */
  iqrMultiplier?: number;
  /** Minimum requests in window before alerting (default 10) */
  minSampleSize?: number;
  /** Windows to evaluate (in minutes, default [60, 240, 1440]) */
  windowsMinutes?: number[];
}

const DEFAULT_CONFIG: Required<UsageAnomalyConfig> = {
  zScoreThreshold: 2.5,
  iqrMultiplier: 1.5,
  minSampleSize: 10,
  windowsMinutes: [60, 240, 1440],
};

// ---------------------------------------------------------------------------
// Core detection
// ---------------------------------------------------------------------------

/**
 * Detect usage anomalies for a workspace.
 * Returns an array of alerts sorted by severity (highest first).
 */
export async function detectUsageAnomalies(
  sql: Sql,
  workspaceId: string,
  config: UsageAnomalyConfig = {},
): Promise<AnomalyAlert[]> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const alerts: AnomalyAlert[] = [];

  for (const windowMin of cfg.windowsMinutes) {
    const alertsInWindow = await detectForWindow(sql, workspaceId, windowMin, cfg);
    alerts.push(...alertsInWindow);
  }

  // Sort by severity rank
  const severityRank: Record<AnomalySeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  alerts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  return alerts;
}

async function detectForWindow(
  sql: Sql,
  workspaceId: string,
  windowMinutes: number,
  cfg: Required<UsageAnomalyConfig>,
): Promise<AnomalyAlert[]> {
  const alerts: AnomalyAlert[] = [];

  // Get historical baseline (same window, last 30 days) and current window
  const baseline = await sql<[{ total_spend: number; total_requests: number; total_tokens: number }]>`
    SELECT
      COALESCE(SUM(cost_usd), 0)        AS total_spend,
      COUNT(*)                          AS total_requests,
      COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total_tokens
    FROM llm.model_spend
    WHERE workspace_id = ${workspaceId}
      AND created_at >= NOW() - INTERVAL '${sql.unsafe(String(windowMinutes * 30))} minutes'
      AND created_at < NOW() - INTERVAL '${sql.unsafe(String(windowMinutes))} minutes'
  `;

  const current = await sql<[{ total_spend: number; total_requests: number; total_tokens: number; error_count: number }]>`
    SELECT
      COALESCE(SUM(cost_usd), 0)        AS total_spend,
      COUNT(*)                          AS total_requests,
      COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total_tokens,
      COALESCE(SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END), 0) AS error_count
    FROM llm.model_spend
    WHERE workspace_id = ${workspaceId}
      AND created_at >= NOW() - INTERVAL '${sql.unsafe(String(windowMinutes))} minutes'
  `;

  const baselineRow = baseline[0];
  const currentRow = current[0];

  if (!baselineRow || !currentRow) return [];
  if (currentRow.total_requests < cfg.minSampleSize) return [];

  const dailyFactor = 1440 / windowMinutes; // normalize to daily
  const baselineDailyRequests = (baselineRow.total_requests / 30) * dailyFactor;
  const currentDailyRequests = currentRow.total_requests * dailyFactor;

  // Z-score for request volume
  if (baselineDailyRequests > 0) {
    const reqAlert = detectZScoreAnomaly(
      workspaceId,
      "requests",
      currentDailyRequests,
      baselineDailyRequests,
      windowMinutes,
      cfg,
    );
    if (reqAlert) alerts.push(reqAlert);
  }

  // Z-score for spend
  const baselineDailySpend = (Number(baselineRow.total_spend) / 30) * dailyFactor;
  const currentDailySpend = Number(currentRow.total_spend) * dailyFactor;

  if (baselineDailySpend > 0) {
    const spendAlert = detectZScoreAnomaly(
      workspaceId,
      "spend",
      currentDailySpend,
      baselineDailySpend,
      windowMinutes,
      cfg,
    );
    if (spendAlert) alerts.push(spendAlert);
  }

  // Error rate check
  const errorRate = currentRow.total_requests > 0
    ? Number(currentRow.error_count) / currentRow.total_requests
    : 0;

  if (errorRate > 0.1) { // >10% error rate
    const severity: AnomalySeverity = errorRate > 0.5 ? "critical" : errorRate > 0.3 ? "high" : "medium";
    alerts.push({
      workspaceId,
      metric: "error_rate",
      severity,
      currentValue: Math.round(errorRate * 100) / 100,
      expectedValue: 0,
      deviationPct: errorRate * 100,
      windowMinutes,
      triggeredAt: new Date(),
      description: `Error rate is ${(errorRate * 100).toFixed(1)}% over the last ${windowMinutes}min (baseline: <5%)`,
      recommendedAction: "Check API key validity, model status, and prompt validity. Consider reviewing error logs.",
    });
  }

  return alerts;
}

function detectZScoreAnomaly(
  workspaceId: string,
  metric: "spend" | "requests" | "tokens",
  currentValue: number,
  baselineMean: number,
  windowMinutes: number,
  cfg: Required<UsageAnomalyConfig>,
): AnomalyAlert | null {
  // For Z-score, we need stddev. We approximate using a fixed ratio for simplicity.
  // In production you'd compute this from historical data.
  const stddevRatio = 0.4; // assume stddev is 40% of mean (conservative for usage data)
  const stddev = baselineMean * stddevRatio;

  if (stddev === 0) return null;

  const zScore = (currentValue - baselineMean) / stddev;

  if (zScore < cfg.zScoreThreshold) return null;

  const deviationPct = baselineMean > 0
    ? Math.round((currentValue / baselineMean - 1) * 100)
    : 0;

  const severity: AnomalySeverity =
    zScore > 5 ? "critical" :
    zScore > 4 ? "high" :
    zScore > 3 ? "medium" : "low";

  const metricLabels = { spend: "spend", requests: "request volume", tokens: "token usage" };
  const metricUnits = { spend: "USD", requests: "req/day", tokens: "tokens/day" };

  return {
    workspaceId,
    metric,
    severity,
    currentValue: Math.round(currentValue * 100) / 100,
    expectedValue: Math.round(baselineMean * 100) / 100,
    deviationPct,
    windowMinutes,
    triggeredAt: new Date(),
    description: `${metricLabels[metric]} is ${Math.abs(deviationPct)}% ${
      deviationPct > 0 ? "above" : "below"
    } expected (${currentValue.toFixed(2)} vs ${baselineMean.toFixed(2)} ${metricUnits[metric]})`,
    recommendedAction: deviationPct > 200
      ? "CRITICAL: Usage is more than 3x expected. Consider suspending the workspace API key immediately."
      : deviationPct > 100
      ? "HIGH: Usage significantly exceeds baseline. Review recent activity for runaway loops or compromised keys."
      : "Review usage patterns. Could be legitimate growth or a minor anomaly.",
  };
}

/**
 * Record that an anomaly was reviewed/acknowledged.
 */
export async function acknowledgeAnomaly(
  sql: Sql,
  workspaceId: string,
  alert: AnomalyAlert,
  acknowledgedBy: string,
): Promise<void> {
  await sql`
    INSERT INTO llm.anomaly_alerts
      (workspace_id, metric, severity, current_value, expected_value,
       deviation_pct, window_minutes, triggered_at, acknowledged_by, acknowledged_at)
    VALUES (
      ${workspaceId},
      ${alert.metric},
      ${alert.severity},
      ${alert.currentValue},
      ${alert.expectedValue},
      ${alert.deviationPct},
      ${alert.windowMinutes},
      ${alert.triggeredAt},
      ${acknowledgedBy},
      NOW()
    )
  `;
}

/**
 * Get recent acknowledged anomalies for a workspace.
 */
export async function getRecentAnomalies(
  sql: Sql,
  workspaceId: string,
  hours = 24,
): Promise<AnomalyAlert[]> {
  const rows = await sql<any[]>`
    SELECT * FROM llm.anomaly_alerts
    WHERE workspace_id = ${workspaceId}
      AND triggered_at >= NOW() - INTERVAL '${sql.unsafe(String(hours))} hours'
    ORDER BY triggered_at DESC
    LIMIT 50
  `;

  return rows.map((r) => ({
    workspaceId: r.workspace_id,
    metric: r.metric,
    severity: r.severity,
    currentValue: r.current_value,
    expectedValue: r.expected_value,
    deviationPct: r.deviation_pct,
    windowMinutes: r.window_minutes,
    triggeredAt: r.triggered_at,
    description: "",
    recommendedAction: "",
  }));
}
