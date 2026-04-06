/**
 * Cost calculation per provider/model.
 * Prices are per 1K tokens (approximate).
 */

export const COST_PER_1K_TOKENS: Record<
  string,
  { input: number; output: number }
> = {
  "gpt-4o": { input: 0.005, output: 0.015 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-3.5-turbo": { input: 0.0005, output: 0.0015 },
  "claude-3-5-sonnet-20241022": { input: 0.003, output: 0.015 },
  "claude-3-5-sonnet": { input: 0.003, output: 0.015 },
  "claude-3-haiku-20240307": { input: 0.00025, output: 0.00125 },
  "claude-3-haiku": { input: 0.00025, output: 0.00125 },
  "llama-3.1-70b-versatile": { input: 0.00059, output: 0.00079 },
  "mixtral-8x7b-32768": { input: 0.00027, output: 0.00027 },
  "gemma-7b-it": { input: 0.0001, output: 0.0001 },
  default: { input: 0.001, output: 0.002 },
};

/**
 * Calculate cost in USD for a given model and token counts.
 */
export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  if (promptTokens === 0 && completionTokens === 0) return 0;

  // Try exact match first, then prefix match, then default
  const rates =
    COST_PER_1K_TOKENS[model] ??
    Object.entries(COST_PER_1K_TOKENS).find(
      ([key]) => key !== "default" && model.startsWith(key),
    )?.[1] ??
    COST_PER_1K_TOKENS.default!;

  const inputCost = (promptTokens / 1000) * rates.input;
  const outputCost = (completionTokens / 1000) * rates.output;

  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

// --- Budget management ---

import type { Sql } from "postgres";

export interface WorkspaceBudget {
  workspace_id: string;
  monthly_limit_usd: number;
  current_month_spend: number;
  alert_threshold_pct: number;
  alert_sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function getWorkspaceBudget(
  sql: Sql,
  workspaceId: string,
): Promise<WorkspaceBudget | null> {
  const [row] = await sql<WorkspaceBudget[]>`
    SELECT * FROM llm.workspace_budgets WHERE workspace_id = ${workspaceId}
  `;
  return row ?? null;
}

export async function setWorkspaceBudget(
  sql: Sql,
  workspaceId: string,
  monthlyLimitUsd: number,
  alertThresholdPct = 80,
): Promise<WorkspaceBudget> {
  const [row] = await sql<WorkspaceBudget[]>`
    INSERT INTO llm.workspace_budgets (workspace_id, monthly_limit_usd, alert_threshold_pct)
    VALUES (${workspaceId}, ${monthlyLimitUsd}, ${alertThresholdPct})
    ON CONFLICT (workspace_id) DO UPDATE
      SET monthly_limit_usd = EXCLUDED.monthly_limit_usd,
          alert_threshold_pct = EXCLUDED.alert_threshold_pct,
          updated_at = NOW()
    RETURNING *
  `;
  return row;
}

export async function checkBudgetAndAlert(
  sql: Sql,
  workspaceId: string,
  costUsd: number,
): Promise<{ allowed: boolean; alert: "threshold" | "exceeded" | null; budget: WorkspaceBudget | null }> {
  // Get or initialize budget
  let budget = await getWorkspaceBudget(sql, workspaceId);
  if (!budget) {
    // No budget set — allow by default
    return { allowed: true, alert: null, budget: null };
  }

  // Reset if new month (simple check: compare month of updated_at with current month)
  const now = new Date();
  const updatedMonth = budget.updated_at.getMonth();
  if (updatedMonth !== now.getMonth() || budget.updated_at.getFullYear() !== now.getFullYear()) {
    // New month — reset spend
    await sql`
      UPDATE llm.workspace_budgets
      SET current_month_spend = 0, updated_at = NOW()
      WHERE workspace_id = ${workspaceId}
    `;
    budget.current_month_spend = 0;
  }

  const newSpend = budget.current_month_spend + costUsd;

  // Check if exceeded
  if (newSpend > budget.monthly_limit_usd) {
    return { allowed: false, alert: "exceeded", budget };
  }

  // Check threshold
  const pct = (newSpend / budget.monthly_limit_usd) * 100;
  if (pct >= budget.alert_threshold_pct && (!budget.alert_sent_at || isOlderThan(budget.alert_sent_at, 24 * 60 * 60 * 1000))) {
    // Record alert
    await sql`
      INSERT INTO llm.budget_alerts (workspace_id, alert_type, threshold_pct, spend_usd, limit_usd)
      VALUES (${workspaceId}, 'threshold', ${Math.round(pct)}, ${newSpend}, ${budget.monthly_limit_usd})
    `;
    await sql`
      UPDATE llm.workspace_budgets SET alert_sent_at = NOW() WHERE workspace_id = ${workspaceId}
    `;
    return { allowed: true, alert: "threshold", budget };
  }

  return { allowed: true, alert: null, budget };
}

export async function recordSpend(
  sql: Sql,
  workspaceId: string,
  costUsd: number,
): Promise<void> {
  await sql`
    UPDATE llm.workspace_budgets
    SET current_month_spend = current_month_spend + ${costUsd}, updated_at = NOW()
    WHERE workspace_id = ${workspaceId}
  `;
}

export async function getBudgetAlerts(
  sql: Sql,
  workspaceId: string,
  limit = 20,
): Promise<any[]> {
  return sql`
    SELECT * FROM llm.budget_alerts
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

function isOlderThan(date: Date, ms: number): boolean {
  return Date.now() - date.getTime() > ms;
}

// --- Budget Alerts (enhanced) ---

export interface BudgetAlert {
  id: string;
  workspace_id: string;
  alert_type: "threshold" | "exceeded";
  threshold_pct: number;
  threshold_cents: number | null;
  spend_usd: number;
  current_spend_cents: number | null;
  limit_usd: number;
  notified_at: Date | null;
  created_at: Date;
}

export interface SetBudgetAlertOptions {
  workspaceId: string;
  alertType: "threshold" | "exceeded";
  thresholdCents: number;
  currentSpendCents: number;
}

/**
 * Explicitly create a budget alert record.
 * Called when a request would exceed a configured alert threshold.
 */
export async function setBudgetAlert(
  sql: Sql,
  opts: SetBudgetAlertOptions,
): Promise<BudgetAlert> {
  const thresholdPct = Math.round(
    (opts.currentSpendCents / opts.thresholdCents) * 100,
  );
  const [row] = await sql<BudgetAlert[]>`
    INSERT INTO llm.budget_alerts (
      workspace_id,
      alert_type,
      threshold_pct,
      threshold_cents,
      spend_usd,
      current_spend_cents,
      notified_at
    )
    VALUES (
      ${opts.workspaceId},
      ${opts.alertType},
      ${thresholdPct},
      ${opts.thresholdCents},
      ${opts.currentSpendCents / 100},
      ${opts.currentSpendCents},
      NOW()
    )
    RETURNING *
  `;
  return row;
}

/**
 * Get budget alerts for a workspace, typed.
 */
export async function getBudgetAlertsTyped(
  sql: Sql,
  workspaceId: string,
  limit = 20,
): Promise<BudgetAlert[]> {
  return sql<BudgetAlert[]>`
    SELECT * FROM llm.budget_alerts
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

/**
 * Set fallback strategy for a workspace (stored as JSONB in workspace_budgets).
 * chain is an array of provider chains, e.g. [["openai","anthropic"],["groq"]]
 */
export async function setFallbackStrategy(
  sql: Sql,
  workspaceId: string,
  chain: string[][],
): Promise<void> {
  await sql`
    UPDATE llm.workspace_budgets
    SET fallback_strategy = ${JSON.stringify(chain)}::JSONB, updated_at = NOW()
    WHERE workspace_id = ${workspaceId}
  `;
}

/**
 * Get fallback strategy for a workspace.
 */
export async function getFallbackStrategy(
  sql: Sql,
  workspaceId: string,
): Promise<string[][] | null> {
  const [row] = await sql<[{ fallback_strategy: unknown } | undefined]>`
    SELECT fallback_strategy FROM llm.workspace_budgets
    WHERE workspace_id = ${workspaceId}
  `;
  if (!row?.fallback_strategy) return null;
  return row.fallback_strategy as string[][];
}
