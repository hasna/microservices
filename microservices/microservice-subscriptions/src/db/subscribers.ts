/**
 * Subscribers CRUD and lifecycle actions
 */

import { getDatabase } from "./database.js";
import { getPlan } from "./plans.js";
import { recordEvent } from "./events.js";

// --- Types ---

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

export interface SubscriberRow {
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

export function rowToSubscriber(row: SubscriberRow): Subscriber {
  return {
    ...row,
    status: row.status as Subscriber["status"],
    metadata: JSON.parse(row.metadata || "{}"),
  };
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

export function countSubscribers(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM subscribers").get() as { count: number };
  return row.count;
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

// --- Pause/Resume ---

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
