#!/usr/bin/env bun
/**
 * MCP server for microservice-billing.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { createCheckoutSession, createPortalSession } from "../lib/checkout.js";
import { getInvoice, listSubscriptionInvoices, listWorkspaceInvoices, upsertInvoice } from "../lib/invoices.js";
import { createPlan, deletePlan, getPlan, listPlans, updatePlan } from "../lib/plans.js";
import {
  cancelSubscription,
  getSubscription,
  getSubscriptionByStripeId,
  getWorkspaceSubscription,
  listSubscriptions,
  pauseSubscription,
  resumeSubscription,
  updateSubscriptionStatus,
  upsertSubscription,
} from "../lib/subscriptions.js";
import {
  addCredit,
  createCoupon,
  getCouponByCode,
  getCredits,
  redeemCoupon,
} from "../lib/coupons.js";
import { getRevenueMetrics } from "../lib/analytics.js";
import { isActive, isTrialing, daysUntilRenewal } from "../lib/helpers.js";
import { VALID_CURRENCIES, VALID_INTERVALS, validatePlanData } from "../lib/plans.js";

const server = new McpServer({
  name: "microservice-billing",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

server.tool(
  "billing_list_plans",
  "List billing plans",
  { active_only: z.boolean().optional().default(false) },
  async ({ active_only }) => text(await listPlans(sql, { activeOnly: active_only })),
);

server.tool(
  "billing_get_plan",
  "Get a billing plan by ID",
  { id: z.string() },
  async ({ id }) => text(await getPlan(sql, id)),
);

server.tool(
  "billing_create_plan",
  "Create a billing plan",
  {
    name: z.string(),
    description: z.string().optional(),
    amount_cents: z.number(),
    currency: z.string().optional().default("usd"),
    interval: z.enum(["month", "year", "one_time"]).optional().default("month"),
    stripe_price_id: z.string().optional(),
    active: z.boolean().optional().default(true),
  },
  async (planData) => text(await createPlan(sql, planData as any)),
);

server.tool(
  "billing_get_subscription",
  "Get a subscription by ID",
  { id: z.string() },
  async ({ id }) => text(await getSubscription(sql, id)),
);

server.tool(
  "billing_get_workspace_subscription",
  "Get the active subscription for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await getWorkspaceSubscription(sql, workspace_id)),
);

server.tool(
  "billing_list_invoices",
  "List invoices for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await listWorkspaceInvoices(sql, workspace_id)),
);

server.tool(
  "billing_create_checkout_session",
  "Create a Stripe checkout session for a subscription",
  {
    workspace_id: z.string(),
    user_id: z.string(),
    plan_id: z.string(),
    success_url: z.string().url(),
    cancel_url: z.string().url(),
  },
  async ({ workspace_id, user_id, plan_id, success_url, cancel_url }) => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) throw new Error("STRIPE_SECRET_KEY is not set");
    const plan = await getPlan(sql, plan_id);
    return text(
      await createCheckoutSession({
        workspaceId: workspace_id,
        userId: user_id,
        planId: plan_id,
        successUrl: success_url,
        cancelUrl: cancel_url,
        stripeSecretKey,
        stripePriceId: plan?.stripe_price_id ?? undefined,
      }),
    );
  },
);

server.tool(
  "billing_cancel_subscription",
  "Cancel a subscription immediately or at period end",
  {
    subscription_id: z.string(),
    immediately: z.boolean().optional().default(false),
  },
  async ({ subscription_id, immediately }) => {
    const sub = await getSubscription(sql, subscription_id);
    if (!sub) throw new Error(`Subscription not found: ${subscription_id}`);
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (stripeSecretKey && sub.stripe_subscription_id) {
      if (immediately) {
        await fetch(
          `https://api.stripe.com/v1/subscriptions/${sub.stripe_subscription_id}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${stripeSecretKey}` },
          },
        );
      } else {
        const params = new URLSearchParams({ cancel_at_period_end: "true" });
        await fetch(
          `https://api.stripe.com/v1/subscriptions/${sub.stripe_subscription_id}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${stripeSecretKey}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params.toString(),
          },
        );
      }
    }
    return text(await cancelSubscription(sql, subscription_id, !immediately));
  },
);

server.tool(
  "billing_update_plan",
  "Update a billing plan",
  {
    id: z.string(),
    name: z.string().optional(),
    active: z.boolean().optional(),
  },
  async ({ id, ...updates }) => text(await updatePlan(sql, id, updates)),
);

server.tool(
  "billing_get_invoice",
  "Get an invoice by ID",
  { id: z.string() },
  async ({ id }) => text(await getInvoice(sql, id)),
);

server.tool(
  "billing_pause_subscription",
  "Pause an active subscription",
  { id: z.string() },
  async ({ id }) => text(await pauseSubscription(sql, id)),
);

server.tool(
  "billing_resume_subscription",
  "Resume a paused subscription",
  { id: z.string() },
  async ({ id }) => text(await resumeSubscription(sql, id)),
);

server.tool(
  "billing_create_coupon",
  "Create a new coupon",
  {
    code: z.string(),
    discount_type: z.enum(["percent", "fixed"]),
    discount_value: z.number(),
    currency: z.string().optional(),
    max_redemptions: z.number().optional(),
    expires_at: z.string().optional(),
    metadata: z.record(z.any()).optional(),
  },
  async (data) => text(await createCoupon(sql, data as any)),
);

server.tool(
  "billing_redeem_coupon",
  "Redeem a coupon for a subscription",
  {
    coupon_id: z.string(),
    subscription_id: z.string(),
    workspace_id: z.string(),
  },
  async ({ coupon_id, subscription_id, workspace_id }) =>
    text(await redeemCoupon(sql, coupon_id, subscription_id, workspace_id)),
);

server.tool(
  "billing_get_coupon",
  "Get a coupon by code",
  { code: z.string() },
  async ({ code }) => text(await getCouponByCode(sql, code)),
);

server.tool(
  "billing_add_credit",
  "Add credit to a workspace",
  {
    workspace_id: z.string(),
    amount_cents: z.number(),
    reason: z.string().optional(),
    applied_to: z.string().optional(),
  },
  async ({ workspace_id, amount_cents, reason, applied_to }) =>
    text(await addCredit(sql, workspace_id, amount_cents, reason, applied_to)),
);

server.tool(
  "billing_get_credits",
  "Get credit balance and history for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await getCredits(sql, workspace_id)),
);

server.tool(
  "billing_get_revenue_metrics",
  "Get revenue metrics (MRR, ARR, churn, etc.)",
  {
    currency: z.string().optional(),
    since: z.string().optional(),
  },
  async ({ currency, since }) => text(await getRevenueMetrics(sql, { currency, since })),
);

// ─── Subscription Management ───────────────────────────────────────────────────

server.tool(
  "billing_list_subscriptions",
  "List all subscriptions for a workspace or globally",
  {
    workspace_id: z.string().optional(),
    status: z.string().optional(),
    limit: z.number().optional(),
  },
  async ({ workspace_id, status, limit }) =>
    text(await listSubscriptions(sql, { workspaceId: workspace_id, status, limit })),
);

server.tool(
  "billing_upsert_subscription",
  "Create or update a subscription record",
  {
    workspace_id: z.string(),
    plan_id: z.string(),
    status: z.enum(["active", "past_due", "canceled", "paused", "trialing"]).optional().default("active"),
    stripe_subscription_id: z.string().optional(),
    current_period_start: z.string().optional(),
    current_period_end: z.string().optional(),
    cancel_at_period_end: z.boolean().optional().default(false),
  },
  async (data) => text(await upsertSubscription(sql, data as any)),
);

server.tool(
  "billing_update_subscription_status",
  "Update the status field of an existing subscription (targeted status change)",
  {
    id: z.string(),
    status: z.enum(["active", "past_due", "canceled", "paused", "trialing"]),
  },
  async ({ id, status }) => text(await updateSubscriptionStatus(sql, id, status)),
);

server.tool(
  "billing_get_by_stripe_id",
  "Look up a subscription by its Stripe subscription ID",
  { stripe_subscription_id: z.string() },
  async ({ stripe_subscription_id }) =>
    text(await getSubscriptionByStripeId(sql, stripe_subscription_id)),
);

// ─── Checkout / Portal ─────────────────────────────────────────────────────────

server.tool(
  "billing_create_portal_session",
  "Create a Stripe customer portal session for billing management",
  {
    workspace_id: z.string(),
    return_url: z.string().url(),
  },
  async ({ workspace_id, return_url }) => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) throw new Error("STRIPE_SECRET_KEY is not set");
    return text(await createPortalSession({ workspaceId: workspace_id, returnUrl: return_url, stripeSecretKey }));
  },
);

// ─── Invoice Management ───────────────────────────────────────────────────────

server.tool(
  "billing_list_subscription_invoices",
  "List invoices for a specific subscription",
  {
    subscription_id: z.string(),
    status: z.string().optional(),
  },
  async ({ subscription_id, status }) =>
    text(await listSubscriptionInvoices(sql, subscription_id, status)),
);

server.tool(
  "billing_upsert_invoice",
  "Create or update an invoice record manually",
  {
    workspace_id: z.string(),
    amount_cents: z.number(),
    status: z.enum(["draft", "open", "paid", "void", "uncollectible"]).optional().default("open"),
    description: z.string().optional(),
    due_date: z.string().optional(),
    stripe_invoice_id: z.string().optional(),
    metadata: z.record(z.any()).optional(),
  },
  async (data) => text(await upsertInvoice(sql, data as any)),
);

// ─── Plan Management ──────────────────────────────────────────────────────────

server.tool(
  "billing_delete_plan",
  "Soft-delete (deactivate) a billing plan",
  { id: z.string() },
  async ({ id }) => text({ deleted: await deletePlan(sql, id) }),
);

// ─── Subscription Helpers ────────────────────────────────────────────────────

server.tool(
  "billing_is_active",
  "Check if a subscription is currently active or trialing",
  { id: z.string() },
  async ({ id }) => {
    const sub = await getSubscription(sql, id);
    return text({ is_active: sub ? isActive(sub as any) : false });
  },
);

server.tool(
  "billing_is_trialing",
  "Check if a subscription is in trialing status",
  { id: z.string() },
  async ({ id }) => {
    const sub = await getSubscription(sql, id);
    return text({ is_trialing: sub ? isTrialing(sub as any) : false });
  },
);

server.tool(
  "billing_days_until_renewal",
  "Calculate days remaining until subscription renewal",
  { id: z.string() },
  async ({ id }) => {
    const sub = await getSubscription(sql, id);
    if (!sub) return text({ error: "Subscription not found" });
    return text({ days_until_renewal: daysUntilRenewal(sub as any) });
  },
);

server.tool(
  "billing_validate_plan",
  "Validate plan creation/update data and return any errors",
  {
    name: z.string().optional(),
    amount_cents: z.number().optional(),
    currency: z.string().optional(),
    interval: z.enum(["month", "year", "one_time"]).optional(),
  },
  async (data) => text({ valid: true, errors: validatePlanData(data as any) }),
);

server.tool(
  "billing_valid_currencies_intervals",
  "Return the list of valid currencies and billing intervals",
  {},
  async () => text({ currencies: VALID_CURRENCIES, intervals: VALID_INTERVALS }),
);

// ─── Analytics & Forecasting ───────────────────────────────────────────────────────

server.tool(
  "billing_get_usage_breakdown",
  "Get a breakdown of subscription counts and revenue by plan and status for a given period",
  {
    currency: z.string().optional().default("usd"),
    since: z.string().optional(),
    until: z.string().optional(),
  },
  async ({ currency, since, until }) => {
    const sinceDate = since ?? new Date(Date.now() - 30 * 86400000).toISOString();
    const untilDate = until ?? new Date().toISOString();
    const breakdown = await sql`
      SELECT
        p.name as plan_name,
        p.amount_cents,
        p.interval,
        s.status,
        COUNT(*)::int as subscription_count,
        SUM(p.amount_cents)::int as total_cents
      FROM billing.subscriptions s
      JOIN billing.plans p ON s.plan_id = p.id
      WHERE p.currency = ${currency ?? "usd"}
        AND s.created_at BETWEEN ${sinceDate} AND ${untilDate}
      GROUP BY p.name, p.amount_cents, p.interval, s.status
      ORDER BY total_cents DESC`;
    return text({ currency, period_from: sinceDate, period_to: untilDate, breakdown });
  },
);

server.tool(
  "billing_get_subscription_health",
  "Get an overall health summary of all subscriptions — at-risk, near-renewal, trial expiring",
  { workspace_id: z.string().optional() },
  async ({ workspace_id }) => {
    const whereClause = workspace_id
      ? sql`WHERE workspace_id = ${workspace_id}`
      : sql``;
    const [atRisk] = await sql<{ cnt: string }>`
      SELECT COUNT(*)::text as cnt FROM billing.subscriptions
      ${whereClause} AND status IN ('past_due', 'canceled')`;
    const [nearRenewal] = await sql<{ cnt: string }>`
      SELECT COUNT(*)::text as cnt FROM billing.subscriptions
      ${whereClause} AND status IN ('active', 'trialing')
        AND current_period_end BETWEEN NOW() AND NOW() + INTERVAL '7 days'`;
    const [trialExpiring] = await sql<{ cnt: string }>`
      SELECT COUNT(*)::text as cnt FROM billing.subscriptions
      ${whereClause} AND status = 'trialing'
        AND current_period_end BETWEEN NOW() AND NOW() + INTERVAL '3 days'`;
    const [totalActive] = await sql<{ cnt: string }>`
      SELECT COUNT(*)::text as cnt FROM billing.subscriptions
      ${whereClause} WHERE status IN ('active', 'trialing')`;
    const healthScore = Math.max(0, 100 - parseInt(atRisk.cnt, 10) * 10 - parseInt(trialExpiring.cnt, 10) * 5);
    return text({
      total_active: parseInt(totalActive.cnt, 10),
      at_risk_count: parseInt(atRisk.cnt, 10),
      near_renewal_7d: parseInt(nearRenewal.cnt, 10),
      trial_expiring_3d: parseInt(trialExpiring.cnt, 10),
      health_score: healthScore,
      health_label: healthScore >= 80 ? "healthy" : healthScore >= 50 ? "warning" : "critical",
    });
  },
);

server.tool(
  "billing_get_mrr_trend",
  "Get MRR (Monthly Recurring Revenue) trend over time, grouped by period",
  {
    currency: z.string().optional().default("usd"),
    period: z.enum(["day", "week", "month"]).optional().default("month"),
    months: z.number().optional().default(12),
  },
  async ({ currency, period, months }) => {
    const interval = period ?? "month";
    const since = new Date(Date.now() - (months ?? 12) * 30 * 86400000).toISOString();
    const trunc = interval === "day" ? "day" : interval === "week" ? "week" : "month";
    const trend = await sql`
      SELECT
        DATE_TRUNC(${trunc}, s.created_at)::text as period,
        COUNT(*)::int as new_subscriptions,
        SUM(CASE WHEN p.interval = 'month' THEN p.amount_cents
                 WHEN p.interval = 'year' THEN p.amount_cents / 12
                 ELSE 0 END)::int as mrr_cents
      FROM billing.subscriptions s
      JOIN billing.plans p ON s.plan_id = p.id
      WHERE p.currency = ${currency ?? "usd"}
        AND s.created_at >= ${since}
        AND s.status IN ('active', 'trialing')
      GROUP BY DATE_TRUNC(${trunc}, s.created_at)
      ORDER BY period ASC`;
    return text({ currency, period: interval, trend });
  },
);

server.tool(
  "billing_estimate_next_invoice",
  "Estimate the next invoice amount for a workspace's active subscription",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const [sub] = await sql`
      SELECT s.*, p.amount_cents, p.interval, p.currency
      FROM billing.subscriptions s
      JOIN billing.plans p ON s.plan_id = p.id
      WHERE s.workspace_id = ${workspace_id}
        AND s.status IN ('active', 'trialing')
      ORDER BY s.created_at DESC LIMIT 1`;
    if (!sub) return text({ estimable: false, message: "No active subscription found" });
    const amountDue = sub.interval === "month"
      ? sub.amount_cents
      : sub.interval === "year"
        ? Math.round(sub.amount_cents / 12)
        : sub.amount_cents;
    return text({
      estimable: true,
      workspace_id,
      amount_cents: amountDue,
      currency: sub.currency,
      interval: sub.interval,
      period_start: sub.current_period_start,
      period_end: sub.current_period_end,
      note: "Excludes taxes, discounts, and usage-based charges",
    });
  },
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
