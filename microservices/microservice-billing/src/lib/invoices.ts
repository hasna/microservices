import type { Sql } from "postgres";

export type InvoiceStatus =
  | "draft"
  | "open"
  | "paid"
  | "uncollectible"
  | "void";

export interface Invoice {
  id: string;
  workspace_id: string;
  subscription_id: string | null;
  stripe_invoice_id: string | null;
  amount_cents: number;
  currency: string;
  status: InvoiceStatus;
  invoice_pdf_url: string | null;
  paid_at: string | null;
  due_date: string | null;
  created_at: string;
}

export interface UpsertInvoiceData {
  workspace_id: string;
  subscription_id?: string;
  stripe_invoice_id?: string;
  amount_cents: number;
  currency?: string;
  status?: InvoiceStatus;
  invoice_pdf_url?: string;
  paid_at?: string;
  due_date?: string;
}

export async function upsertInvoice(
  sql: Sql,
  data: UpsertInvoiceData,
): Promise<Invoice> {
  if (data.stripe_invoice_id) {
    const [inv] = await sql<Invoice[]>`
      INSERT INTO billing.invoices
        (workspace_id, subscription_id, stripe_invoice_id, amount_cents, currency, status, invoice_pdf_url, paid_at, due_date)
      VALUES (
        ${data.workspace_id}, ${data.subscription_id ?? null}, ${data.stripe_invoice_id},
        ${data.amount_cents}, ${(data.currency ?? "usd").toLowerCase()}, ${data.status ?? "draft"},
        ${data.invoice_pdf_url ?? null}, ${data.paid_at ?? null}, ${data.due_date ?? null}
      )
      ON CONFLICT (stripe_invoice_id) DO UPDATE SET
        amount_cents = EXCLUDED.amount_cents,
        status = EXCLUDED.status,
        invoice_pdf_url = COALESCE(EXCLUDED.invoice_pdf_url, billing.invoices.invoice_pdf_url),
        paid_at = COALESCE(EXCLUDED.paid_at, billing.invoices.paid_at),
        due_date = COALESCE(EXCLUDED.due_date, billing.invoices.due_date)
      RETURNING *`;
    return inv;
  }
  const [inv] = await sql<Invoice[]>`
    INSERT INTO billing.invoices
      (workspace_id, subscription_id, amount_cents, currency, status, invoice_pdf_url, paid_at, due_date)
    VALUES (
      ${data.workspace_id}, ${data.subscription_id ?? null},
      ${data.amount_cents}, ${(data.currency ?? "usd").toLowerCase()}, ${data.status ?? "draft"},
      ${data.invoice_pdf_url ?? null}, ${data.paid_at ?? null}, ${data.due_date ?? null}
    )
    RETURNING *`;
  return inv;
}

export async function getInvoice(
  sql: Sql,
  id: string,
): Promise<Invoice | null> {
  const [inv] = await sql<
    Invoice[]
  >`SELECT * FROM billing.invoices WHERE id = ${id}`;
  return inv ?? null;
}

export async function listWorkspaceInvoices(
  sql: Sql,
  workspaceId: string,
): Promise<Invoice[]> {
  return sql<
    Invoice[]
  >`SELECT * FROM billing.invoices WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC`;
}

export async function listSubscriptionInvoices(
  sql: Sql,
  subscriptionId: string,
): Promise<Invoice[]> {
  return sql<
    Invoice[]
  >`SELECT * FROM billing.invoices WHERE subscription_id = ${subscriptionId} ORDER BY created_at DESC`;
}
