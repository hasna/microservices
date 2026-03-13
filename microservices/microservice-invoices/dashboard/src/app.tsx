import { useState, useEffect, useCallback } from "react";
import type { Invoice, InvoiceSummary, Client } from "./types";
import { SummaryCards } from "./components/summary-cards";
import { InvoiceTable } from "./components/invoice-table";
import { InvoiceDetail } from "./components/invoice-detail";
import { CreateInvoiceDialog } from "./components/create-invoice-dialog";
import { FileText, Plus, RefreshCw } from "lucide-react";

export function App() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [summary, setSummary] = useState<InvoiceSummary | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [invRes, sumRes, clRes] = await Promise.all([
        fetch("/api/invoices"),
        fetch("/api/invoices/summary"),
        fetch("/api/clients"),
      ]);
      setInvoices(await invRes.json());
      setSummary(await sumRes.json());
      setClients(await clRes.json());
    } catch {
      // Server might not be running — use empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const filtered =
    filter === "all"
      ? invoices
      : invoices.filter((i) => i.status === filter);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <FileText className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Invoices</h1>
              <p className="text-xs text-muted-foreground">Manage your invoices, clients, and payments</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchData}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              New Invoice
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        {/* Summary Cards */}
        {summary && <SummaryCards summary={summary} onFilterChange={setFilter} activeFilter={filter} />}

        {/* Invoice Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            Loading invoices...
          </div>
        ) : (
          <InvoiceTable
            invoices={filtered}
            onSelect={setSelectedId}
            selectedId={selectedId}
          />
        )}
      </main>

      {/* Detail Slide-over */}
      {selectedId && (
        <InvoiceDetail
          invoiceId={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdate={fetchData}
        />
      )}

      {/* Create Dialog */}
      {showCreate && (
        <CreateInvoiceDialog
          clients={clients}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            fetchData();
          }}
        />
      )}
    </div>
  );
}
