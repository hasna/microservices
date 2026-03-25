/**
 * Payment reconciliation — auto-reconcile, manual reconcile, and gap detection
 */

import { getDatabase } from "./database.js";
import { getPayment, updatePayment, rowToPayment } from "./payments-core.js";
import type { Payment, PaymentRow } from "./payments-core.js";

// --- Reconciliation ---

export function reconcileWithInvoice(paymentId: string, invoiceId: string): Payment | null {
  return updatePayment(paymentId, { invoice_id: invoiceId });
}

export interface AutoReconcileResult {
  matched: Array<{ payment_id: string; invoice_id: string; confidence: string }>;
  unmatched_payments: Payment[];
  unmatched_invoices: string[];
}

/**
 * Auto-reconcile payments to invoices by matching amount + customer_email + date (+-3 days tolerance).
 */
export function autoReconcile(dateFrom?: string, dateTo?: string): AutoReconcileResult {
  const db = getDatabase();

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

  const unreconciledRows = db
    .prepare(
      `SELECT * FROM payments
       WHERE invoice_id IS NULL AND type = 'charge' AND status = 'succeeded'${dateWhere}
       ORDER BY created_at DESC`
    )
    .all(...dateParams) as PaymentRow[];
  const unreconciled = unreconciledRows.map(rowToPayment);

  const reconciledRows = db
    .prepare(
      `SELECT * FROM payments
       WHERE invoice_id IS NOT NULL AND type = 'charge'${dateWhere}
       ORDER BY created_at DESC`
    )
    .all(...dateParams) as PaymentRow[];
  const reconciled = reconciledRows.map(rowToPayment);

  const invoiceIds = new Set(reconciled.map((p) => p.invoice_id!));
  const matchedInvoiceIds = new Set<string>();

  const matched: Array<{ payment_id: string; invoice_id: string; confidence: string }> = [];
  const unmatchedPayments: Payment[] = [];

  for (const payment of unreconciled) {
    let bestMatch: Payment | null = null;
    for (const candidate of reconciled) {
      if (matchedInvoiceIds.has(candidate.invoice_id!)) continue;
      if (candidate.amount !== payment.amount) continue;
      if (
        candidate.customer_email &&
        payment.customer_email &&
        candidate.customer_email === payment.customer_email
      ) {
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

  const unmatchedInvoices = [...invoiceIds].filter((id) => !matchedInvoiceIds.has(id));

  return {
    matched,
    unmatched_payments: unmatchedPayments,
    unmatched_invoices: unmatchedInvoices,
  };
}

export interface ReconciliationGaps {
  payments_without_invoice: Payment[];
  invoice_ids_without_payment: string[];
  gap_count: number;
}

export function findReconciliationGaps(dateFrom: string, dateTo: string): ReconciliationGaps {
  const db = getDatabase();

  const unreconciledRows = db
    .prepare(
      `SELECT * FROM payments
       WHERE invoice_id IS NULL AND type = 'charge' AND status = 'succeeded'
       AND created_at >= ? AND created_at <= ?
       ORDER BY created_at DESC`
    )
    .all(dateFrom, dateTo) as PaymentRow[];
  const paymentsWithoutInvoice = unreconciledRows.map(rowToPayment);

  const succeededInvoiceRows = db
    .prepare(
      `SELECT DISTINCT invoice_id FROM payments
       WHERE invoice_id IS NOT NULL AND status = 'succeeded'
       AND created_at >= ? AND created_at <= ?`
    )
    .all(dateFrom, dateTo) as { invoice_id: string }[];
  const succeededInvoiceIds = new Set(succeededInvoiceRows.map((r) => r.invoice_id));

  const allInvoiceRows = db
    .prepare(
      `SELECT DISTINCT invoice_id FROM payments
       WHERE invoice_id IS NOT NULL
       AND created_at >= ? AND created_at <= ?`
    )
    .all(dateFrom, dateTo) as { invoice_id: string }[];

  const invoiceIdsWithoutSucceededPayment = allInvoiceRows
    .map((r) => r.invoice_id)
    .filter((id) => !succeededInvoiceIds.has(id));

  return {
    payments_without_invoice: paymentsWithoutInvoice,
    invoice_ids_without_payment: invoiceIdsWithoutSucceededPayment,
    gap_count: paymentsWithoutInvoice.length + invoiceIdsWithoutSucceededPayment.length,
  };
}
