#!/usr/bin/env bun
/**
 * MCP server for microservice-billing.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { createCheckoutSession } from "../lib/checkout.js";
import { getInvoice, listWorkspaceInvoices } from "../lib/invoices.js";
import { createPlan, getPlan, listPlans, updatePlan } from "../lib/plans.js";
import {
  cancelSubscription,
  getSubscription,
  getWorkspaceSubscription,
} from "../lib/subscriptions.js";

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

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
