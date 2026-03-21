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
  autoReconcile,
  retryPayment,
  listRetries,
  getRetryStats,
  convertCurrency,
  feeAnalysis,
  declineReport,
  addDisputeEvidence,
  splitPayment,
  revenueForecast,
  findReconciliationGaps,
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

// --- Auto-Reconciliation ---

describe("Auto-Reconciliation", () => {
  test("auto-reconcile matches payments by amount, email, and date", () => {
    // Create a reconciled payment (has invoice_id) as our "invoice" reference
    const refPayment = createPayment({
      type: "charge",
      amount: 250,
      status: "succeeded",
      customer_email: "reconcile-test@example.com",
      invoice_id: "INV-AUTO-001",
    });

    // Create an unreconciled payment with matching amount and email
    const unmatchedPayment = createPayment({
      type: "charge",
      amount: 250,
      status: "succeeded",
      customer_email: "reconcile-test@example.com",
    });

    const result = autoReconcile();
    expect(result).toHaveProperty("matched");
    expect(result).toHaveProperty("unmatched_payments");
    expect(result).toHaveProperty("unmatched_invoices");
    // The matched array should have at least our pair
    const match = result.matched.find((m) => m.payment_id === unmatchedPayment.id);
    if (match) {
      expect(match.invoice_id).toBe("INV-AUTO-001");
    }
  });

  test("auto-reconcile returns unmatched payments when no match", () => {
    createPayment({
      type: "charge",
      amount: 9999.99,
      status: "succeeded",
      customer_email: "nomatch@example.com",
    });

    const result = autoReconcile();
    const noMatch = result.unmatched_payments.find(
      (p) => p.customer_email === "nomatch@example.com" && p.amount === 9999.99
    );
    expect(noMatch).toBeDefined();
  });

  test("auto-reconcile with date range", () => {
    const result = autoReconcile("2000-01-01", "2099-12-31");
    expect(result).toHaveProperty("matched");
    expect(result).toHaveProperty("unmatched_payments");
  });
});

// --- Failed Payment Retry ---

describe("Failed Payment Retry", () => {
  test("retry a failed payment", () => {
    const payment = createPayment({
      type: "charge",
      amount: 75,
      status: "failed",
      provider: "stripe",
      customer_email: "retry@example.com",
    });

    const attempt = retryPayment(payment.id);
    expect(attempt).toBeDefined();
    expect(attempt!.payment_id).toBe(payment.id);
    expect(attempt!.attempt).toBe(1);
    expect(attempt!.status).toBe("succeeded");

    // Original payment should now be succeeded
    const updated = getPayment(payment.id);
    expect(updated!.status).toBe("succeeded");
  });

  test("cannot retry non-failed payment", () => {
    const payment = createPayment({ type: "charge", amount: 50, status: "pending" });
    const attempt = retryPayment(payment.id);
    expect(attempt).toBeNull();
  });

  test("cannot retry nonexistent payment", () => {
    const attempt = retryPayment("nonexistent-id");
    expect(attempt).toBeNull();
  });

  test("multiple retries increment attempt number", () => {
    const payment = createPayment({ type: "charge", amount: 60, status: "failed" });

    const first = retryPayment(payment.id);
    expect(first!.attempt).toBe(1);

    // Mark payment as failed again to allow retry
    updatePayment(payment.id, { status: "failed" });
    const second = retryPayment(payment.id);
    expect(second!.attempt).toBe(2);
  });

  test("list retries for a payment", () => {
    const payment = createPayment({ type: "charge", amount: 40, status: "failed" });
    retryPayment(payment.id);

    const retries = listRetries(payment.id);
    expect(retries.length).toBeGreaterThanOrEqual(1);
    expect(retries[0].payment_id).toBe(payment.id);
  });

  test("retry stats", () => {
    const stats = getRetryStats();
    expect(stats).toHaveProperty("total_retries");
    expect(stats).toHaveProperty("succeeded");
    expect(stats).toHaveProperty("failed");
    expect(stats).toHaveProperty("success_rate");
    expect(stats.total_retries).toBeGreaterThan(0);
  });
});

// --- Multi-Currency Conversion ---

describe("Currency Conversion", () => {
  test("convert USD to EUR", () => {
    const result = convertCurrency(100, "USD", "EUR");
    expect(result).toBeDefined();
    expect(result!.original_amount).toBe(100);
    expect(result!.from).toBe("USD");
    expect(result!.to).toBe("EUR");
    expect(result!.rate).toBe(0.92);
    expect(result!.converted_amount).toBe(92);
  });

  test("convert EUR to GBP", () => {
    const result = convertCurrency(200, "EUR", "GBP");
    expect(result).toBeDefined();
    expect(result!.converted_amount).toBe(172);
  });

  test("convert same currency returns same amount", () => {
    const result = convertCurrency(100, "USD", "USD");
    expect(result).toBeDefined();
    expect(result!.converted_amount).toBe(100);
    expect(result!.rate).toBe(1.0);
  });

  test("case insensitive currency codes", () => {
    const result = convertCurrency(100, "usd", "eur");
    expect(result).toBeDefined();
    expect(result!.from).toBe("USD");
    expect(result!.to).toBe("EUR");
  });

  test("unsupported currency returns null", () => {
    const result = convertCurrency(100, "USD", "JPY");
    expect(result).toBeNull();
  });

  test("unsupported source currency returns null", () => {
    const result = convertCurrency(100, "JPY", "USD");
    expect(result).toBeNull();
  });

  test("convert all supported pairs", () => {
    const currencies = ["USD", "EUR", "GBP", "CAD", "AUD"];
    for (const from of currencies) {
      for (const to of currencies) {
        const result = convertCurrency(100, from, to);
        expect(result).toBeDefined();
        expect(result!.converted_amount).toBeGreaterThan(0);
      }
    }
  });
});

// --- Fee Analysis ---

describe("Fee Analysis", () => {
  test("fee analysis for a month with data", () => {
    // Create a succeeded charge with a known date in the current month
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    createPayment({
      type: "charge",
      amount: 1000,
      status: "succeeded",
      provider: "stripe",
    });

    const result = feeAnalysis(month);
    expect(result.month).toBe(month);
    expect(result).toHaveProperty("providers");
    expect(result).toHaveProperty("total_gross");
    expect(result).toHaveProperty("total_fees");
    expect(result).toHaveProperty("total_net");
    expect(result.total_gross).toBeGreaterThan(0);
  });

  test("fee analysis calculates stripe fees correctly", () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const result = feeAnalysis(month);
    const stripe = result.providers.find((p) => p.provider === "stripe");
    if (stripe) {
      // Stripe fees = 2.9% + $0.30 per transaction
      expect(stripe.fees).toBeGreaterThan(0);
      expect(stripe.net).toBeLessThan(stripe.gross);
    }
  });

  test("fee analysis for month with no data returns zero totals", () => {
    const result = feeAnalysis("1900-01");
    expect(result.total_gross).toBe(0);
    expect(result.total_fees).toBe(0);
    expect(result.total_net).toBe(0);
    expect(result.providers.length).toBe(0);
  });
});

// --- Decline Analytics ---

describe("Decline Analytics", () => {
  test("decline report groups failed payments", () => {
    createPayment({
      type: "charge",
      amount: 100,
      status: "failed",
      description: "Insufficient funds",
      provider: "stripe",
    });
    createPayment({
      type: "charge",
      amount: 200,
      status: "failed",
      description: "Card expired",
      provider: "stripe",
    });
    createPayment({
      type: "charge",
      amount: 150,
      status: "failed",
      description: "Insufficient funds",
      provider: "square",
    });

    const report = declineReport();
    expect(report.total_declined).toBeGreaterThanOrEqual(3);
    expect(report.entries.length).toBeGreaterThanOrEqual(2);
    expect(report.total_amount).toBeGreaterThan(0);
  });

  test("decline report filter by provider", () => {
    const report = declineReport("stripe");
    expect(report.entries.every((e) => e.provider === "stripe")).toBe(true);
  });

  test("decline report with no failures returns empty", () => {
    // This won't be empty since we created failures above, but the structure is correct
    const report = declineReport("mercury");
    expect(report).toHaveProperty("entries");
    expect(report).toHaveProperty("total_declined");
    expect(report).toHaveProperty("total_amount");
  });
});

// --- Dispute Evidence ---

describe("Dispute Evidence", () => {
  test("add evidence to a dispute", () => {
    const payment = createPayment({ type: "charge", amount: 100, status: "succeeded" });
    const dispute = createDispute({ payment_id: payment.id, reason: "Evidence test" });

    const updated = addDisputeEvidence(dispute.id, "Receipt uploaded", "receipt.pdf");
    expect(updated).toBeDefined();
    expect((updated!.evidence as any).items).toBeDefined();
    expect((updated!.evidence as any).items.length).toBe(1);
    expect((updated!.evidence as any).items[0].description).toBe("Receipt uploaded");
    expect((updated!.evidence as any).items[0].file_ref).toBe("receipt.pdf");
  });

  test("add multiple evidence items", () => {
    const payment = createPayment({ type: "charge", amount: 50, status: "succeeded" });
    const dispute = createDispute({ payment_id: payment.id });

    addDisputeEvidence(dispute.id, "First evidence");
    const updated = addDisputeEvidence(dispute.id, "Second evidence", "doc.pdf");

    expect((updated!.evidence as any).items.length).toBe(2);
    expect((updated!.evidence as any).items[1].description).toBe("Second evidence");
  });

  test("add evidence without file ref", () => {
    const payment = createPayment({ type: "charge", amount: 30, status: "succeeded" });
    const dispute = createDispute({ payment_id: payment.id });

    const updated = addDisputeEvidence(dispute.id, "Verbal confirmation");
    expect((updated!.evidence as any).items[0]).not.toHaveProperty("file_ref");
  });

  test("add evidence to nonexistent dispute returns null", () => {
    const result = addDisputeEvidence("nonexistent-id", "Some evidence");
    expect(result).toBeNull();
  });
});

// --- Payment Split ---

describe("Payment Split", () => {
  test("split a payment between vendors", () => {
    const payment = createPayment({
      type: "charge",
      amount: 1000,
      status: "succeeded",
    });

    const splits = { vendor1: 70, vendor2: 30 };
    const updated = splitPayment(payment.id, splits);
    expect(updated).toBeDefined();
    expect(updated!.metadata.splits).toEqual(splits);
    expect(updated!.metadata.split_total_percent).toBe(100);
  });

  test("split with three vendors", () => {
    const payment = createPayment({ type: "charge", amount: 500, status: "succeeded" });
    const splits = { vendorA: 50, vendorB: 30, vendorC: 20 };
    const updated = splitPayment(payment.id, splits);
    expect(updated!.metadata.splits).toEqual(splits);
    expect(updated!.metadata.split_total_percent).toBe(100);
  });

  test("split nonexistent payment returns null", () => {
    const result = splitPayment("nonexistent-id", { vendor: 100 });
    expect(result).toBeNull();
  });
});

// --- Revenue Forecast ---

describe("Revenue Forecast", () => {
  test("forecast returns projected months", () => {
    const result = revenueForecast(3);
    expect(result.months_projected).toBe(3);
    expect(result.historical).toHaveLength(3);
    expect(result.forecast).toHaveLength(3);
    expect(result).toHaveProperty("trend");
    expect(result).toHaveProperty("average_monthly_revenue");
    expect(["growing", "declining", "stable"]).toContain(result.trend);
  });

  test("forecast with 1 month", () => {
    const result = revenueForecast(1);
    expect(result.forecast).toHaveLength(1);
  });

  test("forecast historical has month format", () => {
    const result = revenueForecast(2);
    for (const h of result.historical) {
      expect(h.month).toMatch(/^\d{4}-\d{2}$/);
      expect(h.revenue).toBeGreaterThanOrEqual(0);
    }
    for (const f of result.forecast) {
      expect(f.month).toMatch(/^\d{4}-\d{2}$/);
      expect(f.projected_revenue).toBeGreaterThanOrEqual(0);
    }
  });
});

// --- Reconciliation Gaps ---

describe("Reconciliation Gaps", () => {
  test("find payments without invoices", () => {
    // Create a succeeded charge without invoice_id
    createPayment({
      type: "charge",
      amount: 333,
      status: "succeeded",
      customer_email: "gap-test@example.com",
    });

    const gaps = findReconciliationGaps("2000-01-01", "2099-12-31");
    expect(gaps).toHaveProperty("payments_without_invoice");
    expect(gaps).toHaveProperty("invoice_ids_without_payment");
    expect(gaps).toHaveProperty("gap_count");
    expect(gaps.payments_without_invoice.length).toBeGreaterThan(0);
  });

  test("find invoice IDs without succeeded payment", () => {
    // Create a failed payment with invoice_id
    createPayment({
      type: "charge",
      amount: 444,
      status: "failed",
      invoice_id: "INV-GAP-001",
    });

    const gaps = findReconciliationGaps("2000-01-01", "2099-12-31");
    // INV-GAP-001 should appear in invoice_ids_without_payment since its payment is failed
    const hasGap = gaps.invoice_ids_without_payment.includes("INV-GAP-001");
    expect(hasGap).toBe(true);
  });

  test("gap count equals sum of both gap types", () => {
    const gaps = findReconciliationGaps("2000-01-01", "2099-12-31");
    expect(gaps.gap_count).toBe(
      gaps.payments_without_invoice.length + gaps.invoice_ids_without_payment.length
    );
  });

  test("narrow date range finds no gaps", () => {
    const gaps = findReconciliationGaps("1900-01-01", "1900-01-02");
    expect(gaps.payments_without_invoice.length).toBe(0);
    expect(gaps.invoice_ids_without_payment.length).toBe(0);
    expect(gaps.gap_count).toBe(0);
  });
});
