import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-payroll-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createEmployee,
  getEmployee,
  listEmployees,
  updateEmployee,
  deleteEmployee,
  terminateEmployee,
  countEmployees,
  createPayPeriod,
  getPayPeriod,
  listPayPeriods,
  updatePayPeriodStatus,
  deletePayPeriod,
  createPayStub,
  getPayStub,
  listPayStubs,
  deletePayStub,
  createPayment,
  getPayment,
  listPayments,
  updatePaymentStatus,
  deletePayment,
  calculateDeductions,
  calculateGrossPay,
  processPayroll,
  getPayrollReport,
  getYtdReport,
  getTaxSummary,
} from "./payroll";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// --- Employee CRUD ---

describe("Employees", () => {
  test("create and get employee", () => {
    const emp = createEmployee({
      name: "Alice Johnson",
      email: "alice@example.com",
      pay_rate: 120000,
      pay_type: "salary",
      department: "Engineering",
      title: "Senior Developer",
      start_date: "2024-01-15",
    });

    expect(emp.id).toBeTruthy();
    expect(emp.name).toBe("Alice Johnson");
    expect(emp.email).toBe("alice@example.com");
    expect(emp.type).toBe("employee");
    expect(emp.status).toBe("active");
    expect(emp.pay_rate).toBe(120000);
    expect(emp.pay_type).toBe("salary");
    expect(emp.currency).toBe("USD");
    expect(emp.department).toBe("Engineering");

    const fetched = getEmployee(emp.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(emp.id);
    expect(fetched!.name).toBe("Alice Johnson");
  });

  test("create contractor", () => {
    const emp = createEmployee({
      name: "Bob Contractor",
      email: "bob@contractor.com",
      type: "contractor",
      pay_rate: 75,
      pay_type: "hourly",
    });

    expect(emp.type).toBe("contractor");
    expect(emp.pay_type).toBe("hourly");
    expect(emp.pay_rate).toBe(75);
  });

  test("list employees", () => {
    const all = listEmployees();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("list employees by status", () => {
    const active = listEmployees({ status: "active" });
    expect(active.length).toBeGreaterThanOrEqual(2);
    expect(active.every((e) => e.status === "active")).toBe(true);
  });

  test("list employees by department", () => {
    const engineering = listEmployees({ department: "Engineering" });
    expect(engineering.length).toBeGreaterThanOrEqual(1);
    expect(engineering.every((e) => e.department === "Engineering")).toBe(true);
  });

  test("search employees", () => {
    const results = listEmployees({ search: "Alice" });
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("Alice Johnson");
  });

  test("update employee", () => {
    const emp = createEmployee({ name: "Charlie Update", pay_rate: 80000 });
    const updated = updateEmployee(emp.id, {
      department: "Marketing",
      pay_rate: 85000,
    });

    expect(updated).toBeDefined();
    expect(updated!.department).toBe("Marketing");
    expect(updated!.pay_rate).toBe(85000);
  });

  test("terminate employee", () => {
    const emp = createEmployee({ name: "TerminateMe", pay_rate: 50000 });
    const terminated = terminateEmployee(emp.id, "2025-06-30");

    expect(terminated).toBeDefined();
    expect(terminated!.status).toBe("terminated");
    expect(terminated!.end_date).toBe("2025-06-30");
  });

  test("delete employee", () => {
    const emp = createEmployee({ name: "DeleteMe", pay_rate: 40000 });
    expect(deleteEmployee(emp.id)).toBe(true);
    expect(getEmployee(emp.id)).toBeNull();
  });

  test("count employees", () => {
    const count = countEmployees();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("get non-existent employee returns null", () => {
    expect(getEmployee("non-existent-id")).toBeNull();
  });

  test("update non-existent employee returns null", () => {
    expect(updateEmployee("non-existent-id", { name: "X" })).toBeNull();
  });
});

// --- Pay Period CRUD ---

describe("Pay Periods", () => {
  test("create and get pay period", () => {
    const period = createPayPeriod({
      start_date: "2025-01-01",
      end_date: "2025-01-15",
    });

    expect(period.id).toBeTruthy();
    expect(period.start_date).toBe("2025-01-01");
    expect(period.end_date).toBe("2025-01-15");
    expect(period.status).toBe("draft");

    const fetched = getPayPeriod(period.id);
    expect(fetched).toBeDefined();
    expect(fetched!.start_date).toBe("2025-01-01");
  });

  test("list pay periods", () => {
    createPayPeriod({ start_date: "2025-01-16", end_date: "2025-01-31" });
    const all = listPayPeriods();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("update pay period status", () => {
    const period = createPayPeriod({ start_date: "2025-02-01", end_date: "2025-02-15" });
    const updated = updatePayPeriodStatus(period.id, "completed");
    expect(updated).toBeDefined();
    expect(updated!.status).toBe("completed");
  });

  test("delete pay period", () => {
    const period = createPayPeriod({ start_date: "2025-03-01", end_date: "2025-03-15" });
    expect(deletePayPeriod(period.id)).toBe(true);
    expect(getPayPeriod(period.id)).toBeNull();
  });
});

// --- Pay Stub CRUD ---

describe("Pay Stubs", () => {
  test("create and get pay stub", () => {
    const emp = createEmployee({ name: "Stub Employee", pay_rate: 100000 });
    const period = createPayPeriod({ start_date: "2025-04-01", end_date: "2025-04-15" });

    const stub = createPayStub({
      employee_id: emp.id,
      pay_period_id: period.id,
      gross_pay: 4166.67,
      deductions: { federal_tax: 916.67, state_tax: 208.33 },
      net_pay: 3041.67,
      hours_worked: 80,
    });

    expect(stub.id).toBeTruthy();
    expect(stub.employee_id).toBe(emp.id);
    expect(stub.gross_pay).toBe(4166.67);
    expect(stub.deductions.federal_tax).toBe(916.67);
    expect(stub.net_pay).toBe(3041.67);
    expect(stub.hours_worked).toBe(80);

    const fetched = getPayStub(stub.id);
    expect(fetched).toBeDefined();
    expect(fetched!.gross_pay).toBe(4166.67);
  });

  test("list pay stubs by employee", () => {
    const emp = createEmployee({ name: "ListStub Employee", pay_rate: 80000 });
    const period = createPayPeriod({ start_date: "2025-05-01", end_date: "2025-05-15" });

    createPayStub({
      employee_id: emp.id,
      pay_period_id: period.id,
      gross_pay: 3333.33,
      net_pay: 2500,
    });

    const stubs = listPayStubs({ employee_id: emp.id });
    expect(stubs.length).toBe(1);
    expect(stubs[0].employee_id).toBe(emp.id);
  });

  test("delete pay stub", () => {
    const emp = createEmployee({ name: "DelStub", pay_rate: 60000 });
    const period = createPayPeriod({ start_date: "2025-06-01", end_date: "2025-06-15" });
    const stub = createPayStub({
      employee_id: emp.id,
      pay_period_id: period.id,
      gross_pay: 2500,
      net_pay: 2000,
    });

    expect(deletePayStub(stub.id)).toBe(true);
    expect(getPayStub(stub.id)).toBeNull();
  });
});

// --- Payment CRUD ---

describe("Payments", () => {
  test("create and get payment", () => {
    const emp = createEmployee({ name: "Payment Emp", pay_rate: 90000 });
    const period = createPayPeriod({ start_date: "2025-07-01", end_date: "2025-07-15" });
    const stub = createPayStub({
      employee_id: emp.id,
      pay_period_id: period.id,
      gross_pay: 3750,
      net_pay: 3000,
    });

    const payment = createPayment({
      pay_stub_id: stub.id,
      method: "direct_deposit",
      reference: "ACH-12345",
    });

    expect(payment.id).toBeTruthy();
    expect(payment.pay_stub_id).toBe(stub.id);
    expect(payment.method).toBe("direct_deposit");
    expect(payment.status).toBe("pending");
    expect(payment.reference).toBe("ACH-12345");

    const fetched = getPayment(payment.id);
    expect(fetched).toBeDefined();
    expect(fetched!.method).toBe("direct_deposit");
  });

  test("update payment status to paid", () => {
    const emp = createEmployee({ name: "PaidEmp", pay_rate: 70000 });
    const period = createPayPeriod({ start_date: "2025-08-01", end_date: "2025-08-15" });
    const stub = createPayStub({
      employee_id: emp.id,
      pay_period_id: period.id,
      gross_pay: 2916.67,
      net_pay: 2333.33,
    });
    const payment = createPayment({ pay_stub_id: stub.id });
    const updated = updatePaymentStatus(payment.id, "paid");

    expect(updated).toBeDefined();
    expect(updated!.status).toBe("paid");
    expect(updated!.paid_at).toBeTruthy();
  });

  test("delete payment", () => {
    const emp = createEmployee({ name: "DelPayEmp", pay_rate: 65000 });
    const period = createPayPeriod({ start_date: "2025-09-01", end_date: "2025-09-15" });
    const stub = createPayStub({
      employee_id: emp.id,
      pay_period_id: period.id,
      gross_pay: 2708.33,
      net_pay: 2166.67,
    });
    const payment = createPayment({ pay_stub_id: stub.id });

    expect(deletePayment(payment.id)).toBe(true);
    expect(getPayment(payment.id)).toBeNull();
  });
});

// --- Deduction Calculations ---

describe("Deduction Calculations", () => {
  test("calculate employee deductions", () => {
    const deductions = calculateDeductions(5000, "employee");

    expect(deductions.federal_tax).toBe(1100);     // 5000 * 0.22
    expect(deductions.state_tax).toBe(250);         // 5000 * 0.05
    expect(deductions.social_security).toBe(310);   // 5000 * 0.062
    expect(deductions.medicare).toBe(72.5);         // 5000 * 0.0145
  });

  test("calculate contractor deductions (no FICA)", () => {
    const deductions = calculateDeductions(5000, "contractor");

    expect(deductions.federal_tax).toBe(1100);
    expect(deductions.state_tax).toBe(250);
    expect(deductions.social_security).toBeUndefined();
    expect(deductions.medicare).toBeUndefined();
  });

  test("calculate deductions with custom rates", () => {
    const customRates = { federal_tax: 0.30, bonus_tax: 0.10 };
    const deductions = calculateDeductions(10000, "employee", customRates);

    expect(deductions.federal_tax).toBe(3000);
    expect(deductions.bonus_tax).toBe(1000);
  });
});

// --- Gross Pay Calculations ---

describe("Gross Pay Calculations", () => {
  test("calculate salary gross pay (semi-monthly)", () => {
    const emp = createEmployee({ name: "SalaryCalc", pay_rate: 120000, pay_type: "salary" });
    const gross = calculateGrossPay(emp);
    expect(gross).toBe(5000); // 120000 / 24
  });

  test("calculate hourly gross pay", () => {
    const emp = createEmployee({ name: "HourlyCalc", pay_rate: 50, pay_type: "hourly" });
    const gross = calculateGrossPay(emp, 80, 0);
    expect(gross).toBe(4000); // 80 * 50
  });

  test("calculate hourly gross pay with overtime", () => {
    const emp = createEmployee({ name: "OvertimeCalc", pay_rate: 40, pay_type: "hourly" });
    const gross = calculateGrossPay(emp, 80, 10);
    // 80 * 40 + 10 * 40 * 1.5 = 3200 + 600 = 3800
    expect(gross).toBe(3800);
  });
});

// --- Payroll Processing ---

describe("Payroll Processing", () => {
  test("process payroll generates stubs for active employees", () => {
    // Create fresh employees for this test
    const emp1 = createEmployee({ name: "Process Emp 1", pay_rate: 96000, pay_type: "salary" });
    const emp2 = createEmployee({ name: "Process Emp 2", pay_rate: 72000, pay_type: "salary" });

    const period = createPayPeriod({ start_date: "2025-10-01", end_date: "2025-10-15" });
    const stubs = processPayroll(period.id);

    // Should have stubs for at least these 2 employees (plus any other active ones from prior tests)
    expect(stubs.length).toBeGreaterThanOrEqual(2);

    // Verify period is now completed
    const updatedPeriod = getPayPeriod(period.id);
    expect(updatedPeriod!.status).toBe("completed");

    // Find our employees' stubs
    const stub1 = stubs.find((s) => s.employee_id === emp1.id);
    const stub2 = stubs.find((s) => s.employee_id === emp2.id);
    expect(stub1).toBeDefined();
    expect(stub2).toBeDefined();

    // Check gross pay calculation: 96000 / 24 = 4000
    expect(stub1!.gross_pay).toBe(4000);
    // 72000 / 24 = 3000
    expect(stub2!.gross_pay).toBe(3000);

    // Verify deductions were applied
    expect(stub1!.deductions.federal_tax).toBeTruthy();
    expect(stub1!.net_pay).toBeLessThan(stub1!.gross_pay);
  });

  test("process payroll with hours map for hourly employees", () => {
    const hourlyEmp = createEmployee({ name: "HourlyProcess", pay_rate: 50, pay_type: "hourly" });
    const period = createPayPeriod({ start_date: "2025-10-16", end_date: "2025-10-31" });

    const hoursMap = {
      [hourlyEmp.id]: { hours: 80, overtime: 5 },
    };

    const stubs = processPayroll(period.id, hoursMap);
    const hourlyStub = stubs.find((s) => s.employee_id === hourlyEmp.id);
    expect(hourlyStub).toBeDefined();
    // 80 * 50 + 5 * 50 * 1.5 = 4000 + 375 = 4375
    expect(hourlyStub!.gross_pay).toBe(4375);
    expect(hourlyStub!.overtime_hours).toBe(5);
  });

  test("process payroll skips terminated employees", () => {
    const emp = createEmployee({ name: "TermProcessEmp", pay_rate: 60000 });
    terminateEmployee(emp.id);

    const period = createPayPeriod({ start_date: "2025-11-01", end_date: "2025-11-15" });
    const stubs = processPayroll(period.id);

    const terminatedStub = stubs.find((s) => s.employee_id === emp.id);
    expect(terminatedStub).toBeUndefined();
  });

  test("process payroll fails on completed period", () => {
    const period = createPayPeriod({ start_date: "2025-11-16", end_date: "2025-11-30" });
    updatePayPeriodStatus(period.id, "completed");

    expect(() => processPayroll(period.id)).toThrow("already completed");
  });

  test("process payroll fails on non-existent period", () => {
    expect(() => processPayroll("non-existent-id")).toThrow("not found");
  });

  test("process payroll does not duplicate stubs on re-run", () => {
    const emp = createEmployee({ name: "NoDupEmp", pay_rate: 84000 });
    const period = createPayPeriod({ start_date: "2025-12-01", end_date: "2025-12-15" });

    // First run
    const firstStubs = processPayroll(period.id);
    const firstCount = firstStubs.filter((s) => s.employee_id === emp.id).length;
    expect(firstCount).toBe(1);

    // Reset period to draft for re-run
    updatePayPeriodStatus(period.id, "draft");
    const secondStubs = processPayroll(period.id);

    // Should not create a duplicate stub for the same employee+period
    const allStubs = listPayStubs({ employee_id: emp.id, pay_period_id: period.id });
    expect(allStubs.length).toBe(1);
  });
});

// --- Reports ---

describe("Reports", () => {
  test("get payroll report", () => {
    const emp = createEmployee({ name: "ReportEmp", pay_rate: 108000 });
    const period = createPayPeriod({ start_date: "2025-12-16", end_date: "2025-12-31" });
    processPayroll(period.id);

    const report = getPayrollReport(period.id);
    expect(report).toBeDefined();
    expect(report!.period.id).toBe(period.id);
    expect(report!.employee_count).toBeGreaterThanOrEqual(1);
    expect(report!.total_gross).toBeGreaterThan(0);
    expect(report!.total_deductions).toBeGreaterThan(0);
    expect(report!.total_net).toBeGreaterThan(0);
    expect(report!.total_net).toBeLessThan(report!.total_gross);
  });

  test("get payroll report for non-existent period returns null", () => {
    expect(getPayrollReport("non-existent")).toBeNull();
  });

  test("get YTD report", () => {
    const emp = createEmployee({ name: "YtdEmp", pay_rate: 96000 });
    const period = createPayPeriod({ start_date: "2025-01-01", end_date: "2025-01-15" });
    processPayroll(period.id);

    const ytd = getYtdReport(emp.id, 2025);
    expect(ytd).toBeDefined();
    expect(ytd!.employee.id).toBe(emp.id);
    expect(ytd!.year).toBe(2025);
    expect(ytd!.total_gross).toBeGreaterThan(0);
    expect(ytd!.total_net).toBeGreaterThan(0);
    expect(ytd!.pay_stubs_count).toBeGreaterThanOrEqual(1);
    expect(ytd!.total_deductions).toBeDefined();
    expect(ytd!.total_deductions.federal_tax).toBeGreaterThan(0);
  });

  test("get YTD report for non-existent employee returns null", () => {
    expect(getYtdReport("non-existent")).toBeNull();
  });

  test("get tax summary", () => {
    const summary = getTaxSummary(2025);
    expect(summary.length).toBeGreaterThanOrEqual(1);

    const entry = summary[0];
    expect(entry.employee_id).toBeTruthy();
    expect(entry.employee_name).toBeTruthy();
    expect(entry.total_gross).toBeGreaterThanOrEqual(0);
    expect(entry.total_federal_tax).toBeGreaterThanOrEqual(0);
    expect(entry.total_net).toBeGreaterThanOrEqual(0);
  });

  test("get tax summary for year with no data returns empty", () => {
    const summary = getTaxSummary(1990);
    expect(summary.length).toBe(0);
  });
});
