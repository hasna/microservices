/**
 * Subscription CRUD operations and analytics
 */

import { getDatabase } from "./database.js";

// --- Types ---

export interface Plan {
  id: string;
  name: string;
  price: number;
  interval: "monthly" | "yearly" | "lifetime";
  features: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface PlanRow {
  id: string;
  name: string;
  price: number;
  interval: string;
  features: string;
  active: number;
  created_at: string;
  updated_at: string;
}

function rowToPlan(row: PlanRow): Plan {
  return {
    ...row,
    interval: row.interval as Plan["interval"],
    features: JSON.parse(row.features || "[]"),
    active: row.active === 1,
  };
}

export interface Subscriber {
  id: string;
  plan_id: string;
  customer_name: string;
  customer_email: string;
  status: "trialing" | "active" | "past_due" | "canceled" | "expired";
  started_at: string;
  trial_ends_at: string | null;
  current_period_start: string;
  current_period_end: string | null;
  canceled_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface SubscriberRow {
  id: string;
  plan_id: string;
  customer_name: string;
  customer_email: string;
  status: string;
  started_at: string;
  trial_ends_at: string | null;
  current_period_start: string;
  current_period_end: string | null;
  canceled_at: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToSubscriber(row: SubscriberRow): Subscriber {
  return {
    ...row,
    status: row.status as Subscriber["status"],
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface SubscriptionEvent {
  id: string;
  subscriber_id: string;
  type: "created" | "upgraded" | "downgraded" | "canceled" | "renewed" | "payment_failed";
  occurred_at: string;
  details: Record<string, unknown>;
}

interface EventRow {
  id: string;
  subscriber_id: string;
  type: string;
  occurred_at: string;
  details: string;
}

function rowToEvent(row: EventRow): SubscriptionEvent {
  return {
    ...row,
    type: row.type as SubscriptionEvent["type"],
    details: JSON.parse(row.details || "{}"),
  };
}

// --- Plans CRUD ---

export interface CreatePlanInput {
  name: string;
  price: number;
  interval: "monthly" | "yearly" | "lifetime";
  features?: string[];
  active?: boolean;
}

export function createPlan(input: CreatePlanInput): Plan {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const features = JSON.stringify(input.features || []);
  const active = input.active !== undefined ? (input.active ? 1 : 0) : 1;

  db.prepare(
    `INSERT INTO plans (id, name, price, interval, features, active)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.name, input.price, input.interval, features, active);

  return getPlan(id)!;
}

export function getPlan(id: string): Plan | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as PlanRow | null;
  return row ? rowToPlan(row) : null;
}

export interface ListPlansOptions {
  active_only?: boolean;
  interval?: string;
  limit?: number;
  offset?: number;
}

export function listPlans(options: ListPlansOptions = {}): Plan[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.active_only) {
    conditions.push("active = 1");
  }

  if (options.interval) {
    conditions.push("interval = ?");
    params.push(options.interval);
  }

  let sql = "SELECT * FROM plans";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY name";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as PlanRow[];
  return rows.map(rowToPlan);
}

export interface UpdatePlanInput {
  name?: string;
  price?: number;
  interval?: "monthly" | "yearly" | "lifetime";
  features?: string[];
  active?: boolean;
}

export function updatePlan(id: string, input: UpdatePlanInput): Plan | null {
  const db = getDatabase();
  const existing = getPlan(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.price !== undefined) {
    sets.push("price = ?");
    params.push(input.price);
  }
  if (input.interval !== undefined) {
    sets.push("interval = ?");
    params.push(input.interval);
  }
  if (input.features !== undefined) {
    sets.push("features = ?");
    params.push(JSON.stringify(input.features));
  }
  if (input.active !== undefined) {
    sets.push("active = ?");
    params.push(input.active ? 1 : 0);
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE plans SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getPlan(id);
}

export function deletePlan(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM plans WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Subscribers CRUD ---

export interface CreateSubscriberInput {
  plan_id: string;
  customer_name: string;
  customer_email: string;
  status?: Subscriber["status"];
  trial_ends_at?: string;
  current_period_end?: string;
  metadata?: Record<string, unknown>;
}

export function createSubscriber(input: CreateSubscriberInput): Subscriber {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});
  const status = input.status || "active";
  const now = new Date().toISOString().replace("T", " ").replace("Z", "").split(".")[0];

  // Calculate period end if not provided
  let periodEnd = input.current_period_end || null;
  if (!periodEnd) {
    const plan = getPlan(input.plan_id);
    if (plan) {
      const start = new Date();
      if (plan.interval === "monthly") {
        start.setMonth(start.getMonth() + 1);
      } else if (plan.interval === "yearly") {
        start.setFullYear(start.getFullYear() + 1);
      }
      // lifetime has no period end
      if (plan.interval !== "lifetime") {
        periodEnd = start.toISOString().replace("T", " ").replace("Z", "").split(".")[0];
      }
    }
  }

  db.prepare(
    `INSERT INTO subscribers (id, plan_id, customer_name, customer_email, status, started_at, trial_ends_at, current_period_start, current_period_end, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.plan_id,
    input.customer_name,
    input.customer_email,
    status,
    now,
    input.trial_ends_at || null,
    now,
    periodEnd,
    metadata
  );

  // Record creation event
  recordEvent(id, "created", { plan_id: input.plan_id });

  return getSubscriber(id)!;
}

export function getSubscriber(id: string): Subscriber | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM subscribers WHERE id = ?").get(id) as SubscriberRow | null;
  return row ? rowToSubscriber(row) : null;
}

export interface ListSubscribersOptions {
  plan_id?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function listSubscribers(options: ListSubscribersOptions = {}): Subscriber[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.plan_id) {
    conditions.push("plan_id = ?");
    params.push(options.plan_id);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.search) {
    conditions.push("(customer_name LIKE ? OR customer_email LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q);
  }

  let sql = "SELECT * FROM subscribers";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as SubscriberRow[];
  return rows.map(rowToSubscriber);
}

export interface UpdateSubscriberInput {
  customer_name?: string;
  customer_email?: string;
  status?: Subscriber["status"];
  trial_ends_at?: string | null;
  current_period_start?: string;
  current_period_end?: string | null;
  canceled_at?: string | null;
  metadata?: Record<string, unknown>;
}

export function updateSubscriber(id: string, input: UpdateSubscriberInput): Subscriber | null {
  const db = getDatabase();
  const existing = getSubscriber(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.customer_name !== undefined) {
    sets.push("customer_name = ?");
    params.push(input.customer_name);
  }
  if (input.customer_email !== undefined) {
    sets.push("customer_email = ?");
    params.push(input.customer_email);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.trial_ends_at !== undefined) {
    sets.push("trial_ends_at = ?");
    params.push(input.trial_ends_at);
  }
  if (input.current_period_start !== undefined) {
    sets.push("current_period_start = ?");
    params.push(input.current_period_start);
  }
  if (input.current_period_end !== undefined) {
    sets.push("current_period_end = ?");
    params.push(input.current_period_end);
  }
  if (input.canceled_at !== undefined) {
    sets.push("canceled_at = ?");
    params.push(input.canceled_at);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE subscribers SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getSubscriber(id);
}

export function deleteSubscriber(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM subscribers WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Events ---

export function recordEvent(
  subscriberId: string,
  type: SubscriptionEvent["type"],
  details: Record<string, unknown> = {}
): SubscriptionEvent {
  const db = getDatabase();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO events (id, subscriber_id, type, details) VALUES (?, ?, ?, ?)`
  ).run(id, subscriberId, type, JSON.stringify(details));

  return getEvent(id)!;
}

export function getEvent(id: string): SubscriptionEvent | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRow | null;
  return row ? rowToEvent(row) : null;
}

export interface ListEventsOptions {
  subscriber_id?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

export function listEvents(options: ListEventsOptions = {}): SubscriptionEvent[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.subscriber_id) {
    conditions.push("subscriber_id = ?");
    params.push(options.subscriber_id);
  }

  if (options.type) {
    conditions.push("type = ?");
    params.push(options.type);
  }

  let sql = "SELECT * FROM events";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY occurred_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as EventRow[];
  return rows.map(rowToEvent);
}

// --- Subscription Actions ---

export function upgradeSubscriber(subscriberId: string, newPlanId: string): Subscriber | null {
  const db = getDatabase();
  const subscriber = getSubscriber(subscriberId);
  if (!subscriber) return null;

  const newPlan = getPlan(newPlanId);
  if (!newPlan) return null;

  const oldPlanId = subscriber.plan_id;

  // Calculate new period end
  const now = new Date();
  let periodEnd: string | null = null;
  if (newPlan.interval === "monthly") {
    const end = new Date(now);
    end.setMonth(end.getMonth() + 1);
    periodEnd = end.toISOString().replace("T", " ").replace("Z", "").split(".")[0];
  } else if (newPlan.interval === "yearly") {
    const end = new Date(now);
    end.setFullYear(end.getFullYear() + 1);
    periodEnd = end.toISOString().replace("T", " ").replace("Z", "").split(".")[0];
  }

  const nowStr = now.toISOString().replace("T", " ").replace("Z", "").split(".")[0];

  db.prepare(
    `UPDATE subscribers SET plan_id = ?, status = 'active', current_period_start = ?, current_period_end = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(newPlanId, nowStr, periodEnd, subscriberId);

  recordEvent(subscriberId, "upgraded", {
    old_plan_id: oldPlanId,
    new_plan_id: newPlanId,
  });

  return getSubscriber(subscriberId);
}

export function downgradeSubscriber(subscriberId: string, newPlanId: string): Subscriber | null {
  const db = getDatabase();
  const subscriber = getSubscriber(subscriberId);
  if (!subscriber) return null;

  const newPlan = getPlan(newPlanId);
  if (!newPlan) return null;

  const oldPlanId = subscriber.plan_id;

  // Calculate new period end
  const now = new Date();
  let periodEnd: string | null = null;
  if (newPlan.interval === "monthly") {
    const end = new Date(now);
    end.setMonth(end.getMonth() + 1);
    periodEnd = end.toISOString().replace("T", " ").replace("Z", "").split(".")[0];
  } else if (newPlan.interval === "yearly") {
    const end = new Date(now);
    end.setFullYear(end.getFullYear() + 1);
    periodEnd = end.toISOString().replace("T", " ").replace("Z", "").split(".")[0];
  }

  const nowStr = now.toISOString().replace("T", " ").replace("Z", "").split(".")[0];

  db.prepare(
    `UPDATE subscribers SET plan_id = ?, status = 'active', current_period_start = ?, current_period_end = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(newPlanId, nowStr, periodEnd, subscriberId);

  recordEvent(subscriberId, "downgraded", {
    old_plan_id: oldPlanId,
    new_plan_id: newPlanId,
  });

  return getSubscriber(subscriberId);
}

export function cancelSubscriber(subscriberId: string): Subscriber | null {
  const db = getDatabase();
  const subscriber = getSubscriber(subscriberId);
  if (!subscriber) return null;

  const now = new Date().toISOString().replace("T", " ").replace("Z", "").split(".")[0];

  db.prepare(
    `UPDATE subscribers SET status = 'canceled', canceled_at = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(now, subscriberId);

  recordEvent(subscriberId, "canceled", {});

  return getSubscriber(subscriberId);
}

// --- Analytics ---

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
    WHERE s.status IN ('active', 'trialing', 'past_due')
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

export function countPlans(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM plans").get() as { count: number };
  return row.count;
}

export function countSubscribers(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM subscribers").get() as { count: number };
  return row.count;
}
