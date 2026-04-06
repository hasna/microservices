/**
 * Budget scheduler for microservice-llm.
 *
 * - Scheduled budget monitoring jobs (periodic checks vs on-demand)
 * - Per-model spend alerts with configurable thresholds
 * - Workspace-level budget rollover handling
 * - Budget check history for auditing
 */

import type { Sql } from "postgres";
import {
  checkBudgetAndAlert,
  getWorkspaceBudget,
  recordSpend,
  getBudgetAlerts,
  type WorkspaceBudget,
} from "./costs.js";
import { notifyBudgetAlert } from "./webhook-notifier.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BudgetScheduleStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type BudgetScheduleAction =
  | "check_threshold"
  | "check_exceeded"
  | "reset_monthly"
  | "alert_webhook";

export interface BudgetSchedule {
  id: string;
  workspace_id: string;
  schedule_type: "periodic" | "on_demand";
  cron_expression: string | null;
  action: BudgetScheduleAction;
  config: BudgetScheduleConfig;
  status: BudgetScheduleStatus;
  last_run_at: Date | null;
  next_run_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface BudgetScheduleConfig {
  /** Alert at this percentage of budget (0-100) */
  alert_at_pct?: number;
  /** If true, send webhook on threshold */
  webhook_on_threshold?: boolean;
  /** If true, reset spend counters on new month */
  auto_rollover?: boolean;
  /** Provider or model to scope the check to (null = all) */
  model_filter?: string | null;
}

export interface BudgetCheckResult {
  schedule_id: string;
  workspace_id: string;
  status: "ok" | "threshold" | "exceeded";
  current_spend_usd: number;
  limit_usd: number;
  alert_sent: boolean;
  checked_at: Date;
}

// ---------------------------------------------------------------------------
// Schedule CRUD
// ---------------------------------------------------------------------------

/**
 * Create a new budget schedule for a workspace.
 */
export async function createBudgetSchedule(
  sql: Sql,
  workspaceId: string,
  opts: {
    scheduleType?: "periodic" | "on_demand";
    cronExpression?: string;
    action?: BudgetScheduleAction;
    config?: BudgetScheduleConfig;
  },
): Promise<BudgetSchedule> {
  const scheduleType = opts.scheduleType ?? "on_demand";
  const config: BudgetScheduleConfig = opts.config ?? {};

  const [row] = await sql<BudgetSchedule[]>`
    INSERT INTO llm.budget_schedules
      (workspace_id, schedule_type, cron_expression, action, config, status, next_run_at)
    VALUES (
      ${workspaceId},
      ${scheduleType}::TEXT,
      ${opts.cronExpression ?? null},
      ${opts.action ?? "check_threshold"}::TEXT,
      ${JSON.stringify(config)}::JSONB,
      'pending'::TEXT,
      ${scheduleType === "periodic" ? computeNextRun(opts.cronExpression ?? "0 0 * * *") : null}
    )
    RETURNING *
  `;

  return parseScheduleRow(row);
}

/**
 * List all budget schedules for a workspace.
 */
export async function listBudgetSchedules(
  sql: Sql,
  workspaceId: string,
): Promise<BudgetSchedule[]> {
  const rows = await sql`
    SELECT * FROM llm.budget_schedules
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
  `;
  return rows.map(parseScheduleRow);
}

/**
 * Get a budget schedule by ID.
 */
export async function getBudgetSchedule(
  sql: Sql,
  scheduleId: string,
): Promise<BudgetSchedule | null> {
  const [row] = await sql`SELECT * FROM llm.budget_schedules WHERE id = ${scheduleId}`;
  return row ? parseScheduleRow(row) : null;
}

/**
 * Cancel a pending or failed budget schedule.
 */
export async function cancelBudgetSchedule(
  sql: Sql,
  scheduleId: string,
): Promise<BudgetSchedule | null> {
  const [row] = await sql<BudgetSchedule[]>`
    UPDATE llm.budget_schedules
    SET status = 'cancelled', updated_at = NOW()
    WHERE id = ${scheduleId} AND status IN ('pending', 'failed')
    RETURNING *
  `;
  return row ? parseScheduleRow(row) : null;
}

/**
 * Delete a budget schedule.
 */
export async function deleteBudgetSchedule(
  sql: Sql,
  scheduleId: string,
): Promise<boolean> {
  const [result] = await sql`
    DELETE FROM llm.budget_schedules WHERE id = ${scheduleId}
    RETURNING id
  `;
  return !!result;
}

// ---------------------------------------------------------------------------
// Schedule execution
// ---------------------------------------------------------------------------

/**
 * Run a budget schedule immediately (on-demand trigger).
 */
export async function runBudgetSchedule(
  sql: Sql,
  scheduleId: string,
): Promise<BudgetCheckResult> {
  const schedule = await getBudgetSchedule(sql, scheduleId);
  if (!schedule) throw new Error(`Budget schedule ${scheduleId} not found`);
  if (schedule.status === "running") {
    throw new Error(`Budget schedule ${scheduleId} is already running`);
  }

  // Mark as running
  await sql`
    UPDATE llm.budget_schedules
    SET status = 'running', updated_at = NOW()
    WHERE id = ${scheduleId}
  `;

  try {
    const result = await executeBudgetCheck(sql, schedule);

    // Mark as completed
    const nextRun = schedule.schedule_type === "periodic" && schedule.cron_expression
      ? computeNextRun(schedule.cron_expression)
      : schedule.next_run_at;

    await sql`
      UPDATE llm.budget_schedules
      SET
        status = 'completed',
        last_run_at = NOW(),
        next_run_at = ${nextRun},
        updated_at = NOW()
      WHERE id = ${scheduleId}
    `;

    return result;
  } catch (err) {
    await sql`
      UPDATE llm.budget_schedules
      SET status = 'failed', updated_at = NOW()
      WHERE id = ${scheduleId}
    `;
    throw err;
  }
}

/**
 * Check all periodic schedules that are due.
 */
export async function processDueSchedules(sql: Sql): Promise<number> {
  const due = await sql<{ id: string }[]>`
    SELECT id FROM llm.budget_schedules
    WHERE schedule_type = 'periodic'
      AND status IN ('pending', 'completed', 'failed')
      AND (next_run_at IS NULL OR next_run_at <= NOW())
  `;

  let processed = 0;
  for (const row of due) {
    try {
      await runBudgetSchedule(sql, row.id);
      processed++;
    } catch {
      // Log but continue
    }
  }
  return processed;
}

async function executeBudgetCheck(
  sql: Sql,
  schedule: BudgetSchedule,
): Promise<BudgetCheckResult> {
  const budget = await getWorkspaceBudget(sql, schedule.workspace_id);
  if (!budget) {
    return {
      schedule_id: schedule.id,
      workspace_id: schedule.workspace_id,
      status: "ok",
      current_spend_usd: 0,
      limit_usd: 0,
      alert_sent: false,
      checked_at: new Date(),
    };
  }

  // Check for rollover (new month)
  const config = schedule.config;
  if (config.auto_rollover) {
    const now = new Date();
    if (
      budget.updated_at.getMonth() !== now.getMonth() ||
      budget.updated_at.getFullYear() !== now.getFullYear()
    ) {
      // Reset spend for new month
      await sql`
        UPDATE llm.workspace_budgets
        SET current_month_spend = 0, alert_sent_at = NULL, updated_at = NOW()
        WHERE workspace_id = ${schedule.workspace_id}
      `;
    }
  }

  const pct = (budget.current_month_spend / budget.monthly_limit_usd) * 100;
  let status: BudgetCheckResult["status"] = "ok";
  let alertSent = false;

  if (pct >= 100) {
    status = "exceeded";
  } else if (pct >= (config.alert_at_pct ?? budget.alert_threshold_pct)) {
    status = "threshold";
  }

  // Send webhook if configured
  if (status !== "ok" && config.webhook_on_threshold) {
    try {
      await notifyBudgetAlert(sql, {
        workspaceId: schedule.workspace_id,
        alertType: status === "exceeded" ? "exceeded" : "threshold",
        thresholdPct: Math.round(pct),
        spendUsd: budget.current_month_spend,
        limitUsd: budget.monthly_limit_usd,
      });
      alertSent = true;
    } catch {
      // Webhook failure shouldn't fail the check
    }
  }

  // Record the check result
  await sql`
    INSERT INTO llm.budget_check_history
      (schedule_id, workspace_id, status, current_spend_usd, limit_usd, alert_sent)
    VALUES (
      ${schedule.id},
      ${schedule.workspace_id},
      ${status}::TEXT,
      ${budget.current_month_spend},
      ${budget.monthly_limit_usd},
      ${alertSent}
    )
  `;

  return {
    schedule_id: schedule.id,
    workspace_id: schedule.workspace_id,
    status,
    current_spend_usd: budget.current_month_spend,
    limit_usd: budget.monthly_limit_usd,
    alert_sent: alertSent,
    checked_at: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Budget check history
// ---------------------------------------------------------------------------

/**
 * Get budget check history for a workspace.
 */
export async function getBudgetCheckHistory(
  sql: Sql,
  workspaceId: string,
  limit = 50,
): Promise<BudgetCheckResult[]> {
  const rows = await sql`
    SELECT * FROM llm.budget_check_history
    WHERE workspace_id = ${workspaceId}
    ORDER BY checked_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    schedule_id: r.schedule_id,
    workspace_id: r.workspace_id,
    status: r.status,
    current_spend_usd: Number(r.current_spend_usd),
    limit_usd: Number(r.limit_usd),
    alert_sent: r.alert_sent,
    checked_at: r.checked_at,
  }));
}

// ---------------------------------------------------------------------------
// Cron helper (simple next-run calculator)
// ---------------------------------------------------------------------------

function computeNextRun(cronExpression: string): Date {
  // Minimal cron parser: "min hour day month dow"
  // Supports: * and specific values
  // Returns next occurrence from now
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length < 5) return new Date(Date.now() + 60_000);

  const [minPart, hourPart] = parts;
  const now = new Date();
  const next = new Date(now);

  const min = minPart === "*" ? now.getMinutes() : parseInt(minPart, 10);
  const hour = hourPart === "*" ? now.getHours() : parseInt(hourPart, 10);

  next.setMinutes(min || 0, 0, 0);
  if (hourPart !== "*" && hour < now.getHours()) {
    next.setDate(next.getDate() + 1);
  }
  if (hourPart !== "*") next.setHours(hour, 0, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseScheduleRow(row: Record<string, unknown>): BudgetSchedule {
  return {
    id: row.id as string,
    workspace_id: row.workspace_id as string,
    schedule_type: row.schedule_type as "periodic" | "on_demand",
    cron_expression: row.cron_expression as string | null,
    action: row.action as BudgetScheduleAction,
    config: (row.config as BudgetScheduleConfig) ?? {},
    status: row.status as BudgetScheduleStatus,
    last_run_at: row.last_run_at ? new Date(row.last_run_at as string) : null,
    next_run_at: row.next_run_at ? new Date(row.next_run_at as string) : null,
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
  };
}
