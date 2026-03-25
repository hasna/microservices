/**
 * Payroll calculation and processing business logic
 */

import { getDatabase } from "./database.js";
import { Employee, listEmployees } from "./employees.js";
import { PayStub, createPayStub, listPayStubs } from "./paystubs.js";
import { updatePayPeriodStatus, getPayPeriod } from "./paystubs.js";
import { getBenefitDeductions } from "./benefits.js";

// --- Standard deduction rates ---

/**
 * Standard deduction rates for payroll processing
 */
const DEFAULT_DEDUCTIONS = {
  federal_tax: 0.22,   // 22% federal income tax bracket
  state_tax: 0.05,     // 5% state tax
  social_security: 0.062, // 6.2% social security
  medicare: 0.0145,    // 1.45% medicare
};

/**
 * Calculate deductions for a given gross pay amount.
 * Contractors only pay federal and state tax (no FICA).
 */
export function calculateDeductions(
  grossPay: number,
  employeeType: "employee" | "contractor",
  customRates?: Record<string, number>
): Record<string, number> {
  const rates = customRates || DEFAULT_DEDUCTIONS;
  const deductions: Record<string, number> = {};

  if (employeeType === "contractor") {
    // Contractors: only federal + state tax
    deductions.federal_tax = Math.round(grossPay * (rates.federal_tax || 0.22) * 100) / 100;
    deductions.state_tax = Math.round(grossPay * (rates.state_tax || 0.05) * 100) / 100;
  } else {
    // Employees: full deductions
    for (const [key, rate] of Object.entries(rates)) {
      deductions[key] = Math.round(grossPay * rate * 100) / 100;
    }
  }

  return deductions;
}

/**
 * Calculate gross pay for an employee over a pay period.
 * For salary employees: pay_rate / 24 (semi-monthly).
 * For hourly employees: pay_rate * hours + overtime.
 */
export function calculateGrossPay(
  employee: Employee,
  hoursWorked?: number,
  overtimeHours?: number
): number {
  if (employee.pay_type === "salary") {
    // Semi-monthly: annual salary / 24
    return Math.round((employee.pay_rate / 24) * 100) / 100;
  }

  // Hourly
  const regularHours = hoursWorked || 0;
  const overtime = overtimeHours || 0;
  const regularPay = regularHours * employee.pay_rate;
  const overtimePay = overtime * employee.pay_rate * 1.5;
  return Math.round((regularPay + overtimePay) * 100) / 100;
}

/**
 * Process payroll for a given pay period.
 * Auto-generates pay stubs for all active employees.
 * Returns the generated pay stubs.
 */
export function processPayroll(
  periodId: string,
  hoursMap?: Record<string, { hours: number; overtime?: number }>
): PayStub[] {
  const db = getDatabase();
  const period = getPayPeriod(periodId);
  if (!period) throw new Error(`Pay period '${periodId}' not found`);
  if (period.status === "completed") throw new Error("Pay period already completed");

  // Mark as processing
  updatePayPeriodStatus(periodId, "processing");

  const activeEmployees = listEmployees({ status: "active" });
  const stubs: PayStub[] = [];

  for (const emp of activeEmployees) {
    // Check if stub already exists for this employee+period
    const existing = db.prepare(
      "SELECT id FROM pay_stubs WHERE employee_id = ? AND pay_period_id = ?"
    ).get(emp.id, periodId) as { id: string } | null;
    if (existing) continue;

    const empHours = hoursMap?.[emp.id];
    const hoursWorked = empHours?.hours;
    const overtimeHours = empHours?.overtime || 0;

    const grossPay = calculateGrossPay(emp, hoursWorked, overtimeHours);
    const deductions = calculateDeductions(grossPay, emp.type);

    // Auto-apply benefit deductions for this employee
    const benefitDeds = getBenefitDeductions(emp.id);
    for (const [key, amount] of Object.entries(benefitDeds)) {
      deductions[key] = (deductions[key] || 0) + amount;
    }

    const totalDeductions = Object.values(deductions).reduce((sum, d) => sum + d, 0);
    const netPay = Math.round((grossPay - totalDeductions) * 100) / 100;

    const stub = createPayStub({
      employee_id: emp.id,
      pay_period_id: periodId,
      gross_pay: grossPay,
      deductions,
      net_pay: netPay,
      hours_worked: hoursWorked,
      overtime_hours: overtimeHours,
    });

    stubs.push(stub);
  }

  // Mark as completed
  updatePayPeriodStatus(periodId, "completed");

  return stubs;
}
