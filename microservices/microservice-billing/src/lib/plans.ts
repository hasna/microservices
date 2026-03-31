import type { Sql } from "postgres";

export type PlanInterval = "month" | "year" | "one_time";

export interface Plan {
  id: string;
  name: string;
  description: string;
  amount_cents: number;
  currency: string;
  interval: PlanInterval;
  stripe_price_id: string | null;
  active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CreatePlanData {
  name: string;
  description?: string;
  amount_cents: number;
  currency?: string;
  interval?: PlanInterval;
  stripe_price_id?: string;
  active?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdatePlanData {
  name?: string;
  description?: string;
  amount_cents?: number;
  currency?: string;
  interval?: PlanInterval;
  stripe_price_id?: string;
  active?: boolean;
  metadata?: Record<string, unknown>;
}

export const VALID_CURRENCIES = ["usd", "eur", "gbp", "cad", "aud", "jpy", "chf", "sek", "nok", "dkk"];
export const VALID_INTERVALS: PlanInterval[] = ["month", "year", "one_time"];

export function validatePlanData(data: CreatePlanData): string[] {
  const errors: string[] = [];
  if (!data.name || data.name.trim().length === 0) errors.push("name is required");
  if (typeof data.amount_cents !== "number" || data.amount_cents < 0) errors.push("amount_cents must be a non-negative number");
  if (!Number.isInteger(data.amount_cents)) errors.push("amount_cents must be an integer");
  if (data.currency && !VALID_CURRENCIES.includes(data.currency.toLowerCase())) errors.push(`currency must be one of: ${VALID_CURRENCIES.join(", ")}`);
  if (data.interval && !VALID_INTERVALS.includes(data.interval)) errors.push(`interval must be one of: ${VALID_INTERVALS.join(", ")}`);
  return errors;
}

export async function createPlan(sql: Sql, data: CreatePlanData): Promise<Plan> {
  const errors = validatePlanData(data);
  if (errors.length > 0) throw new Error(`Invalid plan data: ${errors.join("; ")}`);
  const [plan] = await sql<Plan[]>`
    INSERT INTO billing.plans (name, description, amount_cents, currency, interval, stripe_price_id, active, metadata)
    VALUES (
      ${data.name.trim()},
      ${data.description ?? ""},
      ${data.amount_cents},
      ${(data.currency ?? "usd").toLowerCase()},
      ${data.interval ?? "month"},
      ${data.stripe_price_id ?? null},
      ${data.active ?? true},
      ${JSON.stringify(data.metadata ?? {})}
    )
    RETURNING *`;
  return plan;
}

export async function getPlan(sql: Sql, id: string): Promise<Plan | null> {
  const [plan] = await sql<Plan[]>`SELECT * FROM billing.plans WHERE id = ${id}`;
  return plan ?? null;
}

export async function listPlans(sql: Sql, opts?: { activeOnly?: boolean }): Promise<Plan[]> {
  if (opts?.activeOnly) {
    return sql<Plan[]>`SELECT * FROM billing.plans WHERE active = true ORDER BY amount_cents ASC`;
  }
  return sql<Plan[]>`SELECT * FROM billing.plans ORDER BY amount_cents ASC`;
}

export async function updatePlan(sql: Sql, id: string, data: UpdatePlanData): Promise<Plan | null> {
  const [plan] = await sql<Plan[]>`
    UPDATE billing.plans SET
      name = COALESCE(${data.name ?? null}, name),
      description = COALESCE(${data.description ?? null}, description),
      amount_cents = COALESCE(${data.amount_cents ?? null}, amount_cents),
      currency = COALESCE(${data.currency ? data.currency.toLowerCase() : null}, currency),
      interval = COALESCE(${data.interval ?? null}, interval),
      stripe_price_id = COALESCE(${data.stripe_price_id ?? null}, stripe_price_id),
      active = COALESCE(${data.active ?? null}, active),
      metadata = COALESCE(${data.metadata ? JSON.stringify(data.metadata) : null}::jsonb, metadata)
    WHERE id = ${id}
    RETURNING *`;
  return plan ?? null;
}

export async function deletePlan(sql: Sql, id: string): Promise<boolean> {
  const r = await sql`DELETE FROM billing.plans WHERE id = ${id}`;
  return r.count > 0;
}
