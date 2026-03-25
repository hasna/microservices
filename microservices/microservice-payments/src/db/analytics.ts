/**
 * Revenue analytics, fee analysis, decline reports, and forecasting
 */

import { getDatabase } from "./database.js";
import type { PaymentProvider } from "./payments-core.js";

// --- Revenue & Analytics ---

export interface RevenueReport {
  total_revenue: number;
  total_refunds: number;
  net_revenue: number;
  payment_count: number;
  refund_count: number;
  currency: string;
}

export function getRevenueReport(startDate: string, endDate: string): RevenueReport {
  const db = getDatabase();

  const revenueRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
       FROM payments
       WHERE type = 'charge' AND status = 'succeeded'
       AND created_at >= ? AND created_at <= ?`
    )
    .get(startDate, endDate) as { total: number; count: number };

  const refundRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
       FROM payments
       WHERE type = 'refund'
       AND created_at >= ? AND created_at <= ?`
    )
    .get(startDate, endDate) as { total: number; count: number };

  return {
    total_revenue: revenueRow.total,
    total_refunds: refundRow.total,
    net_revenue: revenueRow.total - refundRow.total,
    payment_count: revenueRow.count,
    refund_count: refundRow.count,
    currency: "USD",
  };
}

export interface CustomerRevenue {
  customer_email: string;
  customer_name: string | null;
  total_amount: number;
  payment_count: number;
}

export function getRevenueByCustomer(): CustomerRevenue[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT customer_email, customer_name,
              SUM(amount) as total_amount, COUNT(*) as payment_count
       FROM payments
       WHERE type = 'charge' AND status = 'succeeded' AND customer_email IS NOT NULL
       GROUP BY customer_email
       ORDER BY total_amount DESC`
    )
    .all() as CustomerRevenue[];
  return rows;
}

export interface PaymentStats {
  total_payments: number;
  total_charges: number;
  total_refunds: number;
  total_transfers: number;
  total_payouts: number;
  by_status: Record<string, number>;
  by_provider: Record<string, number>;
  total_amount: number;
}

export function getPaymentStats(): PaymentStats {
  const db = getDatabase();

  const total = db.prepare("SELECT COUNT(*) as count FROM payments").get() as { count: number };

  const typeRows = db
    .prepare("SELECT type, COUNT(*) as count FROM payments GROUP BY type")
    .all() as { type: string; count: number }[];
  const typeCounts: Record<string, number> = {};
  for (const r of typeRows) typeCounts[r.type] = r.count;

  const statusRows = db
    .prepare("SELECT status, COUNT(*) as count FROM payments GROUP BY status")
    .all() as { status: string; count: number }[];
  const statusCounts: Record<string, number> = {};
  for (const r of statusRows) statusCounts[r.status] = r.count;

  const providerRows = db
    .prepare(
      "SELECT COALESCE(provider, 'unknown') as provider, COUNT(*) as count FROM payments GROUP BY provider"
    )
    .all() as { provider: string; count: number }[];
  const providerCounts: Record<string, number> = {};
  for (const r of providerRows) providerCounts[r.provider] = r.count;

  const amountRow = db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE type = 'charge' AND status = 'succeeded'"
    )
    .get() as { total: number };

  return {
    total_payments: total.count,
    total_charges: typeCounts["charge"] || 0,
    total_refunds: typeCounts["refund"] || 0,
    total_transfers: typeCounts["transfer"] || 0,
    total_payouts: typeCounts["payout"] || 0,
    by_status: statusCounts,
    by_provider: providerCounts,
    total_amount: amountRow.total,
  };
}

export interface ProviderBalance {
  provider: string;
  total_charges: number;
  total_refunds: number;
  net_balance: number;
}

export function getBalanceByProvider(): ProviderBalance[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT
        COALESCE(provider, 'unknown') as provider,
        COALESCE(SUM(CASE WHEN type = 'charge' AND status = 'succeeded' THEN amount ELSE 0 END), 0) as total_charges,
        COALESCE(SUM(CASE WHEN type = 'refund' THEN amount ELSE 0 END), 0) as total_refunds
       FROM payments
       GROUP BY provider`
    )
    .all() as { provider: string; total_charges: number; total_refunds: number }[];

  return rows.map((r) => ({
    provider: r.provider,
    total_charges: r.total_charges,
    total_refunds: r.total_refunds,
    net_balance: r.total_charges - r.total_refunds,
  }));
}

// --- Fee Analysis ---

const PROVIDER_FEES: Record<string, { percent: number; fixed: number }> = {
  stripe: { percent: 2.9, fixed: 0.30 },
  square: { percent: 2.6, fixed: 0.10 },
  mercury: { percent: 0, fixed: 0 },
  manual: { percent: 0, fixed: 0 },
};

export interface ProviderFeeBreakdown {
  provider: string;
  gross: number;
  fees: number;
  net: number;
  transaction_count: number;
}

export interface FeeAnalysisResult {
  month: string;
  providers: ProviderFeeBreakdown[];
  total_gross: number;
  total_fees: number;
  total_net: number;
}

export function feeAnalysis(month: string): FeeAnalysisResult {
  const db = getDatabase();
  const [year, mon] = month.split("-").map(Number);
  const startDate = `${year}-${String(mon).padStart(2, "0")}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const endDate = `${year}-${String(mon).padStart(2, "0")}-${String(lastDay).padStart(2, "0")} 23:59:59`;

  const rows = db
    .prepare(
      `SELECT COALESCE(provider, 'manual') as provider, SUM(amount) as total, COUNT(*) as count
       FROM payments
       WHERE type = 'charge' AND status = 'succeeded'
       AND created_at >= ? AND created_at <= ?
       GROUP BY provider`
    )
    .all(startDate, endDate) as { provider: string; total: number; count: number }[];

  const providers: ProviderFeeBreakdown[] = rows.map((r) => {
    const feeConfig = PROVIDER_FEES[r.provider] || PROVIDER_FEES["manual"];
    const fees = (r.total * feeConfig.percent) / 100 + feeConfig.fixed * r.count;
    return {
      provider: r.provider,
      gross: Math.round(r.total * 100) / 100,
      fees: Math.round(fees * 100) / 100,
      net: Math.round((r.total - fees) * 100) / 100,
      transaction_count: r.count,
    };
  });

  return {
    month,
    providers,
    total_gross: Math.round(providers.reduce((s, p) => s + p.gross, 0) * 100) / 100,
    total_fees: Math.round(providers.reduce((s, p) => s + p.fees, 0) * 100) / 100,
    total_net: Math.round(providers.reduce((s, p) => s + p.net, 0) * 100) / 100,
  };
}

// --- Decline Analytics ---

export interface DeclineEntry {
  description: string | null;
  count: number;
  total_amount: number;
  provider: string | null;
}

export interface DeclineReport {
  entries: DeclineEntry[];
  total_declined: number;
  total_amount: number;
}

export function declineReport(provider?: PaymentProvider): DeclineReport {
  const db = getDatabase();
  const conditions = ["status = 'failed'"];
  const params: unknown[] = [];

  if (provider) {
    conditions.push("provider = ?");
    params.push(provider);
  }

  const whereClause = conditions.join(" AND ");

  const rows = db
    .prepare(
      `SELECT description, COALESCE(provider, 'unknown') as provider, COUNT(*) as count, SUM(amount) as total_amount
       FROM payments
       WHERE ${whereClause}
       GROUP BY description, provider
       ORDER BY count DESC`
    )
    .all(...params) as { description: string | null; provider: string; count: number; total_amount: number }[];

  const entries: DeclineEntry[] = rows.map((r) => ({
    description: r.description,
    count: r.count,
    total_amount: r.total_amount,
    provider: r.provider,
  }));

  return {
    entries,
    total_declined: entries.reduce((s, e) => s + e.count, 0),
    total_amount: entries.reduce((s, e) => s + e.total_amount, 0),
  };
}

// --- Revenue Forecast ---

export interface RevenueForecastResult {
  months_projected: number;
  historical: Array<{ month: string; revenue: number }>;
  forecast: Array<{ month: string; projected_revenue: number }>;
  trend: "growing" | "declining" | "stable";
  average_monthly_revenue: number;
}

export function revenueForecast(months: number): RevenueForecastResult {
  const db = getDatabase();

  const now = new Date();
  const historical: Array<{ month: string; revenue: number }> = [];

  for (let i = 3; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const mon = d.getMonth() + 1;
    const startDate = `${year}-${String(mon).padStart(2, "0")}-01`;
    const lastDay = new Date(year, mon, 0).getDate();
    const endDate = `${year}-${String(mon).padStart(2, "0")}-${String(lastDay).padStart(2, "0")} 23:59:59`;

    const row = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM payments
         WHERE type = 'charge' AND status = 'succeeded'
         AND created_at >= ? AND created_at <= ?`
      )
      .get(startDate, endDate) as { total: number };

    historical.push({
      month: `${year}-${String(mon).padStart(2, "0")}`,
      revenue: row.total,
    });
  }

  const revenues = historical.map((h) => h.revenue);
  const avgRevenue = revenues.reduce((s, r) => s + r, 0) / (revenues.length || 1);

  let trend: "growing" | "declining" | "stable" = "stable";
  if (revenues.length >= 2) {
    const first = revenues[0];
    const last = revenues[revenues.length - 1];
    if (last > first * 1.05) trend = "growing";
    else if (last < first * 0.95) trend = "declining";
  }

  let growthRate = 0;
  if (revenues.length >= 2 && revenues[0] > 0) {
    growthRate = (revenues[revenues.length - 1] - revenues[0]) / revenues[0] / (revenues.length - 1);
  }

  const forecast: Array<{ month: string; projected_revenue: number }> = [];
  const baseRevenue = revenues[revenues.length - 1] || avgRevenue;

  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const year = d.getFullYear();
    const mon = d.getMonth() + 1;
    const projected = Math.round(baseRevenue * Math.pow(1 + growthRate, i + 1) * 100) / 100;

    forecast.push({
      month: `${year}-${String(mon).padStart(2, "0")}`,
      projected_revenue: projected,
    });
  }

  return {
    months_projected: months,
    historical,
    forecast,
    trend,
    average_monthly_revenue: Math.round(avgRevenue * 100) / 100,
  };
}
