/**
 * Financial consolidation — periods, P&L, cashflow, budgets
 */

import { getDatabase } from "../db/database.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FinancialPeriod {
  id: string;
  org_id: string | null;
  name: string;
  type: "month" | "quarter" | "year";
  start_date: string;
  end_date: string;
  status: "open" | "closing" | "closed";
  revenue: number;
  expenses: number;
  net_income: number;
  breakdown: Record<string, unknown>;
  created_at: string;
  closed_at: string | null;
}

interface PeriodRow {
  id: string;
  org_id: string | null;
  name: string;
  type: string;
  start_date: string;
  end_date: string;
  status: string;
  revenue: number;
  expenses: number;
  net_income: number;
  breakdown: string;
  created_at: string;
  closed_at: string | null;
}

export interface Budget {
  id: string;
  org_id: string | null;
  department: string;
  monthly_amount: number;
  currency: string;
  created_at: string;
}

export interface PnlReport {
  revenue: number;
  expenses: number;
  net_income: number;
  breakdown_by_service: Record<string, { revenue: number; expenses: number }>;
}

export interface CashflowReport {
  cash_in: number;
  cash_out: number;
  net_cashflow: number;
}

export interface BudgetVsActual {
  department: string;
  budget: number;
  actual: number;
  variance: number;
  variance_pct: number;
}

// ─── Row converters ──────────────────────────────────────────────────────────

function rowToPeriod(row: PeriodRow): FinancialPeriod {
  return {
    ...row,
    type: row.type as FinancialPeriod["type"],
    status: row.status as FinancialPeriod["status"],
    breakdown: JSON.parse(row.breakdown || "{}"),
  };
}

// ─── Financial Periods ───────────────────────────────────────────────────────

export function createPeriod(
  orgId: string,
  name: string,
  type: "month" | "quarter" | "year",
  startDate: string,
  endDate: string
): FinancialPeriod {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO financial_periods (id, org_id, name, type, start_date, end_date)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, orgId, name, type, startDate, endDate);

  return getPeriod(id)!;
}

export function getPeriod(id: string): FinancialPeriod | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM financial_periods WHERE id = ?").get(id) as PeriodRow | null;
  return row ? rowToPeriod(row) : null;
}

export function listPeriods(orgId: string, type?: string): FinancialPeriod[] {
  const db = getDatabase();
  const conditions: string[] = ["org_id = ?"];
  const params: unknown[] = [orgId];

  if (type) {
    conditions.push("type = ?");
    params.push(type);
  }

  const sql = `SELECT * FROM financial_periods WHERE ${conditions.join(" AND ")} ORDER BY start_date DESC`;
  const rows = db.prepare(sql).all(...params) as PeriodRow[];
  return rows.map(rowToPeriod);
}

export function closePeriod(
  periodId: string,
  revenue: number,
  expenses: number
): FinancialPeriod | null {
  const db = getDatabase();
  const existing = getPeriod(periodId);
  if (!existing) return null;

  const netIncome = revenue - expenses;
  const breakdown = {
    revenue_snapshot: revenue,
    expenses_snapshot: expenses,
    closed_by: "system",
  };

  db.prepare(
    `UPDATE financial_periods
     SET status = 'closed',
         revenue = ?,
         expenses = ?,
         net_income = ?,
         breakdown = ?,
         closed_at = datetime('now')
     WHERE id = ?`
  ).run(revenue, expenses, netIncome, JSON.stringify(breakdown), periodId);

  return getPeriod(periodId);
}

// ─── P&L Report ──────────────────────────────────────────────────────────────

export function generatePnl(orgId: string, startDate: string, endDate: string): PnlReport {
  const db = getDatabase();

  // Aggregate from closed financial periods that overlap the date range
  const rows = db.prepare(
    `SELECT name, revenue, expenses, breakdown
     FROM financial_periods
     WHERE org_id = ?
       AND start_date >= ?
       AND end_date <= ?
       AND status = 'closed'
     ORDER BY start_date`
  ).all(orgId, startDate, endDate) as PeriodRow[];

  let totalRevenue = 0;
  let totalExpenses = 0;
  const breakdownByService: Record<string, { revenue: number; expenses: number }> = {};

  for (const row of rows) {
    totalRevenue += row.revenue;
    totalExpenses += row.expenses;

    // Use the period name as the "service" key for breakdown
    breakdownByService[row.name] = {
      revenue: row.revenue,
      expenses: row.expenses,
    };
  }

  return {
    revenue: totalRevenue,
    expenses: totalExpenses,
    net_income: totalRevenue - totalExpenses,
    breakdown_by_service: breakdownByService,
  };
}

// ─── Cashflow Report ─────────────────────────────────────────────────────────

export function generateCashflow(orgId: string, startDate: string, endDate: string): CashflowReport {
  const db = getDatabase();

  // Aggregate from financial periods (all statuses) that overlap the date range
  const row = db.prepare(
    `SELECT COALESCE(SUM(revenue), 0) as cash_in,
            COALESCE(SUM(expenses), 0) as cash_out
     FROM financial_periods
     WHERE org_id = ?
       AND start_date >= ?
       AND end_date <= ?`
  ).get(orgId, startDate, endDate) as { cash_in: number; cash_out: number } | null;

  const cashIn = row?.cash_in ?? 0;
  const cashOut = row?.cash_out ?? 0;

  return {
    cash_in: cashIn,
    cash_out: cashOut,
    net_cashflow: cashIn - cashOut,
  };
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

export function setBudget(orgId: string, department: string, monthlyAmount: number): Budget {
  const db = getDatabase();

  // Upsert: if budget exists for this org+department, update it; otherwise create
  const existing = db.prepare(
    "SELECT id FROM budgets WHERE org_id = ? AND department = ?"
  ).get(orgId, department) as { id: string } | null;

  if (existing) {
    db.prepare("UPDATE budgets SET monthly_amount = ? WHERE id = ?").run(monthlyAmount, existing.id);
    return getBudget(existing.id)!;
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO budgets (id, org_id, department, monthly_amount)
     VALUES (?, ?, ?, ?)`
  ).run(id, orgId, department, monthlyAmount);

  return getBudget(id)!;
}

export function getBudget(id: string): Budget | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM budgets WHERE id = ?").get(id) as Budget | null;
  return row ?? null;
}

export function listBudgets(orgId: string): Budget[] {
  const db = getDatabase();
  return db.prepare(
    "SELECT * FROM budgets WHERE org_id = ? ORDER BY department"
  ).all(orgId) as Budget[];
}

export function getBudgetVsActual(
  orgId: string,
  department: string,
  month: string
): BudgetVsActual | null {
  const db = getDatabase();

  // Get budget for this department
  const budget = db.prepare(
    "SELECT monthly_amount FROM budgets WHERE org_id = ? AND department = ?"
  ).get(orgId, department) as { monthly_amount: number } | null;

  if (!budget) return null;

  // Calculate month boundaries (month is "YYYY-MM")
  const startDate = `${month}-01`;
  const [yearStr, monthStr] = month.split("-");
  const year = parseInt(yearStr, 10);
  const mon = parseInt(monthStr, 10);
  const lastDay = new Date(year, mon, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;

  // Sum expenses from financial periods that match this department name and date range
  const row = db.prepare(
    `SELECT COALESCE(SUM(expenses), 0) as actual
     FROM financial_periods
     WHERE org_id = ?
       AND start_date >= ?
       AND end_date <= ?
       AND name LIKE ?`
  ).get(orgId, startDate, endDate, `%${department}%`) as { actual: number } | null;

  const actual = row?.actual ?? 0;
  const variance = budget.monthly_amount - actual;
  const variancePct = budget.monthly_amount > 0
    ? ((variance / budget.monthly_amount) * 100)
    : 0;

  return {
    department,
    budget: budget.monthly_amount,
    actual,
    variance,
    variance_pct: Math.round(variancePct * 100) / 100,
  };
}
