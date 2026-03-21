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
