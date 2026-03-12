/**
 * Expense and Category CRUD operations
 */

import { getDatabase } from "./database.js";

// --- Expenses ---

export interface Expense {
  id: string;
  amount: number;
  currency: string;
  category: string | null;
  description: string | null;
  vendor: string | null;
  date: string;
  receipt_url: string | null;
  status: "pending" | "approved" | "rejected" | "reimbursed";
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface ExpenseRow {
  id: string;
  amount: number;
  currency: string;
  category: string | null;
  description: string | null;
  vendor: string | null;
  date: string;
  receipt_url: string | null;
  status: string;
  tags: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToExpense(row: ExpenseRow): Expense {
  return {
    ...row,
    status: row.status as Expense["status"],
    tags: JSON.parse(row.tags || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface CreateExpenseInput {
  amount: number;
  currency?: string;
  category?: string;
  description?: string;
  vendor?: string;
  date?: string;
  receipt_url?: string;
  status?: Expense["status"];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function createExpense(input: CreateExpenseInput): Expense {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const tags = JSON.stringify(input.tags || []);
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO expenses (id, amount, currency, category, description, vendor, date, receipt_url, status, tags, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.amount,
    input.currency || "USD",
    input.category || null,
    input.description || null,
    input.vendor || null,
    input.date || new Date().toISOString().split("T")[0],
    input.receipt_url || null,
    input.status || "pending",
    tags,
    metadata
  );

  return getExpense(id)!;
}

export function getExpense(id: string): Expense | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM expenses WHERE id = ?").get(id) as ExpenseRow | null;
  return row ? rowToExpense(row) : null;
}

export interface ListExpensesOptions {
  category?: string;
  status?: string;
  vendor?: string;
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
}

export function listExpenses(options: ListExpensesOptions = {}): Expense[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.category) {
    conditions.push("category = ?");
    params.push(options.category);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.vendor) {
    conditions.push("vendor = ?");
    params.push(options.vendor);
  }

  if (options.from_date) {
    conditions.push("date >= ?");
    params.push(options.from_date);
  }

  if (options.to_date) {
    conditions.push("date <= ?");
    params.push(options.to_date);
  }

  let sql = "SELECT * FROM expenses";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY date DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as ExpenseRow[];
  return rows.map(rowToExpense);
}

export interface UpdateExpenseInput {
  amount?: number;
  currency?: string;
  category?: string;
  description?: string;
  vendor?: string;
  date?: string;
  receipt_url?: string;
  status?: Expense["status"];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function updateExpense(
  id: string,
  input: UpdateExpenseInput
): Expense | null {
  const db = getDatabase();
  const existing = getExpense(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.amount !== undefined) {
    sets.push("amount = ?");
    params.push(input.amount);
  }
  if (input.currency !== undefined) {
    sets.push("currency = ?");
    params.push(input.currency);
  }
  if (input.category !== undefined) {
    sets.push("category = ?");
    params.push(input.category);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.vendor !== undefined) {
    sets.push("vendor = ?");
    params.push(input.vendor);
  }
  if (input.date !== undefined) {
    sets.push("date = ?");
    params.push(input.date);
  }
  if (input.receipt_url !== undefined) {
    sets.push("receipt_url = ?");
    params.push(input.receipt_url);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.tags !== undefined) {
    sets.push("tags = ?");
    params.push(JSON.stringify(input.tags));
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE expenses SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getExpense(id);
}

export function deleteExpense(id: string): boolean {
  const db = getDatabase();
  return db.prepare("DELETE FROM expenses WHERE id = ?").run(id).changes > 0;
}

// --- Summary ---

export interface ExpenseSummaryByCategory {
  category: string | null;
  total: number;
  count: number;
}

export interface ExpenseSummaryByMonth {
  month: string;
  total: number;
  count: number;
}

export function getExpenseSummary(): {
  total_expenses: number;
  pending: number;
  approved: number;
  rejected: number;
  reimbursed: number;
  total_amount: number;
  by_category: ExpenseSummaryByCategory[];
  by_month: ExpenseSummaryByMonth[];
} {
  const db = getDatabase();

  const counts = db
    .prepare(
      `SELECT
        COUNT(*) as total_expenses,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN status = 'reimbursed' THEN 1 ELSE 0 END) as reimbursed,
        COALESCE(SUM(amount), 0) as total_amount
      FROM expenses`
    )
    .get() as {
    total_expenses: number;
    pending: number;
    approved: number;
    rejected: number;
    reimbursed: number;
    total_amount: number;
  };

  const by_category = db
    .prepare(
      `SELECT category, SUM(amount) as total, COUNT(*) as count
       FROM expenses
       GROUP BY category
       ORDER BY total DESC`
    )
    .all() as ExpenseSummaryByCategory[];

  const by_month = db
    .prepare(
      `SELECT strftime('%Y-%m', date) as month, SUM(amount) as total, COUNT(*) as count
       FROM expenses
       GROUP BY month
       ORDER BY month DESC`
    )
    .all() as ExpenseSummaryByMonth[];

  return { ...counts, by_category, by_month };
}

// --- Categories ---

export interface ExpenseCategory {
  id: string;
  name: string;
  budget_limit: number | null;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCategoryInput {
  name: string;
  budget_limit?: number;
  parent_id?: string;
}

export function createCategory(input: CreateCategoryInput): ExpenseCategory {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO expense_categories (id, name, budget_limit, parent_id)
     VALUES (?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.budget_limit || null,
    input.parent_id || null
  );

  return db.prepare("SELECT * FROM expense_categories WHERE id = ?").get(id) as ExpenseCategory;
}

export function listCategories(): ExpenseCategory[] {
  const db = getDatabase();
  return db.prepare("SELECT * FROM expense_categories ORDER BY name").all() as ExpenseCategory[];
}

export function deleteCategory(id: string): boolean {
  const db = getDatabase();
  return db.prepare("DELETE FROM expense_categories WHERE id = ?").run(id).changes > 0;
}
