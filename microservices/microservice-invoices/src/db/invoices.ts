/**
 * Invoice CRUD operations
 */

import { getDatabase } from "./database.js";

export interface Invoice {
  id: string;
  invoice_number: string;
  client_id: string | null;
  status: "draft" | "sent" | "paid" | "overdue" | "cancelled" | "refunded";
  issue_date: string;
  due_date: string | null;
  currency: string;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  discount: number;
  total: number;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
}

export interface LineItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  sort_order: number;
  created_at: string;
}

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  method: string | null;
  reference: string | null;
  notes: string | null;
  paid_at: string;
  created_at: string;
}

export interface InvoiceWithItems extends Invoice {
  line_items: LineItem[];
  payments: Payment[];
}

interface InvoiceRow extends Omit<Invoice, "metadata"> {
  metadata: string;
}

function rowToInvoice(row: InvoiceRow): Invoice {
  return { ...row, metadata: JSON.parse(row.metadata || "{}") } as Invoice;
}

function nextInvoiceNumber(): string {
  const db = getDatabase();
  const counter = db
    .prepare("SELECT prefix, next_number FROM invoice_counter WHERE id = 1")
    .get() as { prefix: string; next_number: number };

  const number = `${counter.prefix}-${String(counter.next_number).padStart(5, "0")}`;
  db.prepare("UPDATE invoice_counter SET next_number = next_number + 1 WHERE id = 1").run();
  return number;
}

function recalculateInvoice(invoiceId: string): void {
  const db = getDatabase();

  // Sum line items
  const row = db
    .prepare("SELECT COALESCE(SUM(amount), 0) as subtotal FROM line_items WHERE invoice_id = ?")
    .get(invoiceId) as { subtotal: number };

  const invoice = db
    .prepare("SELECT tax_rate, discount FROM invoices WHERE id = ?")
    .get(invoiceId) as { tax_rate: number; discount: number };

  const subtotal = row.subtotal;
  const discounted = subtotal - (invoice.discount || 0);
  const taxAmount = discounted * ((invoice.tax_rate || 0) / 100);
  const total = discounted + taxAmount;

  db.prepare(
    "UPDATE invoices SET subtotal = ?, tax_amount = ?, total = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(subtotal, taxAmount, total, invoiceId);
}

export interface CreateInvoiceInput {
  client_id?: string;
  invoice_number?: string;
  issue_date?: string;
  due_date?: string;
  currency?: string;
  tax_rate?: number;
  discount?: number;
  notes?: string;
}

export function createInvoice(input: CreateInvoiceInput = {}): Invoice {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const invoiceNumber = input.invoice_number || nextInvoiceNumber();

  db.prepare(
    `INSERT INTO invoices (id, invoice_number, client_id, issue_date, due_date, currency, tax_rate, discount, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    invoiceNumber,
    input.client_id || null,
    input.issue_date || new Date().toISOString().split("T")[0],
    input.due_date || null,
    input.currency || "USD",
    input.tax_rate || 0,
    input.discount || 0,
    input.notes || null
  );

  return getInvoice(id)!;
}

export function getInvoice(id: string): Invoice | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM invoices WHERE id = ? OR invoice_number = ?").get(id, id) as InvoiceRow | null;
  return row ? rowToInvoice(row) : null;
}

export function getInvoiceWithItems(id: string): InvoiceWithItems | null {
  const invoice = getInvoice(id);
  if (!invoice) return null;

  const db = getDatabase();
  const line_items = db
    .prepare("SELECT * FROM line_items WHERE invoice_id = ? ORDER BY sort_order")
    .all(invoice.id) as LineItem[];
  const payments = db
    .prepare("SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at")
    .all(invoice.id) as Payment[];

  return { ...invoice, line_items, payments };
}

export interface ListInvoicesOptions {
  status?: string;
  client_id?: string;
  from_date?: string;
  to_date?: string;
  limit?: number;
}

export function listInvoices(options: ListInvoicesOptions = {}): Invoice[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options.client_id) {
    conditions.push("client_id = ?");
    params.push(options.client_id);
  }
  if (options.from_date) {
    conditions.push("issue_date >= ?");
    params.push(options.from_date);
  }
  if (options.to_date) {
    conditions.push("issue_date <= ?");
    params.push(options.to_date);
  }

  let sql = "SELECT * FROM invoices";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  const rows = db.prepare(sql).all(...params) as InvoiceRow[];
  return rows.map(rowToInvoice);
}

export function updateInvoiceStatus(
  id: string,
  status: Invoice["status"]
): Invoice | null {
  const db = getDatabase();
  const paidAt = status === "paid" ? "datetime('now')" : "NULL";
  db.prepare(
    `UPDATE invoices SET status = ?, paid_at = ${paidAt}, updated_at = datetime('now') WHERE id = ?`
  ).run(status, id);
  return getInvoice(id);
}

export function deleteInvoice(id: string): boolean {
  const db = getDatabase();
  return db.prepare("DELETE FROM invoices WHERE id = ?").run(id).changes > 0;
}

// --- Line Items ---

export interface AddLineItemInput {
  invoice_id: string;
  description: string;
  quantity?: number;
  unit_price: number;
}

export function addLineItem(input: AddLineItemInput): LineItem {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const quantity = input.quantity || 1;
  const amount = quantity * input.unit_price;

  // Get next sort order
  const maxOrder = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) as max_order FROM line_items WHERE invoice_id = ?")
    .get(input.invoice_id) as { max_order: number };

  db.prepare(
    `INSERT INTO line_items (id, invoice_id, description, quantity, unit_price, amount, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.invoice_id, input.description, quantity, input.unit_price, amount, maxOrder.max_order + 1);

  recalculateInvoice(input.invoice_id);

  return db.prepare("SELECT * FROM line_items WHERE id = ?").get(id) as LineItem;
}

export function removeLineItem(id: string): boolean {
  const db = getDatabase();
  const item = db.prepare("SELECT invoice_id FROM line_items WHERE id = ?").get(id) as { invoice_id: string } | null;
  if (!item) return false;

  db.prepare("DELETE FROM line_items WHERE id = ?").run(id);
  recalculateInvoice(item.invoice_id);
  return true;
}

// --- Payments ---

export interface RecordPaymentInput {
  invoice_id: string;
  amount: number;
  method?: string;
  reference?: string;
  notes?: string;
}

export function recordPayment(input: RecordPaymentInput): Payment {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO payments (id, invoice_id, amount, method, reference, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.invoice_id, input.amount, input.method || null, input.reference || null, input.notes || null);

  // Check if fully paid
  const invoice = getInvoice(input.invoice_id);
  if (invoice) {
    const totalPaid = db
      .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE invoice_id = ?")
      .get(input.invoice_id) as { total: number };

    if (totalPaid.total >= invoice.total) {
      updateInvoiceStatus(input.invoice_id, "paid");
    }
  }

  return db.prepare("SELECT * FROM payments WHERE id = ?").get(id) as Payment;
}

// --- Summary ---

export function getInvoiceSummary(): {
  total_invoices: number;
  draft: number;
  sent: number;
  paid: number;
  overdue: number;
  total_outstanding: number;
  total_paid: number;
} {
  const db = getDatabase();

  const counts = db
    .prepare(
      `SELECT
        COUNT(*) as total_invoices,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
        SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue,
        COALESCE(SUM(CASE WHEN status IN ('sent', 'overdue') THEN total ELSE 0 END), 0) as total_outstanding,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END), 0) as total_paid
      FROM invoices`
    )
    .get() as {
    total_invoices: number;
    draft: number;
    sent: number;
    paid: number;
    overdue: number;
    total_outstanding: number;
    total_paid: number;
  };

  return counts;
}
