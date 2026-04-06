/**
 * Usage forecasting — predict end-of-month spend based on current usage patterns.
 *
 * Uses a simple linear regression on daily spend over the last 14 days
 * to estimate total monthly spend and days until budget exhaustion.
 */

import type { Sql } from "postgres";

export interface UsageForecast {
  workspaceId: string;
  currentSpend: number;
  projectedSpend: number;
  budgetLimit: number;
  budgetRemaining: number;
  daysUntilExhaustion: number | null; // null if under budget
  dailyAverageSpend: number;
  trend: "stable" | "increasing" | "decreasing";
  confidence: number; // 0–1 based on data quality
  periodStart: Date;
  periodEnd: Date;
  projectedOverrunPct: number; // how much over budget (0 = on track)
}

/**
 * Forecast end-of-month spend for a workspace.
 */
export async function forecastUsage(
  sql: Sql,
  workspaceId: string,
): Promise<UsageForecast | null> {
  // Get current budget
  const [budget] = await sql<[{
    monthly_limit_usd: number;
    current_spend: number;
    period_start: Date;
    period_end: Date;
  }?]>`
    SELECT monthly_limit_usd, current_spend, period_start, period_end
    FROM llm.workspace_budgets
    WHERE workspace_id = ${workspaceId}
  `;

  if (!budget) return null;

  const now = new Date();
  const periodStart = new Date(budget.period_start);
  const periodEnd = new Date(budget.period_end);
  const daysElapsed = Math.max(1, (now.getTime() - periodStart.getTime()) / 86_400_000);
  const daysInPeriod = Math.max(1, (periodEnd.getTime() - periodStart.getTime()) / 86_400_000);
  const daysRemaining = Math.max(0, daysInPeriod - daysElapsed);

  // Get daily spend for last 14 days
  const dailySpend = await sql<[{ day: Date; spend: number }]>`
    SELECT
      DATE(created_at) as day,
      COALESCE(SUM(cost_usd), 0) as spend
    FROM llm.model_spend
    WHERE workspace_id = ${workspaceId}
      AND created_at >= NOW() - INTERVAL '14 days'
    GROUP BY DATE(created_at)
    ORDER BY day
  `;

  if (dailySpend.length < 2) {
    // Not enough data — use current spend rate
    const dailyAverage = budget.current_spend / daysElapsed;
    const projectedSpend = dailyAverage * daysInPeriod;
    const budgetRemaining = Math.max(0, budget.monthly_limit_usd - budget.current_spend);
    const daysUntil = dailyAverage > 0 ? budgetRemaining / dailyAverage : null;

    return {
      workspaceId,
      currentSpend: budget.current_spend,
      projectedSpend,
      budgetLimit: budget.monthly_limit_usd,
      budgetRemaining,
      daysUntilExhaustion: daysUntil,
      dailyAverageSpend: dailyAverage,
      trend: "stable",
      confidence: 0.3,
      periodStart,
      periodEnd,
      projectedOverrunPct: budget.monthly_limit_usd > 0
        ? (projectedSpend - budget.monthly_limit_usd) / budget.monthly_limit_usd
        : 0,
    };
  }

  // Linear regression on daily spend
  const n = dailySpend.length;
  const xVals = dailySpend.map((d, i) => i + 1);
  const yVals = dailySpend.map((d) => d.spend);

  const sumX = xVals.reduce((a, b) => a + b, 0);
  const sumY = yVals.reduce((a, b) => a + b, 0);
  const sumXY = xVals.reduce((s, x, i) => s + x * yVals[i], 0);
  const sumX2 = xVals.reduce((s, x) => s + x * x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Positive slope = increasing spend
  const trend: "stable" | "increasing" | "decreasing" =
    slope > 0.05 * intercept ? "increasing" : slope < -0.05 * intercept ? "decreasing" : "stable";

  // Project forward
  const dailyAverage = yVals[yVals.length - 1]; // most recent day
  const projectedSpend = dailyAverage * (daysInPeriod / daysElapsed);

  const budgetRemaining = Math.max(0, budget.monthly_limit_usd - budget.current_spend);
  const daysUntilExhaustion = dailyAverage > 0 ? budgetRemaining / dailyAverage : null;

  // Confidence based on R² and data quality
  const yMean = sumY / n;
  const ssTotal = yVals.reduce((s, y) => s + (y - yMean) ** 2, 0);
  const ssRes = xVals.reduce((s, x, i) => s + (yVals[i] - (slope * x + intercept)) ** 2, 0);
  const rSquared = ssTotal > 0 ? 1 - ssRes / ssTotal : 0;
  const confidence = Math.min(0.95, Math.max(0.1, rSquared * (n / 14)));

  return {
    workspaceId,
    currentSpend: budget.current_spend,
    projectedSpend,
    budgetLimit: budget.monthly_limit_usd,
    budgetRemaining,
    daysUntilExhaustion,
    dailyAverageSpend: dailyAverage,
    trend,
    confidence,
    periodStart,
    periodEnd,
    projectedOverrunPct: budget.monthly_limit_usd > 0
      ? (projectedSpend - budget.monthly_limit_usd) / budget.monthly_limit_usd
      : 0,
  };
}

/**
 * Get forecast for all workspaces with budgets.
 */
export async function forecastAllWorkspaces(
  sql: Sql,
): Promise<UsageForecast[]> {
  const workspaces = await sql<[{ workspace_id: string }]>`
    SELECT DISTINCT workspace_id FROM llm.workspace_budgets
  `;
  const results: UsageForecast[] = [];
  for (const { workspace_id } of workspaces) {
    const forecast = await forecastUsage(sql, workspace_id);
    if (forecast) results.push(forecast);
  }
  return results;
}
