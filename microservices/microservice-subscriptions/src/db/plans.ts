/**
 * Plans CRUD operations and comparison
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

export function rowToPlan(row: PlanRow): Plan {
  return {
    ...row,
    interval: row.interval as Plan["interval"],
    features: JSON.parse(row.features || "[]"),
    active: row.active === 1,
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

export function countPlans(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM plans").get() as { count: number };
  return row.count;
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
