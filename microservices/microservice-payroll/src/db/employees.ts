/**
 * Employee CRUD operations
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

export interface EmployeeRow {
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

export function rowToEmployee(row: EmployeeRow): Employee {
  return {
    ...row,
    type: row.type as Employee["type"],
    status: row.status as Employee["status"],
    pay_type: row.pay_type as Employee["pay_type"],
    tax_info: JSON.parse(row.tax_info || "{}"),
  };
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
