/**
 * Payroll reports, tax forms, ACH generation, auditing, and forecasting
 */

import { getDatabase } from "./database.js";
import { Employee, getEmployee, listEmployees } from "./employees.js";
import { PayPeriod, PayStub, PayStubRow, rowToPayStub, getPayPeriod, listPayStubs, listPayPeriods } from "./paystubs.js";
import { calculateGrossPay, calculateDeductions } from "./calculations.js";
import { getBenefitDeductions } from "./benefits.js";

// --- Payroll Report ---

export interface PayrollReport {
  period: PayPeriod;
  stubs: PayStub[];
  total_gross: number;
  total_deductions: number;
  total_net: number;
  employee_count: number;
}

export function getPayrollReport(periodId: string): PayrollReport | null {
  const period = getPayPeriod(periodId);
  if (!period) return null;

  const stubs = listPayStubs({ pay_period_id: periodId });

  const totalGross = stubs.reduce((sum, s) => sum + s.gross_pay, 0);
  const totalDeductions = stubs.reduce((sum, s) => {
    const d = Object.values(s.deductions).reduce((a, b) => a + b, 0);
    return sum + d;
  }, 0);
  const totalNet = stubs.reduce((sum, s) => sum + s.net_pay, 0);

  return {
    period,
    stubs,
    total_gross: Math.round(totalGross * 100) / 100,
    total_deductions: Math.round(totalDeductions * 100) / 100,
    total_net: Math.round(totalNet * 100) / 100,
    employee_count: stubs.length,
  };
}

// --- YTD Report ---

export interface YtdReport {
  employee: Employee;
  year: number;
  total_gross: number;
  total_deductions: Record<string, number>;
  total_net: number;
  pay_stubs_count: number;
}

export function getYtdReport(employeeId: string, year?: number): YtdReport | null {
  const employee = getEmployee(employeeId);
  if (!employee) return null;

  const targetYear = year || new Date().getFullYear();
  const db = getDatabase();

  const rows = db.prepare(
    `SELECT ps.* FROM pay_stubs ps
     JOIN pay_periods pp ON ps.pay_period_id = pp.id
     WHERE ps.employee_id = ?
     AND pp.start_date >= ? AND pp.end_date <= ?`
  ).all(
    employeeId,
    `${targetYear}-01-01`,
    `${targetYear}-12-31`
  ) as PayStubRow[];

  const stubs = rows.map(rowToPayStub);

  const totalGross = stubs.reduce((sum, s) => sum + s.gross_pay, 0);
  const totalNet = stubs.reduce((sum, s) => sum + s.net_pay, 0);

  // Aggregate deductions by category
  const totalDeductions: Record<string, number> = {};
  for (const stub of stubs) {
    for (const [key, value] of Object.entries(stub.deductions)) {
      totalDeductions[key] = (totalDeductions[key] || 0) + value;
    }
  }
  // Round all deduction totals
  for (const key of Object.keys(totalDeductions)) {
    totalDeductions[key] = Math.round(totalDeductions[key] * 100) / 100;
  }

  return {
    employee,
    year: targetYear,
    total_gross: Math.round(totalGross * 100) / 100,
    total_deductions: totalDeductions,
    total_net: Math.round(totalNet * 100) / 100,
    pay_stubs_count: stubs.length,
  };
}

// --- Tax Summary ---

export interface TaxSummaryEntry {
  employee_id: string;
  employee_name: string;
  total_gross: number;
  total_federal_tax: number;
  total_state_tax: number;
  total_social_security: number;
  total_medicare: number;
  total_deductions: number;
  total_net: number;
}

export function getTaxSummary(year: number): TaxSummaryEntry[] {
  const db = getDatabase();

  const employees = listEmployees();
  const entries: TaxSummaryEntry[] = [];

  for (const emp of employees) {
    const rows = db.prepare(
      `SELECT ps.* FROM pay_stubs ps
       JOIN pay_periods pp ON ps.pay_period_id = pp.id
       WHERE ps.employee_id = ?
       AND pp.start_date >= ? AND pp.end_date <= ?`
    ).all(
      emp.id,
      `${year}-01-01`,
      `${year}-12-31`
    ) as PayStubRow[];

    if (rows.length === 0) continue;

    const stubs = rows.map(rowToPayStub);

    let totalGross = 0;
    let totalFederalTax = 0;
    let totalStateTax = 0;
    let totalSocialSecurity = 0;
    let totalMedicare = 0;
    let totalNet = 0;

    for (const stub of stubs) {
      totalGross += stub.gross_pay;
      totalNet += stub.net_pay;
      totalFederalTax += stub.deductions.federal_tax || 0;
      totalStateTax += stub.deductions.state_tax || 0;
      totalSocialSecurity += stub.deductions.social_security || 0;
      totalMedicare += stub.deductions.medicare || 0;
    }

    const totalDeductions = totalFederalTax + totalStateTax + totalSocialSecurity + totalMedicare;

    entries.push({
      employee_id: emp.id,
      employee_name: emp.name,
      total_gross: Math.round(totalGross * 100) / 100,
      total_federal_tax: Math.round(totalFederalTax * 100) / 100,
      total_state_tax: Math.round(totalStateTax * 100) / 100,
      total_social_security: Math.round(totalSocialSecurity * 100) / 100,
      total_medicare: Math.round(totalMedicare * 100) / 100,
      total_deductions: Math.round(totalDeductions * 100) / 100,
      total_net: Math.round(totalNet * 100) / 100,
    });
  }

  return entries;
}

// --- ACH/NACHA File Generation ---

/**
 * Generate a NACHA-format ACH file for a completed pay period.
 * Returns the file content as a string.
 */
export function generateAchFile(
  periodId: string,
  bankRouting: string,
  bankAccount: string,
  companyName: string = "PAYROLL CO"
): string {
  const period = getPayPeriod(periodId);
  if (!period) throw new Error(`Pay period '${periodId}' not found`);

  const stubs = listPayStubs({ pay_period_id: periodId });
  if (stubs.length === 0) throw new Error("No pay stubs found for this period");

  const now = new Date();
  const fileDate = now.toISOString().slice(2, 10).replace(/-/g, ""); // YYMMDD
  const fileTime = now.toTimeString().slice(0, 5).replace(":", "");   // HHMM
  const batchDate = now.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD → used as effective date

  const lines: string[] = [];

  // File Header Record (type 1)
  const fhr = [
    "1",                                          // Record Type Code
    "01",                                         // Priority Code
    ` ${bankRouting.padStart(9, "0")}`,           // Immediate Destination (10 chars, leading space)
    ` ${bankRouting.padStart(9, "0")}`,           // Immediate Origin (10 chars)
    fileDate,                                     // File Creation Date
    fileTime,                                     // File Creation Time
    "A",                                          // File ID Modifier
    "094",                                        // Record Size
    "10",                                         // Blocking Factor
    "1",                                          // Format Code
    "DEST BANK".padEnd(23, " "),                  // Immediate Destination Name
    companyName.padEnd(23, " ").slice(0, 23),     // Immediate Origin Name
    "".padEnd(8, " "),                            // Reference Code
  ].join("");
  lines.push(fhr.padEnd(94, " "));

  // Batch Header Record (type 5)
  const bhr = [
    "5",                                          // Record Type Code
    "200",                                        // Service Class Code (mixed debits/credits)
    companyName.padEnd(16, " ").slice(0, 16),     // Company Name
    "".padEnd(20, " "),                           // Company Discretionary Data
    bankRouting.padStart(10, "0").slice(0, 10),   // Company Identification
    "PPD",                                        // Standard Entry Class Code
    "PAYROLL".padEnd(10, " ").slice(0, 10),       // Company Entry Description
    batchDate.slice(2),                           // Company Descriptive Date
    batchDate.slice(2),                           // Effective Entry Date
    "".padEnd(3, " "),                            // Settlement Date
    "1",                                          // Originator Status Code
    bankRouting.padStart(8, "0").slice(0, 8),     // Originating DFI Identification
    "0000001",                                    // Batch Number
  ].join("");
  lines.push(bhr.padEnd(94, " "));

  // Entry Detail Records (type 6)
  let entryCount = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  let entryHash = 0;

  for (const stub of stubs) {
    const emp = getEmployee(stub.employee_id);
    if (!emp) continue;

    entryCount++;
    const amount = Math.round(stub.net_pay * 100); // Amount in cents
    totalCredit += amount;
    const routingForHash = parseInt(bankRouting.slice(0, 8)) || 0;
    entryHash += routingForHash;

    const entry = [
      "6",                                              // Record Type Code
      "22",                                             // Transaction Code (checking credit)
      bankRouting.padStart(8, "0").slice(0, 8),         // Receiving DFI Identification
      bankRouting.slice(-1) || "0",                     // Check Digit
      bankAccount.padEnd(17, " ").slice(0, 17),         // DFI Account Number
      amount.toString().padStart(10, "0"),              // Amount
      emp.id.slice(0, 15).padEnd(15, " "),              // Individual ID Number
      (emp.name || "EMPLOYEE").padEnd(22, " ").slice(0, 22), // Individual Name
      "  ",                                             // Discretionary Data
      "0",                                              // Addenda Record Indicator
      bankRouting.padStart(8, "0").slice(0, 8),         // Trace Number (routing)
      entryCount.toString().padStart(7, "0"),           // Trace Number (sequence)
    ].join("");
    lines.push(entry.padEnd(94, " "));
  }

  // Batch Control Record (type 8)
  const bcr = [
    "8",                                            // Record Type Code
    "200",                                          // Service Class Code
    entryCount.toString().padStart(6, "0"),          // Entry/Addenda Count
    (entryHash % 10000000000).toString().padStart(10, "0"), // Entry Hash
    totalDebit.toString().padStart(12, "0"),         // Total Debit
    totalCredit.toString().padStart(12, "0"),        // Total Credit
    bankRouting.padStart(10, "0").slice(0, 10),     // Company Identification
    "".padEnd(19, " "),                             // Message Authentication Code
    "".padEnd(6, " "),                              // Reserved
    bankRouting.padStart(8, "0").slice(0, 8),       // Originating DFI Identification
    "0000001",                                      // Batch Number
  ].join("");
  lines.push(bcr.padEnd(94, " "));

  // File Control Record (type 9)
  const blockCount = Math.ceil((lines.length + 1) / 10);
  const fcr = [
    "9",                                            // Record Type Code
    "000001",                                       // Batch Count
    blockCount.toString().padStart(6, "0"),          // Block Count
    entryCount.toString().padStart(8, "0"),          // Entry/Addenda Count
    (entryHash % 10000000000).toString().padStart(10, "0"), // Entry Hash
    totalDebit.toString().padStart(12, "0"),         // Total Debit
    totalCredit.toString().padStart(12, "0"),        // Total Credit
    "".padEnd(39, " "),                             // Reserved
  ].join("");
  lines.push(fcr.padEnd(94, " "));

  // Pad to block of 10
  while (lines.length % 10 !== 0) {
    lines.push("9".repeat(94));
  }

  return lines.join("\n");
}

// --- W-2 Generation ---

export interface W2Data {
  employee_id: string;
  employee_name: string;
  year: number;
  gross: number;
  federal_withheld: number;
  state_withheld: number;
  social_security: number;
  medicare: number;
}

/**
 * Generate W-2 data for an employee for a given year.
 * Sums all pay stubs for the year.
 */
export function generateW2(employeeId: string, year: number): W2Data | null {
  const db = getDatabase();
  const employee = getEmployee(employeeId);
  if (!employee) return null;

  // Only W-2 employees (not contractors)
  if (employee.type === "contractor") return null;

  const rows = db.prepare(
    `SELECT ps.* FROM pay_stubs ps
     JOIN pay_periods pp ON ps.pay_period_id = pp.id
     WHERE ps.employee_id = ?
     AND pp.start_date >= ? AND pp.end_date <= ?`
  ).all(
    employeeId,
    `${year}-01-01`,
    `${year}-12-31`
  ) as PayStubRow[];

  const stubs = rows.map(rowToPayStub);
  if (stubs.length === 0) return null;

  let gross = 0;
  let federalWithheld = 0;
  let stateWithheld = 0;
  let socialSecurity = 0;
  let medicare = 0;

  for (const stub of stubs) {
    gross += stub.gross_pay;
    federalWithheld += stub.deductions.federal_tax || 0;
    stateWithheld += stub.deductions.state_tax || 0;
    socialSecurity += stub.deductions.social_security || 0;
    medicare += stub.deductions.medicare || 0;
  }

  return {
    employee_id: employee.id,
    employee_name: employee.name,
    year,
    gross: Math.round(gross * 100) / 100,
    federal_withheld: Math.round(federalWithheld * 100) / 100,
    state_withheld: Math.round(stateWithheld * 100) / 100,
    social_security: Math.round(socialSecurity * 100) / 100,
    medicare: Math.round(medicare * 100) / 100,
  };
}

// --- 1099-NEC Generation ---

export interface Form1099Data {
  employee_id: string;
  employee_name: string;
  year: number;
  total_compensation: number;
}

/**
 * Generate 1099-NEC data for contractors with total compensation > $600.
 * Returns data for a single contractor, or all eligible contractors if no employeeId given.
 */
export function generate1099(employeeId: string | null, year: number): Form1099Data[] {
  const db = getDatabase();
  const contractors = employeeId
    ? listEmployees({ type: "contractor" }).filter((e) => e.id === employeeId)
    : listEmployees({ type: "contractor" });

  const results: Form1099Data[] = [];

  for (const contractor of contractors) {
    const rows = db.prepare(
      `SELECT ps.* FROM pay_stubs ps
       JOIN pay_periods pp ON ps.pay_period_id = pp.id
       WHERE ps.employee_id = ?
       AND pp.start_date >= ? AND pp.end_date <= ?`
    ).all(
      contractor.id,
      `${year}-01-01`,
      `${year}-12-31`
    ) as PayStubRow[];

    const stubs = rows.map(rowToPayStub);
    const total = stubs.reduce((sum, s) => sum + s.gross_pay, 0);

    if (total > 600) {
      results.push({
        employee_id: contractor.id,
        employee_name: contractor.name,
        year,
        total_compensation: Math.round(total * 100) / 100,
      });
    }
  }

  return results;
}

// --- Audit Report ---

export interface AuditResult {
  period_id: string;
  issues: string[];
  passed: boolean;
}

/**
 * Audit a payroll period for common issues:
 * - All active employees have stubs
 * - net_pay > 0 for all stubs
 * - Deductions sum correctly (gross - deductions = net)
 * - No duplicate stubs per employee
 */
export function auditPayroll(periodId: string): AuditResult {
  const period = getPayPeriod(periodId);
  if (!period) throw new Error(`Pay period '${periodId}' not found`);

  const issues: string[] = [];
  const stubs = listPayStubs({ pay_period_id: periodId });
  const activeEmployees = listEmployees({ status: "active" });

  // Check: all active employees have stubs
  if (period.status === "completed") {
    for (const emp of activeEmployees) {
      const hasStub = stubs.some((s) => s.employee_id === emp.id);
      if (!hasStub) {
        issues.push(`Active employee '${emp.name}' (${emp.id}) missing pay stub`);
      }
    }
  }

  // Check: net_pay > 0
  for (const stub of stubs) {
    if (stub.net_pay <= 0) {
      issues.push(`Pay stub ${stub.id} has non-positive net_pay: $${stub.net_pay}`);
    }
  }

  // Check: deductions sum correctly (gross - sum(deductions) = net, within $0.02 tolerance)
  for (const stub of stubs) {
    const deductionsTotal = Object.values(stub.deductions).reduce((sum, d) => sum + d, 0);
    const expectedNet = Math.round((stub.gross_pay - deductionsTotal) * 100) / 100;
    const diff = Math.abs(expectedNet - stub.net_pay);
    if (diff > 0.02) {
      issues.push(
        `Pay stub ${stub.id}: deduction mismatch — gross=$${stub.gross_pay}, deductions=$${deductionsTotal.toFixed(2)}, expected_net=$${expectedNet}, actual_net=$${stub.net_pay}`
      );
    }
  }

  // Check: no duplicate stubs per employee
  const empStubCount = new Map<string, number>();
  for (const stub of stubs) {
    empStubCount.set(stub.employee_id, (empStubCount.get(stub.employee_id) || 0) + 1);
  }
  for (const [empId, count] of empStubCount) {
    if (count > 1) {
      issues.push(`Employee ${empId} has ${count} duplicate stubs in this period`);
    }
  }

  return {
    period_id: periodId,
    issues,
    passed: issues.length === 0,
  };
}

// --- Cost Forecast ---

export interface ForecastResult {
  months: number;
  periods: { month: string; estimated_gross: number; estimated_deductions: number; estimated_net: number }[];
  total_estimated_gross: number;
  total_estimated_deductions: number;
  total_estimated_net: number;
}

/**
 * Forecast future payroll costs based on current active employees.
 * Assumes semi-monthly pay periods (2 per month).
 */
export function forecastPayroll(months: number): ForecastResult {
  const activeEmployees = listEmployees({ status: "active" });

  let monthlyGross = 0;
  let monthlyDeductions = 0;

  for (const emp of activeEmployees) {
    // Calculate per-period gross
    const periodGross = calculateGrossPay(emp);
    const deductions = calculateDeductions(periodGross, emp.type);
    const benefitDeds = getBenefitDeductions(emp.id);
    const totalDeds = Object.values(deductions).reduce((s, d) => s + d, 0)
      + Object.values(benefitDeds).reduce((s, d) => s + d, 0);

    // 2 periods per month (semi-monthly)
    monthlyGross += periodGross * 2;
    monthlyDeductions += totalDeds * 2;
  }

  monthlyGross = Math.round(monthlyGross * 100) / 100;
  monthlyDeductions = Math.round(monthlyDeductions * 100) / 100;
  const monthlyNet = Math.round((monthlyGross - monthlyDeductions) * 100) / 100;

  const periods: ForecastResult["periods"] = [];
  const now = new Date();

  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    periods.push({
      month: monthStr,
      estimated_gross: monthlyGross,
      estimated_deductions: monthlyDeductions,
      estimated_net: monthlyNet,
    });
  }

  return {
    months,
    periods,
    total_estimated_gross: Math.round(monthlyGross * months * 100) / 100,
    total_estimated_deductions: Math.round(monthlyDeductions * months * 100) / 100,
    total_estimated_net: Math.round(monthlyNet * months * 100) / 100,
  };
}

// --- Overtime Alerts ---

export interface OvertimeAlert {
  employee_id: string;
  employee_name: string;
  total_hours: number;
  overtime_hours: number;
  threshold: number;
}

/**
 * Check all pay stubs in the most recent period(s) for employees exceeding a weekly hours threshold.
 * Looks at hours_worked on stubs, flags those above threshold.
 */
export function checkOvertime(threshold: number = 40): OvertimeAlert[] {
  // Get the most recent completed period
  const periods = listPayPeriods("completed");
  if (periods.length === 0) return [];

  const latestPeriod = periods[0];
  const stubs = listPayStubs({ pay_period_id: latestPeriod.id });

  const alerts: OvertimeAlert[] = [];

  for (const stub of stubs) {
    const totalHours = (stub.hours_worked || 0) + stub.overtime_hours;
    if (totalHours > threshold) {
      const emp = getEmployee(stub.employee_id);
      alerts.push({
        employee_id: stub.employee_id,
        employee_name: emp?.name || "Unknown",
        total_hours: totalHours,
        overtime_hours: Math.max(0, totalHours - threshold),
        threshold,
      });
    }
  }

  return alerts;
}
