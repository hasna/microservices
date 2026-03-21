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
