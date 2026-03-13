export interface Invoice {
  id: string;
  invoice_number: string;
  client_id: string | null;
  business_profile_id: string | null;
  status: "draft" | "sent" | "paid" | "overdue" | "cancelled" | "refunded";
  issue_date: string;
  due_date: string | null;
  currency: string;
  subtotal: number;
  tax_rate: number;
  tax_name: string;
  tax_amount: number;
  discount: number;
  total: number;
  reverse_charge: boolean;
  language: string;
  notes: string | null;
  footer_text: string | null;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
}

export interface InvoiceWithItems extends Invoice {
  line_items: LineItem[];
  payments: Payment[];
}

export interface LineItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  sort_order: number;
}

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  method: string | null;
  reference: string | null;
  paid_at: string;
}

export interface Client {
  id: string;
  name: string;
  email: string | null;
  country: string | null;
  vat_number: string | null;
}

export interface BusinessProfile {
  id: string;
  name: string;
  country: string;
  vat_number: string | null;
  is_default: boolean;
}

export interface InvoiceSummary {
  total_invoices: number;
  draft: number;
  sent: number;
  paid: number;
  overdue: number;
  total_outstanding: number;
  total_paid: number;
}
