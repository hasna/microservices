import { useState, useEffect } from "react";
import type { InvoiceWithItems } from "../types";
import { cn, formatCurrency, formatDate } from "../lib/utils";
import { X, Send, CheckCircle, Ban, FileText } from "lucide-react";

interface InvoiceDetailProps {
  invoiceId: string;
  onClose: () => void;
  onUpdate: () => void;
}

const statusActions = [
  { from: "draft", to: "sent", label: "Mark Sent", icon: Send },
  { from: "sent", to: "paid", label: "Mark Paid", icon: CheckCircle },
  { from: "sent", to: "overdue", label: "Mark Overdue", icon: Ban },
] as const;

export function InvoiceDetail({ invoiceId, onClose, onUpdate }: InvoiceDetailProps) {
  const [invoice, setInvoice] = useState<InvoiceWithItems | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/invoices/${invoiceId}`)
      .then((r) => r.json())
      .then(setInvoice)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [invoiceId]);

  const updateStatus = async (status: string) => {
    await fetch(`/api/invoices/${invoiceId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    onUpdate();
    // Refresh detail
    const r = await fetch(`/api/invoices/${invoiceId}`);
    setInvoice(await r.json());
  };

  if (loading) return null;
  if (!invoice) return null;

  const actions = statusActions.filter((a) => a.from === invoice.status);
  const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
  const balance = invoice.total - totalPaid;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-card border-l shadow-xl z-50 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <div>
              <h2 className="font-semibold">{invoice.invoice_number}</h2>
              <p className="text-xs text-muted-foreground">{formatDate(invoice.issue_date)}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Status + Actions */}
          <div className="flex items-center justify-between">
            <span className={cn(
              "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium capitalize",
              invoice.status === "paid" ? "bg-success/10 text-success" :
              invoice.status === "overdue" ? "bg-destructive/10 text-destructive" :
              invoice.status === "sent" ? "bg-info/10 text-info" :
              "bg-muted text-muted-foreground"
            )}>
              {invoice.status}
            </span>
            <div className="flex gap-2">
              {actions.map(({ to, label, icon: Icon }) => (
                <button
                  key={to}
                  onClick={() => updateStatus(to)}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Amounts */}
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">{formatCurrency(invoice.subtotal, invoice.currency)}</span>
            </div>
            {invoice.discount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Discount</span>
                <span className="tabular-nums text-success">-{formatCurrency(invoice.discount, invoice.currency)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {invoice.tax_name} ({invoice.tax_rate}%)
                {invoice.reverse_charge && <span className="ml-1 text-xs text-warning">(Reverse Charge)</span>}
              </span>
              <span className="tabular-nums">{formatCurrency(invoice.tax_amount, invoice.currency)}</span>
            </div>
            <div className="border-t pt-2 flex justify-between font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(invoice.total, invoice.currency)}</span>
            </div>
            {totalPaid > 0 && (
              <>
                <div className="flex justify-between text-sm text-success">
                  <span>Paid</span>
                  <span className="tabular-nums">-{formatCurrency(totalPaid, invoice.currency)}</span>
                </div>
                <div className="flex justify-between text-sm font-medium">
                  <span>Balance Due</span>
                  <span className="tabular-nums">{formatCurrency(balance, invoice.currency)}</span>
                </div>
              </>
            )}
          </div>

          {/* Line Items */}
          {invoice.line_items.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">Line Items</h3>
              <div className="rounded-lg border divide-y">
                {invoice.line_items.map((item) => (
                  <div key={item.id} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{item.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.quantity} x {formatCurrency(item.unit_price, invoice.currency)}
                      </p>
                    </div>
                    <span className="text-sm font-medium tabular-nums">
                      {formatCurrency(item.amount, invoice.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Payments */}
          {invoice.payments.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">Payments</h3>
              <div className="rounded-lg border divide-y">
                {invoice.payments.map((p) => (
                  <div key={p.id} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm">{p.method || "Payment"}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(p.paid_at)}</p>
                    </div>
                    <span className="text-sm font-medium text-success tabular-nums">
                      {formatCurrency(p.amount, invoice.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {invoice.notes && (
            <div>
              <h3 className="text-sm font-medium mb-1">Notes</h3>
              <p className="text-sm text-muted-foreground">{invoice.notes}</p>
            </div>
          )}

          {/* Footer */}
          {invoice.footer_text && (
            <div className="border-t pt-4">
              <p className="text-xs text-muted-foreground italic">{invoice.footer_text}</p>
            </div>
          )}

          {/* Meta */}
          <div className="border-t pt-4 space-y-1 text-xs text-muted-foreground">
            <p>ID: {invoice.id}</p>
            <p>Created: {formatDate(invoice.created_at)}</p>
            {invoice.due_date && <p>Due: {formatDate(invoice.due_date)}</p>}
            {invoice.paid_at && <p>Paid: {formatDate(invoice.paid_at)}</p>}
            <p>Currency: {invoice.currency} | Language: {invoice.language}</p>
          </div>
        </div>
      </div>
    </>
  );
}
