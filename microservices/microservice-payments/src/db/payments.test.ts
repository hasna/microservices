import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-payments-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createPayment,
  getPayment,
  listPayments,
  updatePayment,
  deletePayment,
  refundPayment,
  searchPayments,
  countPayments,
  listByProvider,
  getRevenueReport,
  getRevenueByCustomer,
  reconcileWithInvoice,
  getPaymentStats,
  getBalanceByProvider,
  createDispute,
  getDispute,
  listDisputes,
  respondDispute,
  deleteDispute,
  createPayout,
  getPayout,
  listPayouts,
  updatePayout,
  deletePayout,
} from "./payments";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// --- Payments ---

describe("Payments", () => {
  test("create and get payment", () => {
    const payment = createPayment({
      type: "charge",
      amount: 99.99,
      currency: "USD",
      customer_name: "Alice Smith",
      customer_email: "alice@example.com",
      description: "Monthly subscription",
      provider: "stripe",
    });

    expect(payment.id).toBeTruthy();
    expect(payment.type).toBe("charge");
    expect(payment.amount).toBe(99.99);
    expect(payment.currency).toBe("USD");
    expect(payment.status).toBe("pending");
    expect(payment.customer_name).toBe("Alice Smith");
    expect(payment.customer_email).toBe("alice@example.com");
    expect(payment.provider).toBe("stripe");

    const fetched = getPayment(payment.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(payment.id);
  });

  test("create payment with defaults", () => {
    const payment = createPayment({
      type: "charge",
      amount: 50,
    });

    expect(payment.currency).toBe("USD");
    expect(payment.status).toBe("pending");
    expect(payment.metadata).toEqual({});
  });

  test("create payment with metadata", () => {
    const payment = createPayment({
      type: "transfer",
      amount: 200,
      metadata: { reference: "TXN-001", source: "api" },
    });

    expect(payment.metadata).toEqual({ reference: "TXN-001", source: "api" });
  });

  test("list payments", () => {
    const all = listPayments();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  test("list payments with status filter", () => {
    createPayment({ type: "charge", amount: 10, status: "succeeded" });
    const succeeded = listPayments({ status: "succeeded" });
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    expect(succeeded.every((p) => p.status === "succeeded")).toBe(true);
  });

  test("list payments with type filter", () => {
    const transfers = listPayments({ type: "transfer" });
    expect(transfers.length).toBeGreaterThanOrEqual(1);
    expect(transfers.every((p) => p.type === "transfer")).toBe(true);
  });

  test("list payments with limit", () => {
    const limited = listPayments({ limit: 2 });
    expect(limited.length).toBeLessThanOrEqual(2);
  });

  test("update payment", () => {
    const payment = createPayment({ type: "charge", amount: 75 });
    const updated = updatePayment(payment.id, {
      status: "succeeded",
      description: "Updated description",
      completed_at: "2024-01-15 12:00:00",
    });

    expect(updated).toBeDefined();
    expect(updated!.status).toBe("succeeded");
    expect(updated!.description).toBe("Updated description");
    expect(updated!.completed_at).toBe("2024-01-15 12:00:00");
  });

  test("update nonexistent payment returns null", () => {
    const result = updatePayment("nonexistent-id", { status: "failed" });
    expect(result).toBeNull();
  });

  test("delete payment", () => {
    const payment = createPayment({ type: "charge", amount: 5 });
    expect(deletePayment(payment.id)).toBe(true);
    expect(getPayment(payment.id)).toBeNull();
  });

  test("delete nonexistent payment returns false", () => {
    expect(deletePayment("nonexistent-id")).toBe(false);
  });

  test("count payments", () => {
    const count = countPayments();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("search payments", () => {
    createPayment({
      type: "charge",
      amount: 150,
      customer_name: "SearchableCustomer",
      customer_email: "searchable@example.com",
      status: "succeeded",
    });

    const results = searchPayments("SearchableCustomer");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].customer_name).toBe("SearchableCustomer");
  });

  test("search by email", () => {
    const results = searchPayments("searchable@example.com");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("list by provider", () => {
    const stripePayments = listByProvider("stripe");
    expect(stripePayments.length).toBeGreaterThanOrEqual(1);
    expect(stripePayments.every((p) => p.provider === "stripe")).toBe(true);
  });
});

// --- Refunds ---

describe("Refunds", () => {
  test("refund a succeeded payment", () => {
    const payment = createPayment({
      type: "charge",
      amount: 100,
      status: "succeeded",
      customer_name: "Refund Test",
      customer_email: "refund@example.com",
      provider: "stripe",
    });

    const refund = refundPayment(payment.id);
    expect(refund).toBeDefined();
    expect(refund!.type).toBe("refund");
    expect(refund!.amount).toBe(100);
    expect(refund!.status).toBe("succeeded");
    expect(refund!.metadata).toHaveProperty("original_payment_id", payment.id);

    // Original should be marked refunded
    const original = getPayment(payment.id);
    expect(original!.status).toBe("refunded");
  });

  test("partial refund", () => {
    const payment = createPayment({
      type: "charge",
      amount: 200,
      status: "succeeded",
    });

    const refund = refundPayment(payment.id, 50);
    expect(refund).toBeDefined();
    expect(refund!.amount).toBe(50);
  });

  test("cannot refund non-succeeded payment", () => {
    const payment = createPayment({ type: "charge", amount: 30, status: "pending" });
    const refund = refundPayment(payment.id);
    expect(refund).toBeNull();
  });

  test("cannot refund nonexistent payment", () => {
    const refund = refundPayment("nonexistent-id");
    expect(refund).toBeNull();
  });
});

// --- Revenue & Analytics ---

describe("Revenue Reports", () => {
  test("revenue report for date range", () => {
    // Create some succeeded charges and refunds
    createPayment({
      type: "charge",
      amount: 500,
      status: "succeeded",
      customer_email: "rev@example.com",
    });
    createPayment({
      type: "charge",
      amount: 300,
      status: "succeeded",
      customer_email: "rev2@example.com",
    });

    const report = getRevenueReport("2000-01-01", "2099-12-31");
    expect(report.total_revenue).toBeGreaterThan(0);
    expect(report.net_revenue).toBeDefined();
    expect(report.payment_count).toBeGreaterThan(0);
    expect(report.currency).toBe("USD");
  });

  test("revenue by customer", () => {
    const revenue = getRevenueByCustomer();
    expect(revenue.length).toBeGreaterThan(0);
    expect(revenue[0]).toHaveProperty("customer_email");
    expect(revenue[0]).toHaveProperty("total_amount");
    expect(revenue[0]).toHaveProperty("payment_count");
  });

  test("payment stats", () => {
    const stats = getPaymentStats();
    expect(stats.total_payments).toBeGreaterThan(0);
    expect(stats.total_charges).toBeGreaterThan(0);
    expect(stats).toHaveProperty("by_status");
    expect(stats).toHaveProperty("by_provider");
    expect(stats.total_amount).toBeGreaterThan(0);
  });

  test("balance by provider", () => {
    // Ensure a succeeded Stripe charge exists for this test
    createPayment({ type: "charge", amount: 250, status: "succeeded", provider: "stripe" });

    const balances = getBalanceByProvider();
    expect(balances.length).toBeGreaterThan(0);
    const stripe = balances.find((b) => b.provider === "stripe");
    expect(stripe).toBeDefined();
    expect(stripe!.total_charges).toBeGreaterThan(0);
    expect(stripe!).toHaveProperty("net_balance");
  });

  test("reconcile payment with invoice", () => {
    const payment = createPayment({ type: "charge", amount: 80, status: "succeeded" });
    const reconciled = reconcileWithInvoice(payment.id, "INV-001");
    expect(reconciled).toBeDefined();
    expect(reconciled!.invoice_id).toBe("INV-001");
  });

  test("reconcile nonexistent payment returns null", () => {
    const result = reconcileWithInvoice("nonexistent-id", "INV-999");
    expect(result).toBeNull();
  });
});

// --- Disputes ---

describe("Disputes", () => {
  test("create and get dispute", () => {
    const payment = createPayment({ type: "charge", amount: 100, status: "succeeded" });
    const dispute = createDispute({
      payment_id: payment.id,
      reason: "Unauthorized charge",
      amount: 100,
    });

    expect(dispute.id).toBeTruthy();
    expect(dispute.payment_id).toBe(payment.id);
    expect(dispute.reason).toBe("Unauthorized charge");
    expect(dispute.status).toBe("open");
    expect(dispute.amount).toBe(100);

    // Payment should be marked as disputed
    const updatedPayment = getPayment(payment.id);
    expect(updatedPayment!.status).toBe("disputed");

    const fetched = getDispute(dispute.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(dispute.id);
  });

  test("list disputes", () => {
    const disputes = listDisputes();
    expect(disputes.length).toBeGreaterThanOrEqual(1);
  });

  test("list disputes with status filter", () => {
    const openDisputes = listDisputes("open");
    expect(openDisputes.every((d) => d.status === "open")).toBe(true);
  });

  test("respond to dispute", () => {
    const payment = createPayment({ type: "charge", amount: 50, status: "succeeded" });
    const dispute = createDispute({ payment_id: payment.id, reason: "Fraud" });

    const responded = respondDispute(dispute.id, { status: "won" });
    expect(responded).toBeDefined();
    expect(responded!.status).toBe("won");
    expect(responded!.resolved_at).toBeTruthy();
  });

  test("respond to nonexistent dispute returns null", () => {
    const result = respondDispute("nonexistent-id", { status: "lost" });
    expect(result).toBeNull();
  });

  test("delete dispute", () => {
    const payment = createPayment({ type: "charge", amount: 25, status: "succeeded" });
    const dispute = createDispute({ payment_id: payment.id });
    expect(deleteDispute(dispute.id)).toBe(true);
    expect(getDispute(dispute.id)).toBeNull();
  });
});

// --- Payouts ---

describe("Payouts", () => {
  test("create and get payout", () => {
    const payout = createPayout({
      amount: 1000,
      currency: "USD",
      destination: "bank_acct_123",
    });

    expect(payout.id).toBeTruthy();
    expect(payout.amount).toBe(1000);
    expect(payout.currency).toBe("USD");
    expect(payout.destination).toBe("bank_acct_123");
    expect(payout.status).toBe("pending");

    const fetched = getPayout(payout.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(payout.id);
  });

  test("list payouts", () => {
    const payouts = listPayouts();
    expect(payouts.length).toBeGreaterThanOrEqual(1);
  });

  test("list payouts with status filter", () => {
    const pending = listPayouts("pending");
    expect(pending.every((p) => p.status === "pending")).toBe(true);
  });

  test("update payout status", () => {
    const payout = createPayout({ amount: 500 });
    const updated = updatePayout(payout.id, {
      status: "paid",
      arrived_at: "2024-01-20 14:00:00",
    });

    expect(updated).toBeDefined();
    expect(updated!.status).toBe("paid");
    expect(updated!.arrived_at).toBe("2024-01-20 14:00:00");
  });

  test("update nonexistent payout returns null", () => {
    const result = updatePayout("nonexistent-id", { status: "failed" });
    expect(result).toBeNull();
  });

  test("delete payout", () => {
    const payout = createPayout({ amount: 10 });
    expect(deletePayout(payout.id)).toBe(true);
    expect(getPayout(payout.id)).toBeNull();
  });

  test("delete nonexistent payout returns false", () => {
    expect(deletePayout("nonexistent-id")).toBe(false);
  });
});
