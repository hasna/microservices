import type { Sql } from "postgres";

export interface RevenueMetrics {
  total_mrr_cents: number;
  total_arr_cents: number;
  active_subscriptions: number;
  trial_subscriptions: number;
  past_due_subscriptions: number;
  cancelled_subscriptions: number;
  churn_rate_pct: number;
  currency: string;
}

export async function getRevenueMetrics(
  sql: Sql,
  opts: { currency?: string; since?: string } = {},
): Promise<RevenueMetrics[]> {
  const currency = opts.currency ?? "usd";
  const since = opts.since ?? new Date(Date.now() - 30 * 86400000).toISOString();

  const rows = await sql<{
    currency: string;
    status: string;
    interval: string;
    count: string;
    total_cents: string;
  }[]>`
    SELECT p.currency, s.status, p.interval, COUNT(*)::text as count,
           COALESCE(SUM(p.amount_cents), 0)::text as total_cents
    FROM billing.subscriptions s
    JOIN billing.plans p ON s.plan_id = p.id
    WHERE p.currency = ${currency}
      AND s.created_at >= ${since}
    GROUP BY p.currency, s.status, p.interval`;

  const metrics: Record<string, RevenueMetrics> = {};
  for (const row of rows) {
    if (!metrics[row.currency]) {
      metrics[row.currency] = {
        total_mrr_cents: 0, total_arr_cents: 0,
        active_subscriptions: 0, trial_subscriptions: 0,
        past_due_subscriptions: 0, cancelled_subscriptions: 0,
        churn_rate_pct: 0, currency: row.currency,
      };
    }
    const m = metrics[row.currency];
    const count = parseInt(row.count, 10);
    const cents = parseInt(row.total_cents, 10);
    if (row.status === "active") {
      m.active_subscriptions += count;
      if (row.interval === "month") m.total_mrr_cents += cents;
      else if (row.interval === "year") m.total_mrr_cents += Math.round(cents / 12);
    } else if (row.status === "trialing") m.trial_subscriptions += count;
    else if (row.status === "past_due") m.past_due_subscriptions += count;
    else if (row.status === "canceled") m.cancelled_subscriptions += count;
  }
  for (const m of Object.values(metrics)) {
    m.total_arr_cents = m.total_mrr_cents * 12;
    const churned = m.cancelled_subscriptions;
    const total = m.active_subscriptions + churned;
    m.churn_rate_pct = total > 0 ? Math.round(churned / total * 10000) / 100 : 0;
  }
  return Object.values(metrics);
}