import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempDir = mkdtempSync(join(tmpdir(), "microservice-bookkeeping-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createAccount,
  getAccount,
  listAccounts,
  updateAccount,
  deleteAccount,
  createTransaction,
  getTransaction,
  listTransactions,
  deleteTransaction,
  getTrialBalance,
  getAccountBalance,
  getIncomeStatement,
} from "./bookkeeping";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// --- Accounts ---

describe("Accounts", () => {
  test("create and get account", () => {
    const account = createAccount({
      name: "Cash",
      type: "asset",
      code: "1000",
      description: "Cash on hand",
    });

    expect(account.id).toBeTruthy();
    expect(account.name).toBe("Cash");
    expect(account.type).toBe("asset");
    expect(account.code).toBe("1000");
    expect(account.balance).toBe(0);
    expect(account.currency).toBe("USD");

    const fetched = getAccount(account.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(account.id);
  });

  test("get account by code", () => {
    const fetched = getAccount("1000");
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Cash");
  });

  test("list accounts by type", () => {
    createAccount({ name: "Bank", type: "asset", code: "1010" });
    createAccount({ name: "Accounts Payable", type: "liability", code: "2000" });

    const assets = listAccounts({ type: "asset" });
    expect(assets.length).toBeGreaterThanOrEqual(2);
    expect(assets.every((a) => a.type === "asset")).toBe(true);

    const liabilities = listAccounts({ type: "liability" });
    expect(liabilities.length).toBeGreaterThanOrEqual(1);
  });

  test("update account", () => {
    const account = createAccount({ name: "Temp", type: "asset" });
    const updated = updateAccount(account.id, {
      name: "Updated Account",
      description: "New description",
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Updated Account");
    expect(updated!.description).toBe("New description");
  });

  test("delete account without entries", () => {
    const account = createAccount({ name: "DeleteMe", type: "asset" });
    expect(deleteAccount(account.id)).toBe(true);
    expect(getAccount(account.id)).toBeNull();
  });

  test("search accounts", () => {
    const results = listAccounts({ search: "Cash" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe("Cash");
  });
});

// --- Transactions (Double-Entry) ---

describe("Transactions", () => {
  let cashId: string;
  let revenueId: string;
  let expenseId: string;
  let apId: string;

  test("setup accounts for transactions", () => {
    // Use existing Cash (1000) and AP (2000)
    const cash = getAccount("1000")!;
    cashId = cash.id;

    const ap = getAccount("2000")!;
    apId = ap.id;

    const revenue = createAccount({ name: "Sales Revenue", type: "revenue", code: "4000" });
    revenueId = revenue.id;

    const expense = createAccount({ name: "Office Supplies", type: "expense", code: "5000" });
    expenseId = expense.id;
  });

  test("reject unbalanced transaction", () => {
    expect(() =>
      createTransaction({
        description: "Unbalanced",
        entries: [
          { account_id: cashId, debit: 100 },
          { account_id: revenueId, credit: 50 },
        ],
      })
    ).toThrow("does not balance");
  });

  test("reject transaction with fewer than 2 entries", () => {
    expect(() =>
      createTransaction({
        description: "Single entry",
        entries: [{ account_id: cashId, debit: 100 }],
      })
    ).toThrow("at least two entries");
  });

  test("reject transaction with zero amounts", () => {
    expect(() =>
      createTransaction({
        description: "Zero",
        entries: [
          { account_id: cashId, debit: 0 },
          { account_id: revenueId, credit: 0 },
        ],
      })
    ).toThrow("at least one debit and one credit");
  });

  test("create balanced transaction — record revenue", () => {
    const txn = createTransaction({
      description: "Invoice payment received",
      date: "2024-01-15",
      reference: "INV-001",
      entries: [
        { account_id: cashId, debit: 1000, description: "Cash received" },
        { account_id: revenueId, credit: 1000, description: "Service revenue" },
      ],
    });

    expect(txn.id).toBeTruthy();
    expect(txn.description).toBe("Invoice payment received");
    expect(txn.date).toBe("2024-01-15");
    expect(txn.reference).toBe("INV-001");
    expect(txn.entries.length).toBe(2);

    // Verify balances updated correctly
    const cashBalance = getAccount(cashId)!;
    expect(cashBalance.balance).toBe(1000); // asset: debit increases

    const revenueBalance = getAccount(revenueId)!;
    expect(revenueBalance.balance).toBe(1000); // revenue: credit increases
  });

  test("create balanced transaction — record expense", () => {
    const txn = createTransaction({
      description: "Office supplies purchase",
      date: "2024-01-20",
      reference: "EXP-001",
      entries: [
        { account_id: expenseId, debit: 200 },
        { account_id: cashId, credit: 200 },
      ],
    });

    expect(txn.entries.length).toBe(2);

    // Cash should now be 1000 - 200 = 800
    const cashBalance = getAccount(cashId)!;
    expect(cashBalance.balance).toBe(800);

    // Expense should be 200
    const expenseBalance = getAccount(expenseId)!;
    expect(expenseBalance.balance).toBe(200);
  });

  test("get transaction by ID", () => {
    const txn = createTransaction({
      description: "Test get",
      entries: [
        { account_id: cashId, debit: 50 },
        { account_id: revenueId, credit: 50 },
      ],
    });

    const fetched = getTransaction(txn.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(txn.id);
    expect(fetched!.entries.length).toBe(2);
  });

  test("get transaction by reference", () => {
    const fetched = getTransaction("INV-001");
    expect(fetched).toBeDefined();
    expect(fetched!.reference).toBe("INV-001");
  });

  test("list transactions with date range", () => {
    const results = listTransactions({
      from_date: "2024-01-01",
      to_date: "2024-01-31",
    });
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  test("list transactions by account", () => {
    const results = listTransactions({ account_id: expenseId });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(
      results.every((t) => t.entries.some((e) => e.account_id === expenseId))
    ).toBe(true);
  });

  test("delete transaction reverses balances", () => {
    const cashBefore = getAccount(cashId)!.balance;
    const revenueBefore = getAccount(revenueId)!.balance;

    const txn = createTransaction({
      description: "To be deleted",
      entries: [
        { account_id: cashId, debit: 300 },
        { account_id: revenueId, credit: 300 },
      ],
    });

    // Verify balances changed
    expect(getAccount(cashId)!.balance).toBe(cashBefore + 300);
    expect(getAccount(revenueId)!.balance).toBe(revenueBefore + 300);

    // Delete
    expect(deleteTransaction(txn.id)).toBe(true);

    // Verify balances restored
    expect(getAccount(cashId)!.balance).toBe(cashBefore);
    expect(getAccount(revenueId)!.balance).toBe(revenueBefore);

    // Transaction should be gone
    expect(getTransaction(txn.id)).toBeNull();
  });

  test("cannot delete account with entries", () => {
    expect(() => deleteAccount(cashId)).toThrow("existing transaction entries");
  });
});

// --- Reports ---

describe("Reports", () => {
  test("trial balance is balanced", () => {
    const tb = getTrialBalance();
    expect(tb.balanced).toBe(true);
    expect(tb.total_debits).toBe(tb.total_credits);
    expect(tb.entries.length).toBeGreaterThan(0);
  });

  test("account balance details", () => {
    const cash = getAccount("1000")!;
    const result = getAccountBalance(cash.id);
    expect(result).toBeDefined();
    expect(result!.account.id).toBe(cash.id);
    expect(result!.total_debits).toBeGreaterThan(0);
    expect(result!.balance).toBe(cash.balance);
  });

  test("account balance returns null for missing account", () => {
    const result = getAccountBalance("nonexistent");
    expect(result).toBeNull();
  });

  test("income statement", () => {
    const is_ = getIncomeStatement();
    expect(is_.total_revenue).toBeGreaterThan(0);
    expect(is_.total_expenses).toBeGreaterThan(0);
    expect(is_.net_income).toBe(is_.total_revenue - is_.total_expenses);
    expect(is_.revenue.length).toBeGreaterThan(0);
    expect(is_.expenses.length).toBeGreaterThan(0);
  });

  test("income statement with date filter", () => {
    const is_ = getIncomeStatement({
      from_date: "2024-01-01",
      to_date: "2024-01-31",
    });
    expect(is_.total_revenue).toBeGreaterThan(0);
    expect(is_.net_income).toBe(is_.total_revenue - is_.total_expenses);
  });

  test("double-entry invariant: all transactions balance", () => {
    const transactions = listTransactions();
    for (const txn of transactions) {
      let totalDebits = 0;
      let totalCredits = 0;
      for (const entry of txn.entries) {
        totalDebits += entry.debit;
        totalCredits += entry.credit;
      }
      totalDebits = Math.round(totalDebits * 100) / 100;
      totalCredits = Math.round(totalCredits * 100) / 100;
      expect(totalDebits).toBe(totalCredits);
    }
  });
});
