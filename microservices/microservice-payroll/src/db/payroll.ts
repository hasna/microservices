/**
 * Payroll CRUD and business logic operations
 */

import { getDatabase } from "./database.js";

// --- Types ---

export interface Employee {
  id: string;
  name: string;
  email: string | null;
  type: "employee" | "contractor";
  status: "active" | "terminated";
  department: string | null;
  title: string | null;
  pay_rate: number;
  pay_type: "salary" | "hourly";
  currency: string;
  tax_info: Record<string, unknown>;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

interface EmployeeRow {
  id: string;
  name: string;
  email: string | null;
  type: string;
  status: string;
  department: string | null;
  title: string | null;
  pay_rate: number;
  pay_type: string;
  currency: string;
  tax_info: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

function rowToEmployee(row: EmployeeRow): Employee {
  return {
    ...row,
    type: row.type as Employee["type"],
    status: row.status as Employee["status"],
    pay_type: row.pay_type as Employee["pay_type"],
    tax_info: JSON.parse(row.tax_info || "{}"),
  };
}

export interface PayPeriod {
  id: string;
  start_date: string;
  end_date: string;
  status: "draft" | "processing" | "completed";
  created_at: string;
}

export interface PayStub {
  id: string;
  employee_id: string;
  pay_period_id: string;
  gross_pay: number;
  deductions: Record<string, number>;
  net_pay: number;
  hours_worked: number | null;
  overtime_hours: number;
  created_at: string;
}

interface PayStubRow {
  id: string;
  employee_id: string;
  pay_period_id: string;
  gross_pay: number;
  deductions: string;
  net_pay: number;
  hours_worked: number | null;
  overtime_hours: number;
  created_at: string;
}

function rowToPayStub(row: PayStubRow): PayStub {
  return {
    ...row,
    deductions: JSON.parse(row.deductions || "{}"),
  };
}

export interface Payment {
  id: string;
  pay_stub_id: string;
  method: "direct_deposit" | "check" | "wire";
  status: "pending" | "paid" | "failed";
  paid_at: string | null;
  reference: string | null;
  created_at: string;
}

// --- Employee CRUD ---

export interface CreateEmployeeInput {
  name: string;
  email?: string;
  type?: "employee" | "contractor";
  status?: "active" | "terminated";
  department?: string;
  title?: string;
  pay_rate: number;
  pay_type?: "salary" | "hourly";
  currency?: string;
  tax_info?: Record<string, unknown>;
  start_date?: string;
  end_date?: string;
}

export function createEmployee(input: CreateEmployeeInput): Employee {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const taxInfo = JSON.stringify(input.tax_info || {});

  db.prepare(
    `INSERT INTO employees (id, name, email, type, status, department, title, pay_rate, pay_type, currency, tax_info, start_date, end_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.email || null,
    input.type || "employee",
    input.status || "active",
    input.department || null,
    input.title || null,
    input.pay_rate,
    input.pay_type || "salary",
    input.currency || "USD",
    taxInfo,
    input.start_date || null,
    input.end_date || null
  );

  return getEmployee(id)!;
}

export function getEmployee(id: string): Employee | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM employees WHERE id = ?").get(id) as EmployeeRow | null;
  return row ? rowToEmployee(row) : null;
}

export interface ListEmployeesOptions {
  search?: string;
  status?: string;
  department?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

export function listEmployees(options: ListEmployeesOptions = {}): Employee[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    conditions.push("(name LIKE ? OR email LIKE ? OR department LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q, q);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.department) {
    conditions.push("department = ?");
    params.push(options.department);
  }

  if (options.type) {
    conditions.push("type = ?");
    params.push(options.type);
  }

  let sql = "SELECT * FROM employees";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY name";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as EmployeeRow[];
  return rows.map(rowToEmployee);
}

export interface UpdateEmployeeInput {
  name?: string;
  email?: string;
  type?: "employee" | "contractor";
  status?: "active" | "terminated";
  department?: string;
  title?: string;
  pay_rate?: number;
  pay_type?: "salary" | "hourly";
  currency?: string;
  tax_info?: Record<string, unknown>;
  start_date?: string;
  end_date?: string;
}

export function updateEmployee(id: string, input: UpdateEmployeeInput): Employee | null {
  const db = getDatabase();
  const existing = getEmployee(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.email !== undefined) { sets.push("email = ?"); params.push(input.email); }
  if (input.type !== undefined) { sets.push("type = ?"); params.push(input.type); }
  if (input.status !== undefined) { sets.push("status = ?"); params.push(input.status); }
  if (input.department !== undefined) { sets.push("department = ?"); params.push(input.department); }
  if (input.title !== undefined) { sets.push("title = ?"); params.push(input.title); }
  if (input.pay_rate !== undefined) { sets.push("pay_rate = ?"); params.push(input.pay_rate); }
  if (input.pay_type !== undefined) { sets.push("pay_type = ?"); params.push(input.pay_type); }
  if (input.currency !== undefined) { sets.push("currency = ?"); params.push(input.currency); }
  if (input.tax_info !== undefined) { sets.push("tax_info = ?"); params.push(JSON.stringify(input.tax_info)); }
  if (input.start_date !== undefined) { sets.push("start_date = ?"); params.push(input.start_date); }
  if (input.end_date !== undefined) { sets.push("end_date = ?"); params.push(input.end_date); }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE employees SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getEmployee(id);
}

export function deleteEmployee(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM employees WHERE id = ?").run(id);
  return result.changes > 0;
}

export function terminateEmployee(id: string, endDate?: string): Employee | null {
  return updateEmployee(id, {
    status: "terminated",
    end_date: endDate || new Date().toISOString().split("T")[0],
  });
}

export function countEmployees(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM employees").get() as { count: number };
  return row.count;
}

// --- Pay Period CRUD ---

export interface CreatePayPeriodInput {
  start_date: string;
  end_date: string;
  status?: "draft" | "processing" | "completed";
}

export function createPayPeriod(input: CreatePayPeriodInput): PayPeriod {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO pay_periods (id, start_date, end_date, status) VALUES (?, ?, ?, ?)`
  ).run(id, input.start_date, input.end_date, input.status || "draft");

  return getPayPeriod(id)!;
}

export function getPayPeriod(id: string): PayPeriod | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM pay_periods WHERE id = ?").get(id) as PayPeriod | null;
  return row || null;
}

export function listPayPeriods(status?: string): PayPeriod[] {
  const db = getDatabase();
  if (status) {
    return db.prepare("SELECT * FROM pay_periods WHERE status = ? ORDER BY start_date DESC").all(status) as PayPeriod[];
  }
  return db.prepare("SELECT * FROM pay_periods ORDER BY start_date DESC").all() as PayPeriod[];
}

export function updatePayPeriodStatus(id: string, status: "draft" | "processing" | "completed"): PayPeriod | null {
  const db = getDatabase();
  const existing = getPayPeriod(id);
  if (!existing) return null;

  db.prepare("UPDATE pay_periods SET status = ? WHERE id = ?").run(status, id);
  return getPayPeriod(id);
}

export function deletePayPeriod(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM pay_periods WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Pay Stub CRUD ---

export interface CreatePayStubInput {
  employee_id: string;
  pay_period_id: string;
  gross_pay: number;
  deductions?: Record<string, number>;
  net_pay: number;
  hours_worked?: number;
  overtime_hours?: number;
}

export function createPayStub(input: CreatePayStubInput): PayStub {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const deductions = JSON.stringify(input.deductions || {});

  db.prepare(
    `INSERT INTO pay_stubs (id, employee_id, pay_period_id, gross_pay, deductions, net_pay, hours_worked, overtime_hours)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.employee_id,
    input.pay_period_id,
    input.gross_pay,
    deductions,
    input.net_pay,
    input.hours_worked ?? null,
    input.overtime_hours ?? 0
  );

  return getPayStub(id)!;
}

export function getPayStub(id: string): PayStub | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM pay_stubs WHERE id = ?").get(id) as PayStubRow | null;
  return row ? rowToPayStub(row) : null;
}

export function listPayStubs(options: { employee_id?: string; pay_period_id?: string } = {}): PayStub[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.employee_id) {
    conditions.push("employee_id = ?");
    params.push(options.employee_id);
  }
  if (options.pay_period_id) {
    conditions.push("pay_period_id = ?");
    params.push(options.pay_period_id);
  }

  let sql = "SELECT * FROM pay_stubs";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(...params) as PayStubRow[];
  return rows.map(rowToPayStub);
}

export function deletePayStub(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM pay_stubs WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Payment CRUD ---

export interface CreatePaymentInput {
  pay_stub_id: string;
  method?: "direct_deposit" | "check" | "wire";
  status?: "pending" | "paid" | "failed";
  reference?: string;
}

export function createPayment(input: CreatePaymentInput): Payment {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO payments (id, pay_stub_id, method, status, reference)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    id,
    input.pay_stub_id,
    input.method || "direct_deposit",
    input.status || "pending",
    input.reference || null
  );

  return getPayment(id)!;
}

export function getPayment(id: string): Payment | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM payments WHERE id = ?").get(id) as Payment | null;
  return row || null;
}

export function listPayments(options: { pay_stub_id?: string; status?: string } = {}): Payment[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.pay_stub_id) {
    conditions.push("pay_stub_id = ?");
    params.push(options.pay_stub_id);
  }
  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  let sql = "SELECT * FROM payments";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  return db.prepare(sql).all(...params) as Payment[];
}

export function updatePaymentStatus(id: string, status: "pending" | "paid" | "failed"): Payment | null {
  const db = getDatabase();
  const existing = getPayment(id);
  if (!existing) return null;

  const paidAt = status === "paid" ? new Date().toISOString() : null;
  db.prepare("UPDATE payments SET status = ?, paid_at = ? WHERE id = ?").run(status, paidAt, id);

  return getPayment(id);
}

export function deletePayment(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM payments WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Benefits CRUD ---

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

// --- Payroll Schedule ---

export interface PayrollSchedule {
  id: string;
  frequency: "weekly" | "biweekly" | "semimonthly" | "monthly";
  anchor_date: string;
  created_at: string;
}

export function setSchedule(frequency: PayrollSchedule["frequency"], anchorDate: string): PayrollSchedule {
  const db = getDatabase();
  // Only one schedule at a time — delete existing and insert new
  db.prepare("DELETE FROM payroll_schedule").run();
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO payroll_schedule (id, frequency, anchor_date) VALUES (?, ?, ?)"
  ).run(id, frequency, anchorDate);
  return getSchedule()!;
}

export function getSchedule(): PayrollSchedule | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM payroll_schedule ORDER BY created_at DESC LIMIT 1").get() as PayrollSchedule | null;
  return row || null;
}

/**
 * Calculate the next pay period based on the payroll schedule.
 * Returns {start_date, end_date} for the next upcoming period from today.
 */
export function getNextPayPeriod(fromDate?: string): { start_date: string; end_date: string } | null {
  const schedule = getSchedule();
  if (!schedule) return null;

  const today = fromDate ? new Date(fromDate) : new Date();
  const anchor = new Date(schedule.anchor_date);

  switch (schedule.frequency) {
    case "weekly": {
      // Find the next weekly start from anchor
      const msPerWeek = 7 * 24 * 60 * 60 * 1000;
      const diffMs = today.getTime() - anchor.getTime();
      const weeksSinceAnchor = Math.ceil(diffMs / msPerWeek);
      const start = new Date(anchor.getTime() + weeksSinceAnchor * msPerWeek);
      const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
      return { start_date: fmtDate(start), end_date: fmtDate(end) };
    }
    case "biweekly": {
      const msPerTwoWeeks = 14 * 24 * 60 * 60 * 1000;
      const diffMs = today.getTime() - anchor.getTime();
      const biweeksSinceAnchor = Math.ceil(diffMs / msPerTwoWeeks);
      const start = new Date(anchor.getTime() + biweeksSinceAnchor * msPerTwoWeeks);
      const end = new Date(start.getTime() + 13 * 24 * 60 * 60 * 1000);
      return { start_date: fmtDate(start), end_date: fmtDate(end) };
    }
    case "semimonthly": {
      // Periods: 1st-15th and 16th-end of month
      const year = today.getFullYear();
      const month = today.getMonth();
      const day = today.getDate();
      if (day <= 15) {
        return {
          start_date: fmtDate(new Date(year, month, 1)),
          end_date: fmtDate(new Date(year, month, 15)),
        };
      } else {
        const lastDay = new Date(year, month + 1, 0).getDate();
        return {
          start_date: fmtDate(new Date(year, month, 16)),
          end_date: fmtDate(new Date(year, month, lastDay)),
        };
      }
    }
    case "monthly": {
      const year = today.getFullYear();
      const month = today.getMonth();
      const lastDay = new Date(year, month + 1, 0).getDate();
      return {
        start_date: fmtDate(new Date(year, month, 1)),
        end_date: fmtDate(new Date(year, month, lastDay)),
      };
    }
    default:
      return null;
  }
}

function fmtDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

// --- Business Logic ---

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

/**
 * Get a payroll report for a pay period.
 */
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

/**
 * Get year-to-date report for an employee.
 */
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

/**
 * Get tax summary for all employees for a given year.
 */
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
  const db = getDatabase();
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
