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
  status: "trialing" | "active" | "past_due" | "canceled" | "expired" | "paused";
  started_at: string;
  trial_ends_at: string | null;
  current_period_start: string;
  current_period_end: string | null;
  canceled_at: string | null;
  resume_at: string | null;
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
  resume_at: string | null;
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
  type: "created" | "upgraded" | "downgraded" | "canceled" | "renewed" | "payment_failed" | "paused" | "resumed" | "trial_extended";
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

// --- Subscription Pause/Resume ---

export function pauseSubscriber(id: string, resumeDate?: string): Subscriber | null {
  const db = getDatabase();
  const subscriber = getSubscriber(id);
  if (!subscriber) return null;
  if (subscriber.status === "canceled" || subscriber.status === "expired") return null;

  const resumeAt = resumeDate || null;

  db.prepare(
    `UPDATE subscribers SET status = 'paused', resume_at = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(resumeAt, id);

  recordEvent(id, "paused", { resume_at: resumeAt });

  return getSubscriber(id);
}

export function resumeSubscriber(id: string): Subscriber | null {
  const db = getDatabase();
  const subscriber = getSubscriber(id);
  if (!subscriber) return null;
  if (subscriber.status !== "paused") return null;

  db.prepare(
    `UPDATE subscribers SET status = 'active', resume_at = NULL, updated_at = datetime('now') WHERE id = ?`
  ).run(id);

  recordEvent(id, "resumed", {});

  return getSubscriber(id);
}

// --- Trial Extension ---

export function extendTrial(id: string, days: number): Subscriber | null {
  const db = getDatabase();
  const subscriber = getSubscriber(id);
  if (!subscriber) return null;

  let baseDate: Date;
  if (subscriber.trial_ends_at) {
    baseDate = new Date(subscriber.trial_ends_at.replace(" ", "T") + "Z");
  } else {
    baseDate = new Date();
  }

  baseDate.setDate(baseDate.getDate() + days);
  const newTrialEnd = baseDate.toISOString().replace("T", " ").replace("Z", "").split(".")[0];

  db.prepare(
    `UPDATE subscribers SET trial_ends_at = ?, status = 'trialing', updated_at = datetime('now') WHERE id = ?`
  ).run(newTrialEnd, id);

  recordEvent(id, "trial_extended", { days, new_trial_ends_at: newTrialEnd });

  return getSubscriber(id);
}

// --- Dunning ---

export interface DunningAttempt {
  id: string;
  subscriber_id: string;
  attempt_number: number;
  status: "pending" | "retrying" | "failed" | "recovered";
  next_retry_at: string | null;
  created_at: string;
}

interface DunningRow {
  id: string;
  subscriber_id: string;
  attempt_number: number;
  status: string;
  next_retry_at: string | null;
  created_at: string;
}

function rowToDunning(row: DunningRow): DunningAttempt {
  return {
    ...row,
    status: row.status as DunningAttempt["status"],
  };
}

export interface CreateDunningInput {
  subscriber_id: string;
  attempt_number?: number;
  status?: DunningAttempt["status"];
  next_retry_at?: string;
}

export function createDunning(input: CreateDunningInput): DunningAttempt {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const attemptNumber = input.attempt_number || 1;
  const status = input.status || "pending";
  const nextRetryAt = input.next_retry_at || null;

  db.prepare(
    `INSERT INTO dunning_attempts (id, subscriber_id, attempt_number, status, next_retry_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, input.subscriber_id, attemptNumber, status, nextRetryAt);

  return getDunning(id)!;
}

export function getDunning(id: string): DunningAttempt | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM dunning_attempts WHERE id = ?").get(id) as DunningRow | null;
  return row ? rowToDunning(row) : null;
}

export interface ListDunningOptions {
  subscriber_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export function listDunning(options: ListDunningOptions = {}): DunningAttempt[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.subscriber_id) {
    conditions.push("subscriber_id = ?");
    params.push(options.subscriber_id);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  let sql = "SELECT * FROM dunning_attempts";
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

  const rows = db.prepare(sql).all(...params) as DunningRow[];
  return rows.map(rowToDunning);
}

export interface UpdateDunningInput {
  status?: DunningAttempt["status"];
  next_retry_at?: string | null;
}

export function updateDunning(id: string, input: UpdateDunningInput): DunningAttempt | null {
  const db = getDatabase();
  const existing = getDunning(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.next_retry_at !== undefined) {
    sets.push("next_retry_at = ?");
    params.push(input.next_retry_at);
  }

  if (sets.length === 0) return existing;

  params.push(id);

  db.prepare(
    `UPDATE dunning_attempts SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getDunning(id);
}

// --- Bulk Import/Export ---

export interface BulkImportSubscriberInput {
  plan_id: string;
  customer_name: string;
  customer_email: string;
  status?: Subscriber["status"];
  trial_ends_at?: string;
  current_period_end?: string;
  metadata?: Record<string, unknown>;
}

export function bulkImportSubscribers(data: BulkImportSubscriberInput[]): Subscriber[] {
  const results: Subscriber[] = [];
  for (const item of data) {
    const subscriber = createSubscriber(item);
    results.push(subscriber);
  }
  return results;
}

export function exportSubscribers(format: "csv" | "json" = "json"): string {
  const subscribers = listSubscribers();

  if (format === "json") {
    return JSON.stringify(subscribers, null, 2);
  }

  // CSV format
  if (subscribers.length === 0) return "";

  const headers = [
    "id", "plan_id", "customer_name", "customer_email", "status",
    "started_at", "trial_ends_at", "current_period_start", "current_period_end",
    "canceled_at", "resume_at", "created_at", "updated_at",
  ];

  const csvRows = [headers.join(",")];
  for (const sub of subscribers) {
    const row = headers.map((h) => {
      const val = sub[h as keyof Subscriber];
      if (val === null || val === undefined) return "";
      if (typeof val === "object") return JSON.stringify(val).replace(/,/g, ";");
      return String(val).includes(",") ? `"${String(val)}"` : String(val);
    });
    csvRows.push(row.join(","));
  }
  return csvRows.join("\n");
}

export function parseImportCsv(csvContent: string): BulkImportSubscriberInput[] {
  const lines = csvContent.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim());
  const results: BulkImportSubscriberInput[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const record: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = values[j] || "";
    }

    if (!record["plan_id"] || !record["customer_name"] || !record["customer_email"]) continue;

    results.push({
      plan_id: record["plan_id"],
      customer_name: record["customer_name"],
      customer_email: record["customer_email"],
      status: (record["status"] as Subscriber["status"]) || undefined,
      trial_ends_at: record["trial_ends_at"] || undefined,
      current_period_end: record["current_period_end"] || undefined,
    });
  }

  return results;
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

  // Start MRR: sum of active subscribers at start of month (those created before month start and not canceled before it)
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

// --- Plan Comparison ---

export interface PlanComparison {
  plan1: Plan;
  plan2: Plan;
  price_diff: number;
  price_diff_pct: number;
  features_only_in_plan1: string[];
  features_only_in_plan2: string[];
  common_features: string[];
  interval_match: boolean;
}

export function comparePlans(id1: string, id2: string): PlanComparison | null {
  const plan1 = getPlan(id1);
  const plan2 = getPlan(id2);
  if (!plan1 || !plan2) return null;

  const features1 = new Set(plan1.features);
  const features2 = new Set(plan2.features);

  const commonFeatures = plan1.features.filter((f) => features2.has(f));
  const onlyIn1 = plan1.features.filter((f) => !features2.has(f));
  const onlyIn2 = plan2.features.filter((f) => !features1.has(f));

  const priceDiff = Math.round((plan2.price - plan1.price) * 100) / 100;
  const priceDiffPct = plan1.price > 0
    ? Math.round(((plan2.price - plan1.price) / plan1.price) * 100 * 100) / 100
    : 0;

  return {
    plan1,
    plan2,
    price_diff: priceDiff,
    price_diff_pct: priceDiffPct,
    features_only_in_plan1: onlyIn1,
    features_only_in_plan2: onlyIn2,
    common_features: commonFeatures,
    interval_match: plan1.interval === plan2.interval,
  };
}

// --- Expiring Renewals (alias for listExpiring with explicit name) ---

export function getExpiringRenewals(days: number = 7): Subscriber[] {
  return listExpiring(days);
}
