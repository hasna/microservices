import { useState } from "react";
import type { Client } from "../types";
import { X } from "lucide-react";

interface CreateInvoiceDialogProps {
  clients: Client[];
  onClose: () => void;
  onCreated: () => void;
}

export function CreateInvoiceDialog({ clients, onClose, onCreated }: CreateInvoiceDialogProps) {
  const [form, setForm] = useState({
    client_id: "",
    due_date: "",
    currency: "USD",
    tax_rate: "0",
    tax_name: "Tax",
    discount: "0",
    notes: "",
    language: "en",
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          client_id: form.client_id || undefined,
          due_date: form.due_date || undefined,
          tax_rate: parseFloat(form.tax_rate),
          discount: parseFloat(form.discount),
        }),
      });
      onCreated();
    } catch {
      // handle error
    } finally {
      setSubmitting(false);
    }
  };

  const currencies = ["USD", "EUR", "GBP", "RON", "CHF", "SEK", "DKK", "PLN", "HUF", "CZK", "BGN", "HRK"];

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl border bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h2 className="font-semibold">New Invoice</h2>
            <button onClick={onClose} className="rounded-md p-1 hover:bg-accent">
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Client */}
            <div>
              <label className="block text-sm font-medium mb-1">Client</label>
              <select
                value={form.client_id}
                onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">No client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Currency + Language */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Currency</label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {currencies.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Language</label>
                <select
                  value={form.language}
                  onChange={(e) => setForm({ ...form, language: e.target.value })}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="en">English</option>
                  <option value="ro">Romanian</option>
                  <option value="de">German</option>
                  <option value="fr">French</option>
                  <option value="es">Spanish</option>
                  <option value="it">Italian</option>
                  <option value="nl">Dutch</option>
                  <option value="pl">Polish</option>
                  <option value="hu">Hungarian</option>
                  <option value="bg">Bulgarian</option>
                  <option value="sv">Swedish</option>
                  <option value="da">Danish</option>
                </select>
              </div>
            </div>

            {/* Due Date */}
            <div>
              <label className="block text-sm font-medium mb-1">Due Date</label>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            {/* Tax */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Tax Name</label>
                <input
                  type="text"
                  value={form.tax_name}
                  onChange={(e) => setForm({ ...form, tax_name: e.target.value })}
                  placeholder="VAT, TVA, MwSt..."
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Tax Rate (%)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.tax_rate}
                  onChange={(e) => setForm({ ...form, tax_rate: e.target.value })}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>

            {/* Discount */}
            <div>
              <label className="block text-sm font-medium mb-1">Discount</label>
              <input
                type="number"
                step="0.01"
                value={form.discount}
                onChange={(e) => setForm({ ...form, discount: e.target.value })}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {submitting ? "Creating..." : "Create Invoice"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
