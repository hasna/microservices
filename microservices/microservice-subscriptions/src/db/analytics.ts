/**
 * Analytics: MRR, ARR, churn, LTV, NRR, cohort analysis
 */

import { getDatabase } from "./database.js";
import { Subscriber, SubscriberRow, rowToSubscriber } from "./subscribers.js";

/**
 * Monthly Recurring Revenue — sum of all active monthly-equivalent revenue.
 * Yearly plans are divided by 12. Lifetime plans are excluded.
 */
export function getMrr(): number {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT COALESCE(SUM(
      CASE
        WHEN p.interval = 'monthly' THEN p.price
        WHEN p.interval = 'yearly' THEN p.price / 12.0
        ELSE 0
      END
    ), 0) as mrr
    FROM subscribers s
    JOIN plans p ON s.plan_id = p.id
    WHERE s.status IN ('active', 'trialing', 'past_due') AND s.status != 'paused'
  `).get() as { mrr: number };
  return Math.round(row.mrr * 100) / 100;
}

/**
 * Annual Recurring Revenue — MRR * 12
 */
export function getArr(): number {
  return Math.round(getMrr() * 12 * 100) / 100;
}

/**
 * Churn rate for a period (in days).
 * Calculated as: (canceled in period) / (active at start of period) * 100
 */
export function getChurnRate(periodDays: number = 30): number {
  const db = getDatabase();
  const now = new Date();
  const periodStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
  const periodStartStr = periodStart.toISOString().replace("T", " ").replace("Z", "").split(".")[0];

  // Count subscribers that were canceled in this period
  const canceledRow = db.prepare(`
    SELECT COUNT(*) as count FROM subscribers
    WHERE status = 'canceled' AND canceled_at >= ?
  `).get(periodStartStr) as { count: number };

  // Count subscribers that were active at the start of the period (active + those canceled during the period)
  const activeAtStartRow = db.prepare(`
    SELECT COUNT(*) as count FROM subscribers
    WHERE (status IN ('active', 'trialing', 'past_due'))
       OR (status = 'canceled' AND canceled_at >= ?)
  `).get(periodStartStr) as { count: number };

  if (activeAtStartRow.count === 0) return 0;
  return Math.round((canceledRow.count / activeAtStartRow.count) * 100 * 100) / 100;
}

/**
 * List subscribers whose current period ends within the given number of days.
 */
export function listExpiring(days: number = 7): Subscriber[] {
  const db = getDatabase();
  const now = new Date();
  const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const nowStr = now.toISOString().replace("T", " ").replace("Z", "").split(".")[0];
  const futureStr = futureDate.toISOString().replace("T", " ").replace("Z", "").split(".")[0];

  const rows = db.prepare(`
    SELECT * FROM subscribers
    WHERE status IN ('active', 'trialing', 'past_due')
      AND current_period_end IS NOT NULL
      AND current_period_end >= ?
      AND current_period_end <= ?
    ORDER BY current_period_end ASC
  `).all(nowStr, futureStr) as SubscriberRow[];

  return rows.map(rowToSubscriber);
}

/**
 * Get subscriber statistics.
 */
export function getSubscriberStats(): {
  total: number;
  active: number;
  trialing: number;
  past_due: number;
  canceled: number;
  expired: number;
  paused: number;
} {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT status, COUNT(*) as count FROM subscribers GROUP BY status
  `).all() as { status: string; count: number }[];

  const stats = {
    total: 0,
    active: 0,
    trialing: 0,
    past_due: 0,
    canceled: 0,
    expired: 0,
    paused: 0,
  };

  for (const row of rows) {
    const key = row.status as keyof typeof stats;
    if (key in stats && key !== "total") {
      stats[key] = row.count;
    }
    stats.total += row.count;
  }

  return stats;
}

// --- LTV Calculation ---

export interface LtvResult {
  subscriber_id: string;
  customer_name: string;
  customer_email: string;
  plan_name: string;
  plan_price: number;
  plan_interval: string;
  months_active: number;
  ltv: number;
}

export function getLtv(): { subscribers: LtvResult[]; average_ltv: number } {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT
      s.id as subscriber_id,
      s.customer_name,
      s.customer_email,
      s.started_at,
      s.canceled_at,
      s.status,
      p.name as plan_name,
      p.price as plan_price,
      p.interval as plan_interval
    FROM subscribers s
    JOIN plans p ON s.plan_id = p.id
    ORDER BY s.customer_name
  `).all() as {
    subscriber_id: string;
    customer_name: string;
    customer_email: string;
    started_at: string;
    canceled_at: string | null;
    status: string;
    plan_name: string;
    plan_price: number;
    plan_interval: string;
  }[];

  const results: LtvResult[] = [];
  let totalLtv = 0;

  for (const row of rows) {
    const startDate = new Date(row.started_at.replace(" ", "T") + "Z");
    const endDate = row.canceled_at
      ? new Date(row.canceled_at.replace(" ", "T") + "Z")
      : new Date();

    const monthsDiff = Math.max(
      1,
      (endDate.getFullYear() - startDate.getFullYear()) * 12 +
        (endDate.getMonth() - startDate.getMonth())
    );

    let monthlyPrice: number;
    if (row.plan_interval === "monthly") {
      monthlyPrice = row.plan_price;
    } else if (row.plan_interval === "yearly") {
      monthlyPrice = row.plan_price / 12;
    } else {
      // lifetime — one-time payment
      monthlyPrice = 0;
    }

    const ltv = row.plan_interval === "lifetime"
      ? row.plan_price
      : Math.round(monthlyPrice * monthsDiff * 100) / 100;

    results.push({
      subscriber_id: row.subscriber_id,
      customer_name: row.customer_name,
      customer_email: row.customer_email,
      plan_name: row.plan_name,
      plan_price: row.plan_price,
      plan_interval: row.plan_interval,
      months_active: monthsDiff,
      ltv,
    });

    totalLtv += ltv;
  }

  const averageLtv = results.length > 0
    ? Math.round((totalLtv / results.length) * 100) / 100
    : 0;

  return { subscribers: results, average_ltv: averageLtv };
}

// --- NRR (Net Revenue Retention) ---

export interface NrrResult {
  month: string;
  start_mrr: number;
  expansion: number;
  contraction: number;
  churn: number;
  nrr: number;
}

export function getNrr(month: string): NrrResult {
  const db = getDatabase();

  // Parse the month (YYYY-MM format)
  const [year, mon] = month.split("-").map(Number);
  const monthStart = `${year}-${String(mon).padStart(2, "0")}-01 00:00:00`;
  const nextMonth = mon === 12 ? `${year + 1}-01-01 00:00:00` : `${year}-${String(mon + 1).padStart(2, "0")}-01 00:00:00`;

  // Start MRR: sum of active subscribers at start of month
  const startMrrRow = db.prepare(`
    SELECT COALESCE(SUM(
      CASE
        WHEN p.interval = 'monthly' THEN p.price
        WHEN p.interval = 'yearly' THEN p.price / 12.0
        ELSE 0
      END
    ), 0) as mrr
    FROM subscribers s
    JOIN plans p ON s.plan_id = p.id
    WHERE s.started_at < ?
      AND (s.canceled_at IS NULL OR s.canceled_at >= ?)
      AND s.status != 'paused'
  `).get(monthStart, monthStart) as { mrr: number };
  const startMrr = Math.round(startMrrRow.mrr * 100) / 100;

  // Expansion: MRR from upgrades during this month
  const expansionRow = db.prepare(`
    SELECT COALESCE(SUM(
      CASE
        WHEN new_p.interval = 'monthly' THEN new_p.price - CASE WHEN old_p.interval = 'monthly' THEN old_p.price WHEN old_p.interval = 'yearly' THEN old_p.price / 12.0 ELSE 0 END
        WHEN new_p.interval = 'yearly' THEN new_p.price / 12.0 - CASE WHEN old_p.interval = 'monthly' THEN old_p.price WHEN old_p.interval = 'yearly' THEN old_p.price / 12.0 ELSE 0 END
        ELSE 0
      END
    ), 0) as expansion
    FROM events e
    JOIN subscribers s ON e.subscriber_id = s.id
    JOIN plans new_p ON json_extract(e.details, '$.new_plan_id') = new_p.id
    JOIN plans old_p ON json_extract(e.details, '$.old_plan_id') = old_p.id
    WHERE e.type = 'upgraded'
      AND e.occurred_at >= ? AND e.occurred_at < ?
  `).get(monthStart, nextMonth) as { expansion: number };
  const expansion = Math.max(0, Math.round(expansionRow.expansion * 100) / 100);

  // Contraction: MRR lost from downgrades during this month
  const contractionRow = db.prepare(`
    SELECT COALESCE(SUM(
      CASE
        WHEN old_p.interval = 'monthly' THEN old_p.price - CASE WHEN new_p.interval = 'monthly' THEN new_p.price WHEN new_p.interval = 'yearly' THEN new_p.price / 12.0 ELSE 0 END
        WHEN old_p.interval = 'yearly' THEN old_p.price / 12.0 - CASE WHEN new_p.interval = 'monthly' THEN new_p.price WHEN new_p.interval = 'yearly' THEN new_p.price / 12.0 ELSE 0 END
        ELSE 0
      END
    ), 0) as contraction
    FROM events e
    JOIN subscribers s ON e.subscriber_id = s.id
    JOIN plans new_p ON json_extract(e.details, '$.new_plan_id') = new_p.id
    JOIN plans old_p ON json_extract(e.details, '$.old_plan_id') = old_p.id
    WHERE e.type = 'downgraded'
      AND e.occurred_at >= ? AND e.occurred_at < ?
  `).get(monthStart, nextMonth) as { contraction: number };
  const contraction = Math.max(0, Math.round(contractionRow.contraction * 100) / 100);

  // Churn: MRR lost from cancellations during this month
  const churnRow = db.prepare(`
    SELECT COALESCE(SUM(
      CASE
        WHEN p.interval = 'monthly' THEN p.price
        WHEN p.interval = 'yearly' THEN p.price / 12.0
        ELSE 0
      END
    ), 0) as churn
    FROM subscribers s
    JOIN plans p ON s.plan_id = p.id
    WHERE s.status = 'canceled'
      AND s.canceled_at >= ? AND s.canceled_at < ?
  `).get(monthStart, nextMonth) as { churn: number };
  const churnMrr = Math.round(churnRow.churn * 100) / 100;

  // NRR = (start_mrr + expansion - contraction - churn) / start_mrr * 100
  const nrr = startMrr > 0
    ? Math.round(((startMrr + expansion - contraction - churnMrr) / startMrr) * 100 * 100) / 100
    : 0;

  return {
    month,
    start_mrr: startMrr,
    expansion,
    contraction,
    churn: churnMrr,
    nrr,
  };
}

// --- Cohort Analysis ---

export interface CohortRow {
  cohort: string;
  total: number;
  retained: number;
  retention_rate: number;
}

export function getCohortReport(months: number = 6): CohortRow[] {
  const db = getDatabase();
  const now = new Date();
  const results: CohortRow[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const cohortDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const cohortStart = `${cohortDate.getFullYear()}-${String(cohortDate.getMonth() + 1).padStart(2, "0")}-01 00:00:00`;
    const cohortEnd = cohortDate.getMonth() === 11
      ? `${cohortDate.getFullYear() + 1}-01-01 00:00:00`
      : `${cohortDate.getFullYear()}-${String(cohortDate.getMonth() + 2).padStart(2, "0")}-01 00:00:00`;
    const cohortLabel = `${cohortDate.getFullYear()}-${String(cohortDate.getMonth() + 1).padStart(2, "0")}`;

    // Total subscribers who signed up in this cohort month
    const totalRow = db.prepare(`
      SELECT COUNT(*) as count FROM subscribers
      WHERE started_at >= ? AND started_at < ?
    `).get(cohortStart, cohortEnd) as { count: number };

    // Retained: those from this cohort who are still active/trialing/past_due (not canceled/expired)
    const retainedRow = db.prepare(`
      SELECT COUNT(*) as count FROM subscribers
      WHERE started_at >= ? AND started_at < ?
        AND status IN ('active', 'trialing', 'past_due', 'paused')
    `).get(cohortStart, cohortEnd) as { count: number };

    const retentionRate = totalRow.count > 0
      ? Math.round((retainedRow.count / totalRow.count) * 100 * 100) / 100
      : 0;

    results.push({
      cohort: cohortLabel,
      total: totalRow.count,
      retained: retainedRow.count,
      retention_rate: retentionRate,
    });
  }

  return results;
}

// --- Expiring Renewals (alias for listExpiring with explicit name) ---

export function getExpiringRenewals(days: number = 7): Subscriber[] {
  return listExpiring(days);
}
