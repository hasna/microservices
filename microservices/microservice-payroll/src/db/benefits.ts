/**
 * Benefits CRUD operations
 */

import { getDatabase } from "./database.js";

// --- Types ---

export interface Benefit {
  id: string;
  employee_id: string;
  type: "health" | "dental" | "vision" | "retirement" | "hsa" | "other";
  description: string | null;
  amount: number;
  frequency: "per_period" | "monthly" | "annual";
  active: boolean;
  created_at: string;
}

interface BenefitRow {
  id: string;
  employee_id: string;
  type: string;
  description: string | null;
  amount: number;
  frequency: string;
  active: number;
  created_at: string;
}

function rowToBenefit(row: BenefitRow): Benefit {
  return {
    ...row,
    type: row.type as Benefit["type"],
    frequency: row.frequency as Benefit["frequency"],
    active: row.active === 1,
  };
}

export interface CreateBenefitInput {
  employee_id: string;
  type: "health" | "dental" | "vision" | "retirement" | "hsa" | "other";
  description?: string;
  amount: number;
  frequency?: "per_period" | "monthly" | "annual";
}

export function createBenefit(input: CreateBenefitInput): Benefit {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO benefits (id, employee_id, type, description, amount, frequency)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.employee_id,
    input.type,
    input.description || null,
    input.amount,
    input.frequency || "per_period"
  );

  return getBenefit(id)!;
}

export function getBenefit(id: string): Benefit | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM benefits WHERE id = ?").get(id) as BenefitRow | null;
  return row ? rowToBenefit(row) : null;
}

export function listBenefits(employeeId?: string): Benefit[] {
  const db = getDatabase();
  if (employeeId) {
    const rows = db.prepare("SELECT * FROM benefits WHERE employee_id = ? ORDER BY created_at DESC").all(employeeId) as BenefitRow[];
    return rows.map(rowToBenefit);
  }
  const rows = db.prepare("SELECT * FROM benefits ORDER BY created_at DESC").all() as BenefitRow[];
  return rows.map(rowToBenefit);
}

export function removeBenefit(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("UPDATE benefits SET active = 0 WHERE id = ?").run(id);
  return result.changes > 0;
}

/**
 * Get benefit deductions for an employee, normalized to the given period type.
 * Converts monthly/annual amounts into per-period equivalents based on periodsPerYear.
 */
export function getBenefitDeductions(
  employeeId: string,
  periodType: "weekly" | "biweekly" | "semimonthly" | "monthly" = "semimonthly"
): Record<string, number> {
  const db = getDatabase();
  const rows = db.prepare(
    "SELECT * FROM benefits WHERE employee_id = ? AND active = 1"
  ).all(employeeId) as BenefitRow[];

  const periodsPerYear: Record<string, number> = {
    weekly: 52,
    biweekly: 26,
    semimonthly: 24,
    monthly: 12,
  };
  const periods = periodsPerYear[periodType] || 24;

  const deductions: Record<string, number> = {};
  for (const row of rows) {
    let perPeriodAmount: number;
    if (row.frequency === "per_period") {
      perPeriodAmount = row.amount;
    } else if (row.frequency === "monthly") {
      perPeriodAmount = (row.amount * 12) / periods;
    } else {
      // annual
      perPeriodAmount = row.amount / periods;
    }
    const key = `benefit_${row.type}`;
    deductions[key] = Math.round(((deductions[key] || 0) + perPeriodAmount) * 100) / 100;
  }
  return deductions;
}
