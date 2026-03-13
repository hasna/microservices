import type { Invoice } from "../types";
import { cn, formatCurrency, formatDate } from "../lib/utils";
import { ChevronRight } from "lucide-react";

interface InvoiceTableProps {
  invoices: Invoice[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}

const statusStyles: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-info/10 text-info",
  paid: "bg-success/10 text-success",
  overdue: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground line-through",
  refunded: "bg-warning/10 text-warning",
};

export function InvoiceTable({ invoices, onSelect, selectedId }: InvoiceTableProps) {
  if (invoices.length === 0) {
    return (
      <div className="rounded-xl border bg-card">
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <p className="text-sm">No invoices yet</p>
          <p className="text-xs mt-1">Create your first invoice to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Invoice</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Date</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">Due</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
            <th className="px-4 py-3 w-8"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {invoices.map((inv) => (
            <tr
              key={inv.id}
              onClick={() => onSelect(inv.id)}
              className={cn(
                "cursor-pointer transition-colors hover:bg-accent/50",
                selectedId === inv.id && "bg-accent"
              )}
            >
              <td className="px-4 py-3">
                <span className="font-medium text-sm">{inv.invoice_number}</span>
              </td>
              <td className="px-4 py-3 text-sm text-muted-foreground hidden sm:table-cell">
                {formatDate(inv.issue_date)}
              </td>
              <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">
                {inv.due_date ? formatDate(inv.due_date) : "\u2014"}
              </td>
              <td className="px-4 py-3">
                <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize", statusStyles[inv.status] || "")}>
                  {inv.status}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <span className="text-sm font-medium tabular-nums">
                  {formatCurrency(inv.total, inv.currency)}
                </span>
              </td>
              <td className="px-4 py-3">
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
