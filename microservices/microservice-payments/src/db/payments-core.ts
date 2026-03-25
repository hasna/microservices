/**
 * Payment core CRUD operations
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

export interface PaymentRow {
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

export function rowToPayment(row: PaymentRow): Payment {
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
  const original = getPayment(paymentId);
  if (!original) return null;
  if (original.status !== "succeeded") return null;

  const refundAmount = amount || original.amount;

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

export function splitPayment(paymentId: string, splits: Record<string, number>): Payment | null {
  const payment = getPayment(paymentId);
  if (!payment) return null;

  const totalPercent = Object.values(splits).reduce((s, v) => s + v, 0);

  const metadata = { ...payment.metadata, splits, split_total_percent: totalPercent };
  return updatePayment(paymentId, { metadata });
}

export interface PaymentSplit {
  payment_id: string;
  splits: Record<string, number>;
  total_percent: number;
}
