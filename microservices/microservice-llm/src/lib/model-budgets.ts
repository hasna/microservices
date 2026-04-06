/**
 * Per-model budget limits — complement workspace-level total budgets
 * with per-model spending caps (e.g., $50/month on claude-3-5-sonnet).
 */

import type { Sql } from "postgres";

export interface ModelBudget {
  workspace_id: string;
  model: string;
  monthly_limit_usd: number;
  current_month_spend: number;
  alert_threshold_pct: number;
  alert_sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ModelBudgetStatus {
  allowed: boolean;
  budget: ModelBudget | null;
  alert: "threshold" | "exceeded" | null;
  totalAcrossModels: number;
}

/**
 * Set a monthly spending limit for a specific model in a workspace.
 */
export async function setModelBudget(
  sql: Sql,
  workspaceId: string,
  model: string,
  monthlyLimitUsd: number,
  alertThresholdPct = 80,
): Promise<ModelBudget> {
  const [row] = await sql<ModelBudget[]>`
    INSERT INTO llm.model_budgets (workspace_id, model, monthly_limit_usd, alert_threshold_pct)
    VALUES (${workspaceId}, ${model}, ${monthlyLimitUsd}, ${alertThresholdPct})
    ON CONFLICT (workspace_id, model) DO UPDATE
      SET monthly_limit_usd = EXCLUDED.monthly_limit_usd,
          alert_threshold_pct = EXCLUDED.alert_threshold_pct,
          updated_at = NOW()
    RETURNING *
  `;
  return row;
}

/**
 * Get the per-model budget for a workspace + model combination.
 */
export async function getModelBudget(
  sql: Sql,
  workspaceId: string,
  model: string,
): Promise<ModelBudget | null> {
  const [row] = await sql<ModelBudget[]>`
    SELECT * FROM llm.model_budgets
    WHERE workspace_id = ${workspaceId} AND model = ${model}
  `;
  return row ?? null;
}

/**
 * Check if a request would exceed the per-model budget.
 * Returns { allowed, budget, alert, totalAcrossModels }.
 */
export async function checkModelBudget(
  sql: Sql,
  workspaceId: string,
  model: string,
  costUsd: number,
): Promise<ModelBudgetStatus> {
  // Reset monthly spend if new month
  await resetIfNewMonth(sql, workspaceId, model);

  let budget = await getModelBudget(sql, workspaceId, model);
  if (!budget) {
    // No per-model budget — check total
    const [{ total }] = await sql<[{ total: number }]>`
      SELECT COALESCE(SUM(cost_usd), 0) as total FROM llm.model_spend
      WHERE workspace_id = ${workspaceId}
        AND DATE_TRUNC('month', recorded_at) = DATE_TRUNC('month', NOW())
    `;
    return { allowed: true, budget: null, alert: null, totalAcrossModels: Number(total) };
  }

  const newSpend = budget.current_month_spend + costUsd;

  if (newSpend > budget.monthly_limit_usd) {
    return {
      allowed: false,
      budget,
      alert: "exceeded",
      totalAcrossModels: newSpend,
    };
  }

  const pct = (newSpend / budget.monthly_limit_usd) * 100;
  if (pct >= budget.alert_threshold_pct && (!budget.alert_sent_at || isOlderThan(budget.alert_sent_at, 24 * 3600 * 1000))) {
    await sql`
      INSERT INTO llm.budget_alerts (workspace_id, alert_type, threshold_pct, spend_usd, limit_usd)
      VALUES (${workspaceId}, 'threshold', ${Math.round(pct)}, ${newSpend}, ${budget.monthly_limit_usd})
    `;
    await sql`
      UPDATE llm.model_budgets SET alert_sent_at = NOW()
      WHERE workspace_id = ${workspaceId} AND model = ${model}
    `;
    return { allowed: true, budget, alert: "threshold", totalAcrossModels: newSpend };
  }

  return { allowed: true, budget, alert: null, totalAcrossModels: newSpend };
}

/**
 * Record spend for a specific model.
 */
export async function recordModelSpend(
  sql: Sql,
  workspaceId: string,
  model: string,
  costUsd: number,
): Promise<void> {
  // Upsert the model_budgets current_month_spend
  await sql`
    INSERT INTO llm.model_spend (workspace_id, model, cost_usd)
    VALUES (${workspaceId}, ${model}, ${costUsd})
  `;

  await sql`
    UPDATE llm.model_budgets
    SET current_month_spend = current_month_spend + ${costUsd}, updated_at = NOW()
    WHERE workspace_id = ${workspaceId} AND model = ${model}
  `;
}

/**
 * List all per-model budgets for a workspace.
 */
export async function listModelBudgets(
  sql: Sql,
  workspaceId: string,
): Promise<ModelBudget[]> {
  return sql<ModelBudget[]>`
    SELECT * FROM llm.model_budgets
    WHERE workspace_id = ${workspaceId}
    ORDER BY model ASC
  `;
}

/**
 * Delete a per-model budget.
 */
export async function deleteModelBudget(
  sql: Sql,
  workspaceId: string,
  model: string,
): Promise<void> {
  await sql`
    DELETE FROM llm.model_budgets
    WHERE workspace_id = ${workspaceId} AND model = ${model}
  `;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resetIfNewMonth(sql: Sql, workspaceId: string, model: string): Promise<void> {
  const [row] = await sql<{ updated_at: Date }[]>`
    SELECT updated_at FROM llm.model_budgets
    WHERE workspace_id = ${workspaceId} AND model = ${model}
  `;
  if (!row) return;

  const now = new Date();
  if (row.updated_at.getMonth() !== now.getMonth() || row.updated_at.getFullYear() !== now.getFullYear()) {
    await sql`
      UPDATE llm.model_budgets
      SET current_month_spend = 0, alert_sent_at = NULL, updated_at = NOW()
      WHERE workspace_id = ${workspaceId} AND model = ${model}
    `;
  }
}

function isOlderThan(date: Date, ms: number): boolean {
  return Date.now() - date.getTime() > ms;
}
