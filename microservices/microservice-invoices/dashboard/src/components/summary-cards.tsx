import type { InvoiceSummary } from "../types";
import { cn, formatCurrency } from "../lib/utils";
import { FileText, Send, CheckCircle, AlertTriangle, DollarSign, Clock } from "lucide-react";

interface SummaryCardsProps {
  summary: InvoiceSummary;
  onFilterChange: (filter: string) => void;
  activeFilter: string;
}

const cards = [
  { key: "all", label: "Total", icon: FileText, color: "text-foreground" },
  { key: "draft", label: "Draft", icon: Clock, color: "text-muted-foreground" },
  { key: "sent", label: "Sent", icon: Send, color: "text-info" },
  { key: "paid", label: "Paid", icon: CheckCircle, color: "text-success" },
  { key: "overdue", label: "Overdue", icon: AlertTriangle, color: "text-destructive" },
] as const;

export function SummaryCards({ summary, onFilterChange, activeFilter }: SummaryCardsProps) {
  const getValue = (key: string) => {
    if (key === "all") return summary.total_invoices;
    return summary[key as keyof InvoiceSummary] as number;
  };

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map(({ key, label, icon: Icon, color }) => (
        <button
          key={key}
          onClick={() => onFilterChange(key)}
          className={cn(
            "flex flex-col gap-1 rounded-xl border p-4 text-left transition-all hover:shadow-sm",
            activeFilter === key
              ? "border-primary/30 bg-primary/5 ring-1 ring-primary/20"
              : "hover:bg-accent/50"
          )}
        >
          <div className="flex items-center justify-between">
            <Icon className={cn("h-4 w-4", color)} />
            <span className="text-2xl font-semibold tabular-nums">{getValue(key)}</span>
          </div>
          <span className="text-xs text-muted-foreground">{label}</span>
        </button>
      ))}

      {/* Outstanding */}
      <div className="flex flex-col gap-1 rounded-xl border bg-card p-4 sm:col-span-2 lg:col-span-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Outstanding</p>
              <p className="text-lg font-semibold text-warning tabular-nums">
                {formatCurrency(summary.total_outstanding)}
              </p>
            </div>
            <div className="h-8 w-px bg-border" />
            <div>
              <p className="text-xs text-muted-foreground">Collected</p>
              <p className="text-lg font-semibold text-success tabular-nums">
                {formatCurrency(summary.total_paid)}
              </p>
            </div>
          </div>
          <DollarSign className="h-5 w-5 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}
