import type { Sql } from "postgres";

export interface Coupon {
  id: string;
  code: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  currency: string | null;
  max_redemptions: number | null;
  redemption_count: number;
  expires_at: string | null;
  active: boolean;
  metadata: any;
  created_at: string;
}

export async function createCoupon(
  sql: Sql,
  data: {
    code: string;
    discount_type: "percent" | "fixed";
    discount_value: number;
    currency?: string;
    max_redemptions?: number;
    expires_at?: string;
    metadata?: any;
  },
): Promise<Coupon> {
  if (data.discount_type === "percent" && (data.discount_value < 0 || data.discount_value > 100)) {
    throw new Error("Percent discount must be between 0 and 100");
  }
  const [coupon] = await sql<Coupon[]>`
    INSERT INTO billing.coupons (code, discount_type, discount_value, currency, max_redemptions, expires_at, metadata)
    VALUES (${data.code}, ${data.discount_type}, ${data.discount_value},
            ${data.currency ?? null}, ${data.max_redemptions ?? null},
            ${data.expires_at ?? null}, ${JSON.stringify(data.metadata ?? {})})
    RETURNING *`;
  return coupon;
}

export async function getCouponByCode(
  sql: Sql,
  code: string,
): Promise<Coupon | null> {
  const [c] = await sql<Coupon[]>`SELECT * FROM billing.coupons WHERE code = ${code} AND active = true`;
  return c ?? null;
}

export async function redeemCoupon(
  sql: Sql,
  couponId: string,
  subscriptionId: string,
  workspaceId: string,
): Promise<{ redeemed: boolean }> {
  // Check if coupon is valid
  const [coupon] = await sql<Coupon[]>`SELECT * FROM billing.coupons WHERE id = ${couponId} AND active = true`;
  if (!coupon) throw new Error("Coupon not found or inactive");
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) throw new Error("Coupon has expired");
  if (coupon.max_redemptions !== null && coupon.redemption_count >= coupon.max_redemptions) {
    throw new Error("Coupon max redemptions reached");
  }
  // Increment redemption count and record
  await sql`UPDATE billing.coupons SET redemption_count = redemption_count + 1 WHERE id = ${couponId}`;
  await sql`INSERT INTO billing.coupon_redemptions (coupon_id, subscription_id, workspace_id) VALUES (${couponId}, ${subscriptionId}, ${workspaceId})`;
  return { redeemed: true };
}

export async function addCredit(
  sql: Sql,
  workspaceId: string,
  amountCents: number,
  reason?: string,
  appliedTo?: string,
): Promise<{ balance: number }> {
  await sql`INSERT INTO billing.credits (workspace_id, amount_cents, reason, applied_to) VALUES (${workspaceId}, ${amountCents}, ${reason ?? null}, ${appliedTo ?? null})`;
  const [{ balance }] = await sql<[{ balance: number }]>`SELECT COALESCE(SUM(amount_cents), 0) as balance FROM billing.credits WHERE workspace_id = ${workspaceId}`;
  return { balance };
}

export async function getCredits(
  sql: Sql,
  workspaceId: string,
): Promise<{ total_credits: number; history: { amount_cents: number; reason: string | null; created_at: string }[] }> {
  const [balance] = await sql<[{ balance: number }]>`SELECT COALESCE(SUM(amount_cents), 0) as balance FROM billing.credits WHERE workspace_id = ${workspaceId}`;
  const history = await sql`SELECT amount_cents, reason, created_at FROM billing.credits WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC LIMIT 50`;
  return { total_credits: balance.balance, history };
}