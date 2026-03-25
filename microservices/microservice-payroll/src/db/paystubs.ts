/**
 * Pay period, pay stub, and payment CRUD operations
 */

import { getDatabase } from "./database.js";

// --- Pay Period ---

export interface PayPeriod {
  id: string;
  start_date: string;
  end_date: string;
  status: "draft" | "processing" | "completed";
  created_at: string;
}

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

// --- Pay Stub ---

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

export interface PayStubRow {
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

export function rowToPayStub(row: PayStubRow): PayStub {
  return {
    ...row,
    deductions: JSON.parse(row.deductions || "{}"),
  };
}

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

// --- Payment ---

export interface Payment {
  id: string;
  pay_stub_id: string;
  method: "direct_deposit" | "check" | "wire";
  status: "pending" | "paid" | "failed";
  paid_at: string | null;
  reference: string | null;
  created_at: string;
}

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
