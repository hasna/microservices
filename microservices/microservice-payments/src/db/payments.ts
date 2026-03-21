/**
 * Payment, Dispute, and Payout CRUD operations
 */

import { getDatabase } from "./database.js";

// --- Payment Types ---

export type PaymentType = "charge" | "refund" | "transfer" | "payout";
export type PaymentStatus = "pending" | "succeeded" | "failed" | "disputed" | "refunded";
export type PaymentProvider = "stripe" | "square" | "mercury" | "manual";

export interface Payment {
  id: string;
  type: PaymentType;
  amount: number;
  currency: string;
  status: PaymentStatus;
  customer_name: string | null;
  customer_email: string | null;
  description: string | null;
  provider: PaymentProvider | null;
  provider_id: string | null;
  invoice_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
}

interface PaymentRow {
  id: string;
  type: string;
  amount: number;
  currency: string;
  status: string;
  customer_name: string | null;
  customer_email: string | null;
  description: string | null;
  provider: string | null;
  provider_id: string | null;
  invoice_id: string | null;
  metadata: string;
  created_at: string;
  completed_at: string | null;
}

function rowToPayment(row: PaymentRow): Payment {
  return {
    ...row,
    type: row.type as PaymentType,
    status: row.status as PaymentStatus,
    provider: row.provider as PaymentProvider | null,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface CreatePaymentInput {
  type: PaymentType;
  amount: number;
  currency?: string;
  status?: PaymentStatus;
  customer_name?: string;
  customer_email?: string;
  description?: string;
  provider?: PaymentProvider;
  provider_id?: string;
  invoice_id?: string;
  metadata?: Record<string, unknown>;
}

export function createPayment(input: CreatePaymentInput): Payment {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO payments (id, type, amount, currency, status, customer_name, customer_email, description, provider, provider_id, invoice_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.type,
    input.amount,
    input.currency || "USD",
    input.status || "pending",
    input.customer_name || null,
    input.customer_email || null,
    input.description || null,
    input.provider || null,
    input.provider_id || null,
    input.invoice_id || null,
    metadata
  );

  return getPayment(id)!;
}

export function getPayment(id: string): Payment | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM payments WHERE id = ?").get(id) as PaymentRow | null;
  return row ? rowToPayment(row) : null;
}

export interface ListPaymentsOptions {
  status?: PaymentStatus;
  type?: PaymentType;
  provider?: PaymentProvider;
  customer_email?: string;
  limit?: number;
  offset?: number;
}

export function listPayments(options: ListPaymentsOptions = {}): Payment[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options.type) {
    conditions.push("type = ?");
    params.push(options.type);
  }
  if (options.provider) {
    conditions.push("provider = ?");
    params.push(options.provider);
  }
  if (options.customer_email) {
    conditions.push("customer_email = ?");
    params.push(options.customer_email);
  }

  let sql = "SELECT * FROM payments";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as PaymentRow[];
  return rows.map(rowToPayment);
}

export interface UpdatePaymentInput {
  status?: PaymentStatus;
  customer_name?: string;
  customer_email?: string;
  description?: string;
  provider?: PaymentProvider;
  provider_id?: string;
  invoice_id?: string;
  metadata?: Record<string, unknown>;
  completed_at?: string;
}

export function updatePayment(id: string, input: UpdatePaymentInput): Payment | null {
  const db = getDatabase();
  const existing = getPayment(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.customer_name !== undefined) {
    sets.push("customer_name = ?");
    params.push(input.customer_name);
  }
  if (input.customer_email !== undefined) {
    sets.push("customer_email = ?");
    params.push(input.customer_email);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.provider !== undefined) {
    sets.push("provider = ?");
    params.push(input.provider);
  }
  if (input.provider_id !== undefined) {
    sets.push("provider_id = ?");
    params.push(input.provider_id);
  }
  if (input.invoice_id !== undefined) {
    sets.push("invoice_id = ?");
    params.push(input.invoice_id);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }
  if (input.completed_at !== undefined) {
    sets.push("completed_at = ?");
    params.push(input.completed_at);
  }

  if (sets.length === 0) return existing;

  params.push(id);
  db.prepare(`UPDATE payments SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getPayment(id);
}

export function deletePayment(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM payments WHERE id = ?").run(id);
  return result.changes > 0;
}

/**
 * Refund a payment — creates a new refund payment linked to the original
 */
export function refundPayment(paymentId: string, amount?: number): Payment | null {
  const db = getDatabase();
  const original = getPayment(paymentId);
  if (!original) return null;
  if (original.status !== "succeeded") return null;

  const refundAmount = amount || original.amount;

  // Create the refund record
  const refund = createPayment({
    type: "refund",
    amount: refundAmount,
    currency: original.currency,
    status: "succeeded",
    customer_name: original.customer_name || undefined,
    customer_email: original.customer_email || undefined,
    description: `Refund for payment ${paymentId}`,
    provider: original.provider || undefined,
    metadata: { original_payment_id: paymentId },
  });

  // Mark original as refunded
  updatePayment(paymentId, { status: "refunded" });

  return refund;
}

export function searchPayments(query: string): Payment[] {
  const db = getDatabase();
  const q = `%${query}%`;
  const rows = db
    .prepare(
      `SELECT * FROM payments
       WHERE customer_name LIKE ? OR customer_email LIKE ? OR description LIKE ? OR provider_id LIKE ? OR invoice_id LIKE ?
       ORDER BY created_at DESC`
    )
    .all(q, q, q, q, q) as PaymentRow[];
  return rows.map(rowToPayment);
}

export function listByProvider(provider: PaymentProvider): Payment[] {
  return listPayments({ provider });
}

export function countPayments(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM payments").get() as { count: number };
  return row.count;
}

// --- Revenue & Analytics ---

export interface RevenueReport {
  total_revenue: number;
  total_refunds: number;
  net_revenue: number;
  payment_count: number;
  refund_count: number;
  currency: string;
}

export function getRevenueReport(startDate: string, endDate: string): RevenueReport {
  const db = getDatabase();

  const revenueRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
       FROM payments
       WHERE type = 'charge' AND status = 'succeeded'
       AND created_at >= ? AND created_at <= ?`
    )
    .get(startDate, endDate) as { total: number; count: number };

  const refundRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
       FROM payments
       WHERE type = 'refund'
       AND created_at >= ? AND created_at <= ?`
    )
    .get(startDate, endDate) as { total: number; count: number };

  return {
    total_revenue: revenueRow.total,
    total_refunds: refundRow.total,
    net_revenue: revenueRow.total - refundRow.total,
    payment_count: revenueRow.count,
    refund_count: refundRow.count,
    currency: "USD",
  };
}

export interface CustomerRevenue {
  customer_email: string;
  customer_name: string | null;
  total_amount: number;
  payment_count: number;
}

export function getRevenueByCustomer(): CustomerRevenue[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT customer_email, customer_name,
              SUM(amount) as total_amount, COUNT(*) as payment_count
       FROM payments
       WHERE type = 'charge' AND status = 'succeeded' AND customer_email IS NOT NULL
       GROUP BY customer_email
       ORDER BY total_amount DESC`
    )
    .all() as CustomerRevenue[];
  return rows;
}

export function reconcileWithInvoice(paymentId: string, invoiceId: string): Payment | null {
  return updatePayment(paymentId, { invoice_id: invoiceId });
}

export interface PaymentStats {
  total_payments: number;
  total_charges: number;
  total_refunds: number;
  total_transfers: number;
  total_payouts: number;
  by_status: Record<string, number>;
  by_provider: Record<string, number>;
  total_amount: number;
}

export function getPaymentStats(): PaymentStats {
  const db = getDatabase();

  const total = db.prepare("SELECT COUNT(*) as count FROM payments").get() as { count: number };

  const typeRows = db
    .prepare("SELECT type, COUNT(*) as count FROM payments GROUP BY type")
    .all() as { type: string; count: number }[];
  const typeCounts: Record<string, number> = {};
  for (const r of typeRows) typeCounts[r.type] = r.count;

  const statusRows = db
    .prepare("SELECT status, COUNT(*) as count FROM payments GROUP BY status")
    .all() as { status: string; count: number }[];
  const statusCounts: Record<string, number> = {};
  for (const r of statusRows) statusCounts[r.status] = r.count;

  const providerRows = db
    .prepare(
      "SELECT COALESCE(provider, 'unknown') as provider, COUNT(*) as count FROM payments GROUP BY provider"
    )
    .all() as { provider: string; count: number }[];
  const providerCounts: Record<string, number> = {};
  for (const r of providerRows) providerCounts[r.provider] = r.count;

  const amountRow = db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE type = 'charge' AND status = 'succeeded'"
    )
    .get() as { total: number };

  return {
    total_payments: total.count,
    total_charges: typeCounts["charge"] || 0,
    total_refunds: typeCounts["refund"] || 0,
    total_transfers: typeCounts["transfer"] || 0,
    total_payouts: typeCounts["payout"] || 0,
    by_status: statusCounts,
    by_provider: providerCounts,
    total_amount: amountRow.total,
  };
}

export interface ProviderBalance {
  provider: string;
  total_charges: number;
  total_refunds: number;
  net_balance: number;
}

export function getBalanceByProvider(): ProviderBalance[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT
        COALESCE(provider, 'unknown') as provider,
        COALESCE(SUM(CASE WHEN type = 'charge' AND status = 'succeeded' THEN amount ELSE 0 END), 0) as total_charges,
        COALESCE(SUM(CASE WHEN type = 'refund' THEN amount ELSE 0 END), 0) as total_refunds
       FROM payments
       GROUP BY provider`
    )
    .all() as { provider: string; total_charges: number; total_refunds: number }[];

  return rows.map((r) => ({
    provider: r.provider,
    total_charges: r.total_charges,
    total_refunds: r.total_refunds,
    net_balance: r.total_charges - r.total_refunds,
  }));
}

// --- Disputes ---

export type DisputeStatus = "open" | "under_review" | "won" | "lost";

export interface Dispute {
  id: string;
  payment_id: string;
  reason: string | null;
  status: DisputeStatus;
  amount: number | null;
  evidence: Record<string, unknown>;
  opened_at: string;
  resolved_at: string | null;
  created_at: string;
}

interface DisputeRow {
  id: string;
  payment_id: string;
  reason: string | null;
  status: string;
  amount: number | null;
  evidence: string;
  opened_at: string;
  resolved_at: string | null;
  created_at: string;
}

function rowToDispute(row: DisputeRow): Dispute {
  return {
    ...row,
    status: row.status as DisputeStatus,
    evidence: JSON.parse(row.evidence || "{}"),
  };
}

export interface CreateDisputeInput {
  payment_id: string;
  reason?: string;
  amount?: number;
  evidence?: Record<string, unknown>;
}

export function createDispute(input: CreateDisputeInput): Dispute {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const evidence = JSON.stringify(input.evidence || {});

  db.prepare(
    `INSERT INTO disputes (id, payment_id, reason, amount, evidence)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, input.payment_id, input.reason || null, input.amount || null, evidence);

  // Mark the payment as disputed
  updatePayment(input.payment_id, { status: "disputed" });

  return getDispute(id)!;
}

export function getDispute(id: string): Dispute | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM disputes WHERE id = ?").get(id) as DisputeRow | null;
  return row ? rowToDispute(row) : null;
}

export function listDisputes(status?: DisputeStatus): Dispute[] {
  const db = getDatabase();
  let sql = "SELECT * FROM disputes";
  const params: unknown[] = [];

  if (status) {
    sql += " WHERE status = ?";
    params.push(status);
  }
  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(...params) as DisputeRow[];
  return rows.map(rowToDispute);
}

export interface RespondDisputeInput {
  status: DisputeStatus;
  evidence?: Record<string, unknown>;
}

export function respondDispute(id: string, input: RespondDisputeInput): Dispute | null {
  const db = getDatabase();
  const existing = getDispute(id);
  if (!existing) return null;

  const sets: string[] = ["status = ?"];
  const params: unknown[] = [input.status];

  if (input.evidence) {
    sets.push("evidence = ?");
    params.push(JSON.stringify(input.evidence));
  }

  if (input.status === "won" || input.status === "lost") {
    sets.push("resolved_at = datetime('now')");
  }

  params.push(id);
  db.prepare(`UPDATE disputes SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getDispute(id);
}

export function deleteDispute(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM disputes WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Payouts ---

export type PayoutStatus = "pending" | "in_transit" | "paid" | "failed";

export interface Payout {
  id: string;
  amount: number;
  currency: string;
  destination: string | null;
  status: PayoutStatus;
  initiated_at: string;
  arrived_at: string | null;
  created_at: string;
}

interface PayoutRow {
  id: string;
  amount: number;
  currency: string;
  destination: string | null;
  status: string;
  initiated_at: string;
  arrived_at: string | null;
  created_at: string;
}

function rowToPayout(row: PayoutRow): Payout {
  return {
    ...row,
    status: row.status as PayoutStatus,
  };
}

export interface CreatePayoutInput {
  amount: number;
  currency?: string;
  destination?: string;
}

export function createPayout(input: CreatePayoutInput): Payout {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO payouts (id, amount, currency, destination)
     VALUES (?, ?, ?, ?)`
  ).run(id, input.amount, input.currency || "USD", input.destination || null);

  return getPayout(id)!;
}

export function getPayout(id: string): Payout | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM payouts WHERE id = ?").get(id) as PayoutRow | null;
  return row ? rowToPayout(row) : null;
}

export function listPayouts(status?: PayoutStatus): Payout[] {
  const db = getDatabase();
  let sql = "SELECT * FROM payouts";
  const params: unknown[] = [];

  if (status) {
    sql += " WHERE status = ?";
    params.push(status);
  }
  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(...params) as PayoutRow[];
  return rows.map(rowToPayout);
}

export interface UpdatePayoutInput {
  status?: PayoutStatus;
  destination?: string;
  arrived_at?: string;
}

export function updatePayout(id: string, input: UpdatePayoutInput): Payout | null {
  const db = getDatabase();
  const existing = getPayout(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.destination !== undefined) {
    sets.push("destination = ?");
    params.push(input.destination);
  }
  if (input.arrived_at !== undefined) {
    sets.push("arrived_at = ?");
    params.push(input.arrived_at);
  }

  if (sets.length === 0) return existing;

  params.push(id);
  db.prepare(`UPDATE payouts SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getPayout(id);
}

export function deletePayout(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM payouts WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Auto-Reconciliation ---

export interface AutoReconcileResult {
  matched: Array<{ payment_id: string; invoice_id: string; confidence: string }>;
  unmatched_payments: Payment[];
  unmatched_invoices: string[];
}

/**
 * Auto-reconcile payments to invoices by matching amount + customer_email + date (+-3 days tolerance).
 * This looks at payments that have no invoice_id and tries to match them against
 * payments that DO have an invoice_id (as a proxy for invoice records).
 */
export function autoReconcile(dateFrom?: string, dateTo?: string): AutoReconcileResult {
  const db = getDatabase();

  // Build date conditions
  const dateConditions: string[] = [];
  const dateParams: unknown[] = [];
  if (dateFrom) {
    dateConditions.push("created_at >= ?");
    dateParams.push(dateFrom);
  }
  if (dateTo) {
    dateConditions.push("created_at <= ?");
    dateParams.push(dateTo);
  }
  const dateWhere = dateConditions.length > 0 ? " AND " + dateConditions.join(" AND ") : "";

  // Get unreconciled payments (no invoice_id, type=charge, succeeded)
  const unreconciledRows = db
    .prepare(
      `SELECT * FROM payments
       WHERE invoice_id IS NULL AND type = 'charge' AND status = 'succeeded'${dateWhere}
       ORDER BY created_at DESC`
    )
    .all(...dateParams) as PaymentRow[];
  const unreconciled = unreconciledRows.map(rowToPayment);

  // Get reconciled payments (have invoice_id) as our "invoice" reference
  const reconciledRows = db
    .prepare(
      `SELECT * FROM payments
       WHERE invoice_id IS NOT NULL AND type = 'charge'${dateWhere}
       ORDER BY created_at DESC`
    )
    .all(...dateParams) as PaymentRow[];
  const reconciled = reconciledRows.map(rowToPayment);

  // Collect known invoice IDs
  const invoiceIds = new Set(reconciled.map((p) => p.invoice_id!));
  const matchedInvoiceIds = new Set<string>();

  const matched: Array<{ payment_id: string; invoice_id: string; confidence: string }> = [];
  const unmatchedPayments: Payment[] = [];

  for (const payment of unreconciled) {
    let bestMatch: Payment | null = null;
    for (const candidate of reconciled) {
      if (matchedInvoiceIds.has(candidate.invoice_id!)) continue;
      // Match by amount
      if (candidate.amount !== payment.amount) continue;
      // Match by customer email
      if (
        candidate.customer_email &&
        payment.customer_email &&
        candidate.customer_email === payment.customer_email
      ) {
        // Match by date proximity (+-3 days)
        const payDate = new Date(payment.created_at).getTime();
        const candDate = new Date(candidate.created_at).getTime();
        const dayDiff = Math.abs(payDate - candDate) / (1000 * 60 * 60 * 24);
        if (dayDiff <= 3) {
          bestMatch = candidate;
          break;
        }
      }
    }

    if (bestMatch && bestMatch.invoice_id) {
      // Link the payment to the invoice
      updatePayment(payment.id, { invoice_id: bestMatch.invoice_id });
      matched.push({
        payment_id: payment.id,
        invoice_id: bestMatch.invoice_id,
        confidence: "high",
      });
      matchedInvoiceIds.add(bestMatch.invoice_id);
    } else {
      unmatchedPayments.push(payment);
    }
  }

  // Unmatched invoices = invoice IDs not used in matching
  const unmatchedInvoices = [...invoiceIds].filter((id) => !matchedInvoiceIds.has(id));

  return {
    matched,
    unmatched_payments: unmatchedPayments,
    unmatched_invoices: unmatchedInvoices,
  };
}

// --- Failed Payment Retry ---

export type RetryStatus = "pending" | "retrying" | "succeeded" | "failed";

export interface RetryAttempt {
  id: string;
  payment_id: string;
  attempt: number;
  status: RetryStatus;
  attempted_at: string | null;
  error: string | null;
  created_at: string;
}

interface RetryAttemptRow {
  id: string;
  payment_id: string;
  attempt: number;
  status: string;
  attempted_at: string | null;
  error: string | null;
  created_at: string;
}

function rowToRetryAttempt(row: RetryAttemptRow): RetryAttempt {
  return {
    ...row,
    status: row.status as RetryStatus,
  };
}

export function retryPayment(paymentId: string): RetryAttempt | null {
  const db = getDatabase();
  const payment = getPayment(paymentId);
  if (!payment) return null;
  if (payment.status !== "failed") return null;

  // Get current attempt count
  const lastAttempt = db
    .prepare(
      "SELECT MAX(attempt) as max_attempt FROM retry_attempts WHERE payment_id = ?"
    )
    .get(paymentId) as { max_attempt: number | null };

  const attemptNum = (lastAttempt?.max_attempt || 0) + 1;
  const id = crypto.randomUUID();

  // Create the retry attempt as retrying
  db.prepare(
    `INSERT INTO retry_attempts (id, payment_id, attempt, status, attempted_at)
     VALUES (?, ?, ?, 'retrying', datetime('now'))`
  ).run(id, paymentId, attemptNum);

  // Simulate retry — mark as succeeded (in a real system, this would call the provider)
  db.prepare(
    `UPDATE retry_attempts SET status = 'succeeded', attempted_at = datetime('now') WHERE id = ?`
  ).run(id);

  // Update the original payment status
  updatePayment(paymentId, { status: "succeeded", completed_at: new Date().toISOString() });

  return getRetryAttempt(id);
}

function getRetryAttempt(id: string): RetryAttempt | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM retry_attempts WHERE id = ?").get(id) as RetryAttemptRow | null;
  return row ? rowToRetryAttempt(row) : null;
}

export function listRetries(paymentId: string): RetryAttempt[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM retry_attempts WHERE payment_id = ? ORDER BY attempt ASC")
    .all(paymentId) as RetryAttemptRow[];
  return rows.map(rowToRetryAttempt);
}

export interface RetryStats {
  total_retries: number;
  succeeded: number;
  failed: number;
  pending: number;
  retrying: number;
  success_rate: number;
}

export function getRetryStats(): RetryStats {
  const db = getDatabase();
  const total = db.prepare("SELECT COUNT(*) as count FROM retry_attempts").get() as { count: number };
  const statusRows = db
    .prepare("SELECT status, COUNT(*) as count FROM retry_attempts GROUP BY status")
    .all() as { status: string; count: number }[];

  const statusCounts: Record<string, number> = {};
  for (const r of statusRows) statusCounts[r.status] = r.count;

  const succeeded = statusCounts["succeeded"] || 0;
  const totalCount = total.count || 0;

  return {
    total_retries: totalCount,
    succeeded,
    failed: statusCounts["failed"] || 0,
    pending: statusCounts["pending"] || 0,
    retrying: statusCounts["retrying"] || 0,
    success_rate: totalCount > 0 ? (succeeded / totalCount) * 100 : 0,
  };
}

// --- Multi-Currency Conversion ---

const CURRENCY_RATES: Record<string, Record<string, number>> = {
  USD: { EUR: 0.92, GBP: 0.79, CAD: 1.36, AUD: 1.53, USD: 1.0 },
  EUR: { USD: 1.09, GBP: 0.86, CAD: 1.48, AUD: 1.66, EUR: 1.0 },
  GBP: { USD: 1.27, EUR: 1.16, CAD: 1.72, AUD: 1.93, GBP: 1.0 },
  CAD: { USD: 0.74, EUR: 0.68, GBP: 0.58, AUD: 1.13, CAD: 1.0 },
  AUD: { USD: 0.65, EUR: 0.60, GBP: 0.52, CAD: 0.89, AUD: 1.0 },
};

export interface CurrencyConversion {
  original_amount: number;
  converted_amount: number;
  from: string;
  to: string;
  rate: number;
}

export function convertCurrency(amount: number, from: string, to: string): CurrencyConversion | null {
  const fromUpper = from.toUpperCase();
  const toUpper = to.toUpperCase();

  const fromRates = CURRENCY_RATES[fromUpper];
  if (!fromRates) return null;

  const rate = fromRates[toUpper];
  if (rate === undefined) return null;

  return {
    original_amount: amount,
    converted_amount: Math.round(amount * rate * 100) / 100,
    from: fromUpper,
    to: toUpper,
    rate,
  };
}

// --- Fee Analysis ---

const PROVIDER_FEES: Record<string, { percent: number; fixed: number }> = {
  stripe: { percent: 2.9, fixed: 0.30 },
  square: { percent: 2.6, fixed: 0.10 },
  mercury: { percent: 0, fixed: 0 },
  manual: { percent: 0, fixed: 0 },
};

export interface ProviderFeeBreakdown {
  provider: string;
  gross: number;
  fees: number;
  net: number;
  transaction_count: number;
}

export interface FeeAnalysisResult {
  month: string;
  providers: ProviderFeeBreakdown[];
  total_gross: number;
  total_fees: number;
  total_net: number;
}

export function feeAnalysis(month: string): FeeAnalysisResult {
  const db = getDatabase();
  const [year, mon] = month.split("-").map(Number);
  const startDate = `${year}-${String(mon).padStart(2, "0")}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const endDate = `${year}-${String(mon).padStart(2, "0")}-${String(lastDay).padStart(2, "0")} 23:59:59`;

  const rows = db
    .prepare(
      `SELECT COALESCE(provider, 'manual') as provider, SUM(amount) as total, COUNT(*) as count
       FROM payments
       WHERE type = 'charge' AND status = 'succeeded'
       AND created_at >= ? AND created_at <= ?
       GROUP BY provider`
    )
    .all(startDate, endDate) as { provider: string; total: number; count: number }[];

  const providers: ProviderFeeBreakdown[] = rows.map((r) => {
    const feeConfig = PROVIDER_FEES[r.provider] || PROVIDER_FEES["manual"];
    const fees = (r.total * feeConfig.percent) / 100 + feeConfig.fixed * r.count;
    return {
      provider: r.provider,
      gross: Math.round(r.total * 100) / 100,
      fees: Math.round(fees * 100) / 100,
      net: Math.round((r.total - fees) * 100) / 100,
      transaction_count: r.count,
    };
  });

  return {
    month,
    providers,
    total_gross: Math.round(providers.reduce((s, p) => s + p.gross, 0) * 100) / 100,
    total_fees: Math.round(providers.reduce((s, p) => s + p.fees, 0) * 100) / 100,
    total_net: Math.round(providers.reduce((s, p) => s + p.net, 0) * 100) / 100,
  };
}

// --- Decline Analytics ---

export interface DeclineEntry {
  description: string | null;
  count: number;
  total_amount: number;
  provider: string | null;
}

export interface DeclineReport {
  entries: DeclineEntry[];
  total_declined: number;
  total_amount: number;
}

export function declineReport(provider?: PaymentProvider): DeclineReport {
  const db = getDatabase();
  const conditions = ["status = 'failed'"];
  const params: unknown[] = [];

  if (provider) {
    conditions.push("provider = ?");
    params.push(provider);
  }

  const whereClause = conditions.join(" AND ");

  const rows = db
    .prepare(
      `SELECT description, COALESCE(provider, 'unknown') as provider, COUNT(*) as count, SUM(amount) as total_amount
       FROM payments
       WHERE ${whereClause}
       GROUP BY description, provider
       ORDER BY count DESC`
    )
    .all(...params) as { description: string | null; provider: string; count: number; total_amount: number }[];

  const entries: DeclineEntry[] = rows.map((r) => ({
    description: r.description,
    count: r.count,
    total_amount: r.total_amount,
    provider: r.provider,
  }));

  return {
    entries,
    total_declined: entries.reduce((s, e) => s + e.count, 0),
    total_amount: entries.reduce((s, e) => s + e.total_amount, 0),
  };
}

// --- Dispute Evidence ---

export function addDisputeEvidence(
  disputeId: string,
  description: string,
  fileRef?: string
): Dispute | null {
  const db = getDatabase();
  const dispute = getDispute(disputeId);
  if (!dispute) return null;

  // Get existing evidence — treat as array if it has "items", otherwise start fresh
  const evidence = dispute.evidence as Record<string, unknown>;
  const items = Array.isArray(evidence.items) ? [...evidence.items] : [];

  const entry: Record<string, unknown> = {
    description,
    added_at: new Date().toISOString(),
  };
  if (fileRef) {
    entry.file_ref = fileRef;
  }
  items.push(entry);

  const newEvidence = { ...evidence, items };
  db.prepare("UPDATE disputes SET evidence = ? WHERE id = ?").run(
    JSON.stringify(newEvidence),
    disputeId
  );

  return getDispute(disputeId);
}

// --- Payment Split ---

export interface PaymentSplit {
  payment_id: string;
  splits: Record<string, number>;
  total_percent: number;
}

export function splitPayment(paymentId: string, splits: Record<string, number>): Payment | null {
  const payment = getPayment(paymentId);
  if (!payment) return null;

  const totalPercent = Object.values(splits).reduce((s, v) => s + v, 0);

  // Store split info in metadata
  const metadata = { ...payment.metadata, splits, split_total_percent: totalPercent };
  return updatePayment(paymentId, { metadata });
}

// --- Revenue Forecast ---

export interface RevenueForecastResult {
  months_projected: number;
  historical: Array<{ month: string; revenue: number }>;
  forecast: Array<{ month: string; projected_revenue: number }>;
  trend: "growing" | "declining" | "stable";
  average_monthly_revenue: number;
}

export function revenueForecast(months: number): RevenueForecastResult {
  const db = getDatabase();

  // Get last 3 months of revenue
  const now = new Date();
  const historical: Array<{ month: string; revenue: number }> = [];

  for (let i = 3; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const mon = d.getMonth() + 1;
    const startDate = `${year}-${String(mon).padStart(2, "0")}-01`;
    const lastDay = new Date(year, mon, 0).getDate();
    const endDate = `${year}-${String(mon).padStart(2, "0")}-${String(lastDay).padStart(2, "0")} 23:59:59`;

    const row = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM payments
         WHERE type = 'charge' AND status = 'succeeded'
         AND created_at >= ? AND created_at <= ?`
      )
      .get(startDate, endDate) as { total: number };

    historical.push({
      month: `${year}-${String(mon).padStart(2, "0")}`,
      revenue: row.total,
    });
  }

  // Calculate trend
  const revenues = historical.map((h) => h.revenue);
  const avgRevenue = revenues.reduce((s, r) => s + r, 0) / (revenues.length || 1);

  let trend: "growing" | "declining" | "stable" = "stable";
  if (revenues.length >= 2) {
    const first = revenues[0];
    const last = revenues[revenues.length - 1];
    if (last > first * 1.05) trend = "growing";
    else if (last < first * 0.95) trend = "declining";
  }

  // Calculate monthly growth rate
  let growthRate = 0;
  if (revenues.length >= 2 && revenues[0] > 0) {
    growthRate = (revenues[revenues.length - 1] - revenues[0]) / revenues[0] / (revenues.length - 1);
  }

  // Project future months
  const forecast: Array<{ month: string; projected_revenue: number }> = [];
  const baseRevenue = revenues[revenues.length - 1] || avgRevenue;

  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const year = d.getFullYear();
    const mon = d.getMonth() + 1;
    const projected = Math.round(baseRevenue * Math.pow(1 + growthRate, i + 1) * 100) / 100;

    forecast.push({
      month: `${year}-${String(mon).padStart(2, "0")}`,
      projected_revenue: projected,
    });
  }

  return {
    months_projected: months,
    historical,
    forecast,
    trend,
    average_monthly_revenue: Math.round(avgRevenue * 100) / 100,
  };
}

// --- Reconciliation Gaps ---

export interface ReconciliationGaps {
  payments_without_invoice: Payment[];
  invoice_ids_without_payment: string[];
  gap_count: number;
}

export function findReconciliationGaps(dateFrom: string, dateTo: string): ReconciliationGaps {
  const db = getDatabase();

  // Payments without invoice_id (type=charge, succeeded)
  const unreconciledRows = db
    .prepare(
      `SELECT * FROM payments
       WHERE invoice_id IS NULL AND type = 'charge' AND status = 'succeeded'
       AND created_at >= ? AND created_at <= ?
       ORDER BY created_at DESC`
    )
    .all(dateFrom, dateTo) as PaymentRow[];
  const paymentsWithoutInvoice = unreconciledRows.map(rowToPayment);

  // Get invoice_ids that have at least one succeeded payment
  const succeededInvoiceRows = db
    .prepare(
      `SELECT DISTINCT invoice_id FROM payments
       WHERE invoice_id IS NOT NULL AND status = 'succeeded'
       AND created_at >= ? AND created_at <= ?`
    )
    .all(dateFrom, dateTo) as { invoice_id: string }[];
  const succeededInvoiceIds = new Set(succeededInvoiceRows.map((r) => r.invoice_id));

  // Get all distinct invoice_ids in the date range
  const allInvoiceRows = db
    .prepare(
      `SELECT DISTINCT invoice_id FROM payments
       WHERE invoice_id IS NOT NULL
       AND created_at >= ? AND created_at <= ?`
    )
    .all(dateFrom, dateTo) as { invoice_id: string }[];

  // Invoice IDs that have no succeeded payment
  const invoiceIdsWithoutSucceededPayment = allInvoiceRows
    .map((r) => r.invoice_id)
    .filter((id) => !succeededInvoiceIds.has(id));

  return {
    payments_without_invoice: paymentsWithoutInvoice,
    invoice_ids_without_payment: invoiceIdsWithoutSucceededPayment,
    gap_count: paymentsWithoutInvoice.length + invoiceIdsWithoutSucceededPayment.length,
  };
}
