import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempDir = mkdtempSync(join(tmpdir(), "microservice-company-finance-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import { createOrg } from "../db/company";
import { closeDatabase } from "../db/database";
import {
  createPeriod,
  getPeriod,
  listPeriods,
  closePeriod,
  generatePnl,
  generateCashflow,
  setBudget,
  getBudget,
  listBudgets,
  getBudgetVsActual,
} from "./finance";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// Create a shared org for all tests
const org = createOrg({ name: "Finance Test Corp" });

describe("Financial Periods", () => {
  test("create a financial period", () => {
    const period = createPeriod(org.id, "January 2025", "month", "2025-01-01", "2025-01-31");

    expect(period.id).toBeTruthy();
    expect(period.org_id).toBe(org.id);
    expect(period.name).toBe("January 2025");
    expect(period.type).toBe("month");
    expect(period.start_date).toBe("2025-01-01");
    expect(period.end_date).toBe("2025-01-31");
    expect(period.status).toBe("open");
    expect(period.revenue).toBe(0);
    expect(period.expenses).toBe(0);
    expect(period.net_income).toBe(0);
    expect(period.closed_at).toBeNull();
  });

  test("get a period by ID", () => {
    const created = createPeriod(org.id, "Feb 2025", "month", "2025-02-01", "2025-02-28");
    const fetched = getPeriod(created.id);

    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.name).toBe("Feb 2025");
  });

  test("get non-existent period returns null", () => {
    const result = getPeriod("non-existent-id");
    expect(result).toBeNull();
  });

  test("list periods by org", () => {
    const periods = listPeriods(org.id);
    expect(periods.length).toBeGreaterThanOrEqual(2);
    // Should be ordered by start_date DESC
    for (let i = 1; i < periods.length; i++) {
      expect(periods[i - 1].start_date >= periods[i].start_date).toBe(true);
    }
  });

  test("list periods filtered by type", () => {
    createPeriod(org.id, "Q1 2025", "quarter", "2025-01-01", "2025-03-31");
    const quarters = listPeriods(org.id, "quarter");
    expect(quarters.length).toBeGreaterThanOrEqual(1);
    for (const p of quarters) {
      expect(p.type).toBe("quarter");
    }
  });

  test("close a period with financials", () => {
    const period = createPeriod(org.id, "March 2025", "month", "2025-03-01", "2025-03-31");
    const closed = closePeriod(period.id, 50000, 30000);

    expect(closed).toBeDefined();
    expect(closed!.status).toBe("closed");
    expect(closed!.revenue).toBe(50000);
    expect(closed!.expenses).toBe(30000);
    expect(closed!.net_income).toBe(20000);
    expect(closed!.closed_at).toBeTruthy();
    expect(closed!.breakdown).toEqual({
      revenue_snapshot: 50000,
      expenses_snapshot: 30000,
      closed_by: "system",
    });
  });

  test("close non-existent period returns null", () => {
    const result = closePeriod("fake-id", 100, 50);
    expect(result).toBeNull();
  });
});

describe("P&L Report", () => {
  test("generate PnL from closed periods", () => {
    // Create and close two periods within range
    const p1 = createPeriod(org.id, "PnL-Apr", "month", "2025-04-01", "2025-04-30");
    closePeriod(p1.id, 10000, 6000);
    const p2 = createPeriod(org.id, "PnL-May", "month", "2025-05-01", "2025-05-31");
    closePeriod(p2.id, 15000, 8000);

    const report = generatePnl(org.id, "2025-04-01", "2025-05-31");
    expect(report.revenue).toBe(25000);
    expect(report.expenses).toBe(14000);
    expect(report.net_income).toBe(11000);
    expect(report.breakdown_by_service["PnL-Apr"]).toEqual({ revenue: 10000, expenses: 6000 });
    expect(report.breakdown_by_service["PnL-May"]).toEqual({ revenue: 15000, expenses: 8000 });
  });

  test("PnL excludes open periods", () => {
    createPeriod(org.id, "PnL-Open", "month", "2025-06-01", "2025-06-30");
    // Not closed, so should not appear

    const report = generatePnl(org.id, "2025-06-01", "2025-06-30");
    expect(report.revenue).toBe(0);
    expect(report.expenses).toBe(0);
    expect(report.net_income).toBe(0);
    expect(Object.keys(report.breakdown_by_service)).toHaveLength(0);
  });

  test("PnL for empty date range returns zeros", () => {
    const report = generatePnl(org.id, "2030-01-01", "2030-12-31");
    expect(report.revenue).toBe(0);
    expect(report.expenses).toBe(0);
    expect(report.net_income).toBe(0);
  });
});

describe("Cashflow Report", () => {
  test("generate cashflow from all periods in range", () => {
    // Uses the periods created above (closed ones have revenue/expenses set)
    const report = generateCashflow(org.id, "2025-04-01", "2025-05-31");
    expect(report.cash_in).toBe(25000);
    expect(report.cash_out).toBe(14000);
    expect(report.net_cashflow).toBe(11000);
  });

  test("cashflow for empty range returns zeros", () => {
    const report = generateCashflow(org.id, "2030-01-01", "2030-12-31");
    expect(report.cash_in).toBe(0);
    expect(report.cash_out).toBe(0);
    expect(report.net_cashflow).toBe(0);
  });
});

describe("Budgets", () => {
  test("set a budget for a department", () => {
    const budget = setBudget(org.id, "Engineering", 50000);
    expect(budget.id).toBeTruthy();
    expect(budget.org_id).toBe(org.id);
    expect(budget.department).toBe("Engineering");
    expect(budget.monthly_amount).toBe(50000);
    expect(budget.currency).toBe("USD");
  });

  test("get a budget by ID", () => {
    const created = setBudget(org.id, "Marketing", 20000);
    const fetched = getBudget(created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.department).toBe("Marketing");
  });

  test("update existing budget via setBudget (upsert)", () => {
    setBudget(org.id, "Engineering", 55000);
    const budgets = listBudgets(org.id);
    const eng = budgets.filter((b) => b.department === "Engineering");
    // Should be exactly one budget for Engineering (upserted, not duplicated)
    expect(eng.length).toBe(1);
    expect(eng[0].monthly_amount).toBe(55000);
  });

  test("list budgets for an org", () => {
    const budgets = listBudgets(org.id);
    expect(budgets.length).toBeGreaterThanOrEqual(2);
    // Should be ordered by department
    for (let i = 1; i < budgets.length; i++) {
      expect(budgets[i - 1].department <= budgets[i].department).toBe(true);
    }
  });

  test("budget vs actual with no matching periods", () => {
    setBudget(org.id, "Sales", 30000);
    const result = getBudgetVsActual(org.id, "Sales", "2025-07");
    expect(result).toBeDefined();
    expect(result!.department).toBe("Sales");
    expect(result!.budget).toBe(30000);
    expect(result!.actual).toBe(0);
    expect(result!.variance).toBe(30000);
    expect(result!.variance_pct).toBe(100);
  });

  test("budget vs actual returns null for unknown department", () => {
    const result = getBudgetVsActual(org.id, "NonExistent", "2025-07");
    expect(result).toBeNull();
  });
});
