/**
 * Bookkeeping CRUD operations — double-entry accounting
 */

import { getDatabase } from "./database.js";

// --- Types ---

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  code: string | null;
  description: string | null;
  parent_id: string | null;
  balance: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface TransactionRow {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  metadata: string;
  created_at: string;
}

export interface TransactionEntry {
  id: string;
  transaction_id: string;
  account_id: string;
  debit: number;
  credit: number;
  description: string | null;
}

export interface TransactionWithEntries extends Transaction {
  entries: TransactionEntry[];
}

function rowToTransaction(row: TransactionRow): Transaction {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

// --- Accounts ---

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  code?: string;
  description?: string;
  parent_id?: string;
  currency?: string;
}

export function createAccount(input: CreateAccountInput): Account {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO accounts (id, name, type, code, description, parent_id, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.type,
    input.code || null,
    input.description || null,
    input.parent_id || null,
    input.currency || "USD"
  );

  return getAccount(id)!;
}

export function getAccount(id: string): Account | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM accounts WHERE id = ? OR code = ?").get(id, id) as Account | null;
  return row || null;
}

export interface ListAccountsOptions {
  type?: AccountType;
  parent_id?: string;
  currency?: string;
  search?: string;
  limit?: number;
}

export function listAccounts(options: ListAccountsOptions = {}): Account[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.type) {
    conditions.push("type = ?");
    params.push(options.type);
  }

  if (options.parent_id) {
    conditions.push("parent_id = ?");
    params.push(options.parent_id);
  }

  if (options.currency) {
    conditions.push("currency = ?");
    params.push(options.currency);
  }

  if (options.search) {
    conditions.push("(name LIKE ? OR code LIKE ? OR description LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q, q);
  }

  let sql = "SELECT * FROM accounts";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY type, code, name";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  return db.prepare(sql).all(...params) as Account[];
}

export interface UpdateAccountInput {
  name?: string;
  type?: AccountType;
  code?: string;
  description?: string;
  parent_id?: string | null;
  currency?: string;
}

export function updateAccount(id: string, input: UpdateAccountInput): Account | null {
  const db = getDatabase();
  const existing = getAccount(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.type !== undefined) {
    sets.push("type = ?");
    params.push(input.type);
  }
  if (input.code !== undefined) {
    sets.push("code = ?");
    params.push(input.code);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.parent_id !== undefined) {
    sets.push("parent_id = ?");
    params.push(input.parent_id);
  }
  if (input.currency !== undefined) {
    sets.push("currency = ?");
    params.push(input.currency);
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(existing.id);

  db.prepare(
    `UPDATE accounts SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getAccount(existing.id);
}

export function deleteAccount(id: string): boolean {
  const db = getDatabase();
  // Check if account has transaction entries
  const hasEntries = db
    .prepare("SELECT COUNT(*) as count FROM transaction_entries WHERE account_id = ?")
    .get(id) as { count: number };

  if (hasEntries.count > 0) {
    throw new Error("Cannot delete account with existing transaction entries");
  }

  return db.prepare("DELETE FROM accounts WHERE id = ?").run(id).changes > 0;
}

// --- Transactions ---

export interface TransactionEntryInput {
  account_id: string;
  debit?: number;
  credit?: number;
  description?: string;
}

export interface CreateTransactionInput {
  date?: string;
  description: string;
  reference?: string;
  metadata?: Record<string, unknown>;
  entries: TransactionEntryInput[];
}

export function createTransaction(input: CreateTransactionInput): TransactionWithEntries {
  const db = getDatabase();

  if (input.entries.length < 2) {
    throw new Error("Transaction must have at least two entries");
  }

  // Validate double-entry: total debits must equal total credits
  let totalDebits = 0;
  let totalCredits = 0;
  for (const entry of input.entries) {
    totalDebits += entry.debit || 0;
    totalCredits += entry.credit || 0;
  }

  // Round to avoid floating point issues
  totalDebits = Math.round(totalDebits * 100) / 100;
  totalCredits = Math.round(totalCredits * 100) / 100;

  if (totalDebits === 0) {
    throw new Error("Transaction must have at least one debit and one credit entry");
  }

  if (totalDebits !== totalCredits) {
    throw new Error(
      `Transaction does not balance: debits (${totalDebits}) != credits (${totalCredits})`
    );
  }

  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO transactions (id, date, description, reference, metadata)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      id,
      input.date || new Date().toISOString().split("T")[0],
      input.description,
      input.reference || null,
      metadata
    );

    const insertEntry = db.prepare(
      `INSERT INTO transaction_entries (id, transaction_id, account_id, debit, credit, description)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    for (const entry of input.entries) {
      insertEntry.run(
        crypto.randomUUID(),
        id,
        entry.account_id,
        entry.debit || 0,
        entry.credit || 0,
        entry.description || null
      );

      // Update account balance
      // Asset/Expense: debit increases, credit decreases
      // Liability/Equity/Revenue: credit increases, debit decreases
      const debit = entry.debit || 0;
      const credit = entry.credit || 0;
      const account = db.prepare("SELECT type FROM accounts WHERE id = ?").get(entry.account_id) as { type: AccountType } | null;

      if (!account) {
        throw new Error(`Account '${entry.account_id}' not found`);
      }

      let balanceChange: number;
      if (account.type === "asset" || account.type === "expense") {
        balanceChange = debit - credit;
      } else {
        balanceChange = credit - debit;
      }

      db.prepare(
        "UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?"
      ).run(balanceChange, entry.account_id);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getTransaction(id)!;
}

export function getTransaction(id: string): TransactionWithEntries | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM transactions WHERE id = ? OR reference = ?").get(id, id) as TransactionRow | null;
  if (!row) return null;

  const transaction = rowToTransaction(row);
  const entries = db
    .prepare("SELECT * FROM transaction_entries WHERE transaction_id = ? ORDER BY debit DESC")
    .all(transaction.id) as TransactionEntry[];

  return { ...transaction, entries };
}

export interface ListTransactionsOptions {
  from_date?: string;
  to_date?: string;
  account_id?: string;
  reference?: string;
  search?: string;
  limit?: number;
}

export function listTransactions(options: ListTransactionsOptions = {}): TransactionWithEntries[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.from_date) {
    conditions.push("t.date >= ?");
    params.push(options.from_date);
  }

  if (options.to_date) {
    conditions.push("t.date <= ?");
    params.push(options.to_date);
  }

  if (options.account_id) {
    conditions.push(
      "t.id IN (SELECT transaction_id FROM transaction_entries WHERE account_id = ?)"
    );
    params.push(options.account_id);
  }

  if (options.reference) {
    conditions.push("t.reference = ?");
    params.push(options.reference);
  }

  if (options.search) {
    conditions.push("(t.description LIKE ? OR t.reference LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q);
  }

  let sql = "SELECT t.* FROM transactions t";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY t.date DESC, t.created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  const rows = db.prepare(sql).all(...params) as TransactionRow[];

  return rows.map((row) => {
    const transaction = rowToTransaction(row);
    const entries = db
      .prepare("SELECT * FROM transaction_entries WHERE transaction_id = ? ORDER BY debit DESC")
      .all(transaction.id) as TransactionEntry[];
    return { ...transaction, entries };
  });
}

export function deleteTransaction(id: string): boolean {
  const db = getDatabase();

  // Get the transaction with entries to reverse balances
  const txn = getTransaction(id);
  if (!txn) return false;

  db.exec("BEGIN");
  try {
    // Reverse account balances
    for (const entry of txn.entries) {
      const account = db.prepare("SELECT type FROM accounts WHERE id = ?").get(entry.account_id) as { type: AccountType } | null;
      if (!account) continue;

      let balanceChange: number;
      if (account.type === "asset" || account.type === "expense") {
        balanceChange = entry.credit - entry.debit; // reverse
      } else {
        balanceChange = entry.debit - entry.credit; // reverse
      }

      db.prepare(
        "UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?"
      ).run(balanceChange, entry.account_id);
    }

    db.prepare("DELETE FROM transactions WHERE id = ?").run(txn.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return true;
}

// --- Reports ---

export interface TrialBalanceEntry {
  account_id: string;
  account_name: string;
  account_type: AccountType;
  account_code: string | null;
  debit: number;
  credit: number;
}

export function getTrialBalance(): {
  entries: TrialBalanceEntry[];
  total_debits: number;
  total_credits: number;
  balanced: boolean;
} {
  const db = getDatabase();

  const rows = db
    .prepare(
      `SELECT
        a.id as account_id,
        a.name as account_name,
        a.type as account_type,
        a.code as account_code,
        COALESCE(SUM(te.debit), 0) as debit,
        COALESCE(SUM(te.credit), 0) as credit
      FROM accounts a
      LEFT JOIN transaction_entries te ON a.id = te.account_id
      GROUP BY a.id
      HAVING debit > 0 OR credit > 0
      ORDER BY a.type, a.code, a.name`
    )
    .all() as TrialBalanceEntry[];

  let totalDebits = 0;
  let totalCredits = 0;
  for (const row of rows) {
    totalDebits += row.debit;
    totalCredits += row.credit;
  }

  totalDebits = Math.round(totalDebits * 100) / 100;
  totalCredits = Math.round(totalCredits * 100) / 100;

  return {
    entries: rows,
    total_debits: totalDebits,
    total_credits: totalCredits,
    balanced: totalDebits === totalCredits,
  };
}

export function getAccountBalance(accountId: string): {
  account: Account;
  total_debits: number;
  total_credits: number;
  balance: number;
} | null {
  const account = getAccount(accountId);
  if (!account) return null;

  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT
        COALESCE(SUM(debit), 0) as total_debits,
        COALESCE(SUM(credit), 0) as total_credits
      FROM transaction_entries
      WHERE account_id = ?`
    )
    .get(account.id) as { total_debits: number; total_credits: number };

  return {
    account,
    total_debits: row.total_debits,
    total_credits: row.total_credits,
    balance: account.balance,
  };
}

export function getIncomeStatement(options: {
  from_date?: string;
  to_date?: string;
} = {}): {
  revenue: { account_id: string; account_name: string; account_code: string | null; amount: number }[];
  expenses: { account_id: string; account_name: string; account_code: string | null; amount: number }[];
  total_revenue: number;
  total_expenses: number;
  net_income: number;
} {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.from_date) {
    conditions.push("t.date >= ?");
    params.push(options.from_date);
  }

  if (options.to_date) {
    conditions.push("t.date <= ?");
    params.push(options.to_date);
  }

  const dateFilter = conditions.length > 0 ? " AND " + conditions.join(" AND ") : "";

  // Revenue: credit increases balance
  const revenueRows = db
    .prepare(
      `SELECT
        a.id as account_id,
        a.name as account_name,
        a.code as account_code,
        COALESCE(SUM(te.credit) - SUM(te.debit), 0) as amount
      FROM accounts a
      LEFT JOIN transaction_entries te ON a.id = te.account_id
      LEFT JOIN transactions t ON te.transaction_id = t.id
      WHERE a.type = 'revenue'${dateFilter}
      GROUP BY a.id
      HAVING amount != 0
      ORDER BY a.code, a.name`
    )
    .all(...params) as { account_id: string; account_name: string; account_code: string | null; amount: number }[];

  // Expenses: debit increases balance
  const expenseRows = db
    .prepare(
      `SELECT
        a.id as account_id,
        a.name as account_name,
        a.code as account_code,
        COALESCE(SUM(te.debit) - SUM(te.credit), 0) as amount
      FROM accounts a
      LEFT JOIN transaction_entries te ON a.id = te.account_id
      LEFT JOIN transactions t ON te.transaction_id = t.id
      WHERE a.type = 'expense'${dateFilter}
      GROUP BY a.id
      HAVING amount != 0
      ORDER BY a.code, a.name`
    )
    .all(...params) as { account_id: string; account_name: string; account_code: string | null; amount: number }[];

  const totalRevenue = revenueRows.reduce((sum, r) => sum + r.amount, 0);
  const totalExpenses = expenseRows.reduce((sum, r) => sum + r.amount, 0);

  return {
    revenue: revenueRows,
    expenses: expenseRows,
    total_revenue: Math.round(totalRevenue * 100) / 100,
    total_expenses: Math.round(totalExpenses * 100) / 100,
    net_income: Math.round((totalRevenue - totalExpenses) * 100) / 100,
  };
}
