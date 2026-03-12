import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempDir = mkdtempSync(join(tmpdir(), "microservice-expenses-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createExpense,
  getExpense,
  listExpenses,
  updateExpense,
  deleteExpense,
  getExpenseSummary,
  createCategory,
  listCategories,
  deleteCategory,
} from "./expenses";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Expenses", () => {
  test("create and get expense", () => {
    const expense = createExpense({
      amount: 42.5,
      description: "Office supplies",
      vendor: "Staples",
      category: "office",
      tags: ["supplies", "monthly"],
    });

    expect(expense.id).toBeTruthy();
    expect(expense.amount).toBe(42.5);
    expect(expense.currency).toBe("USD");
    expect(expense.description).toBe("Office supplies");
    expect(expense.vendor).toBe("Staples");
    expect(expense.category).toBe("office");
    expect(expense.status).toBe("pending");
    expect(expense.tags).toEqual(["supplies", "monthly"]);

    const fetched = getExpense(expense.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(expense.id);
  });

  test("create expense with custom currency and date", () => {
    const expense = createExpense({
      amount: 100,
      currency: "EUR",
      date: "2025-06-15",
    });

    expect(expense.currency).toBe("EUR");
    expect(expense.date).toBe("2025-06-15");
  });

  test("list expenses", () => {
    const all = listExpenses();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("list expenses with category filter", () => {
    createExpense({ amount: 10, category: "travel" });
    createExpense({ amount: 20, category: "travel" });
    createExpense({ amount: 30, category: "food" });

    const travel = listExpenses({ category: "travel" });
    expect(travel.every((e) => e.category === "travel")).toBe(true);
    expect(travel.length).toBeGreaterThanOrEqual(2);
  });

  test("list expenses with status filter", () => {
    createExpense({ amount: 5, status: "approved" });

    const approved = listExpenses({ status: "approved" });
    expect(approved.every((e) => e.status === "approved")).toBe(true);
    expect(approved.length).toBeGreaterThanOrEqual(1);
  });

  test("list expenses with date range filter", () => {
    createExpense({ amount: 50, date: "2025-01-15" });
    createExpense({ amount: 60, date: "2025-03-20" });

    const results = listExpenses({
      from_date: "2025-01-01",
      to_date: "2025-02-28",
    });
    expect(results.every((e) => e.date >= "2025-01-01" && e.date <= "2025-02-28")).toBe(true);
  });

  test("list expenses with vendor filter", () => {
    createExpense({ amount: 15, vendor: "Amazon" });

    const results = listExpenses({ vendor: "Amazon" });
    expect(results.every((e) => e.vendor === "Amazon")).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("list expenses with limit", () => {
    const results = listExpenses({ limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("update expense", () => {
    const expense = createExpense({ amount: 100, description: "Original" });
    const updated = updateExpense(expense.id, {
      amount: 150,
      description: "Updated",
      status: "approved",
    });

    expect(updated).toBeDefined();
    expect(updated!.amount).toBe(150);
    expect(updated!.description).toBe("Updated");
    expect(updated!.status).toBe("approved");
  });

  test("update expense tags", () => {
    const expense = createExpense({ amount: 25, tags: ["old"] });
    const updated = updateExpense(expense.id, { tags: ["new", "updated"] });

    expect(updated!.tags).toEqual(["new", "updated"]);
  });

  test("update non-existent expense returns null", () => {
    const result = updateExpense("non-existent-id", { amount: 999 });
    expect(result).toBeNull();
  });

  test("delete expense", () => {
    const expense = createExpense({ amount: 1, description: "DeleteMe" });
    expect(deleteExpense(expense.id)).toBe(true);
    expect(getExpense(expense.id)).toBeNull();
  });

  test("delete non-existent expense returns false", () => {
    expect(deleteExpense("non-existent-id")).toBe(false);
  });

  test("expense summary", () => {
    const summary = getExpenseSummary();
    expect(summary.total_expenses).toBeGreaterThan(0);
    expect(typeof summary.pending).toBe("number");
    expect(typeof summary.approved).toBe("number");
    expect(typeof summary.rejected).toBe("number");
    expect(typeof summary.reimbursed).toBe("number");
    expect(typeof summary.total_amount).toBe("number");
    expect(Array.isArray(summary.by_category)).toBe(true);
    expect(Array.isArray(summary.by_month)).toBe(true);
  });

  test("expense summary by category has totals", () => {
    const summary = getExpenseSummary();
    for (const cat of summary.by_category) {
      expect(typeof cat.total).toBe("number");
      expect(typeof cat.count).toBe("number");
    }
  });
});

describe("Categories", () => {
  test("create category", () => {
    const category = createCategory({
      name: "Travel",
      budget_limit: 5000,
    });

    expect(category.id).toBeTruthy();
    expect(category.name).toBe("Travel");
    expect(category.budget_limit).toBe(5000);
    expect(category.parent_id).toBeNull();
  });

  test("create subcategory with parent", () => {
    const parent = createCategory({ name: "Equipment" });
    const child = createCategory({
      name: "Laptops",
      parent_id: parent.id,
      budget_limit: 3000,
    });

    expect(child.parent_id).toBe(parent.id);
  });

  test("list categories", () => {
    const categories = listCategories();
    expect(categories.length).toBeGreaterThanOrEqual(2);
  });

  test("delete category", () => {
    const category = createCategory({ name: "DeleteMe" });
    expect(deleteCategory(category.id)).toBe(true);

    const categories = listCategories();
    expect(categories.find((c) => c.id === category.id)).toBeUndefined();
  });

  test("delete non-existent category returns false", () => {
    expect(deleteCategory("non-existent-id")).toBe(false);
  });
});
