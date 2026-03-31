import type { Sql } from "postgres";
import { createPlan, getPlan, listPlans } from "../lib/plans.js";
import { getSubscription, getWorkspaceSubscription, listSubscriptions } from "../lib/subscriptions.js";
import { listWorkspaceInvoices } from "../lib/invoices.js";
import { handleStripeWebhook, WebhookSignatureError } from "../lib/stripe-webhooks.js";
import { createCheckoutSession, createPortalSession } from "../lib/checkout.js";

export function makeRouter(sql: Sql) {
  return async function router(req: Request): Promise<Response> {
    const url = new URL(req.url); const p = url.pathname; const m = req.method;
    try {
      if (m === "GET" && p === "/health") return json({ ok: true, service: "microservice-billing" });

      // Plans
      if (m === "POST" && p === "/billing/plans") {
        const body = await req.json();
        return json(await createPlan(sql, body), 201);
      }
      if (m === "GET" && p === "/billing/plans") {
        const activeOnly = url.searchParams.get("active") === "true";
        return json(await listPlans(sql, { activeOnly }));
      }
      if (m === "GET" && p.match(/^\/billing\/plans\/[^/]+$/)) {
        const id = p.split("/").pop()!;
        const plan = await getPlan(sql, id);
        return plan ? json(plan) : json({ error: "Not found" }, 404);
      }

      // Subscriptions
      if (m === "GET" && p.match(/^\/billing\/subscriptions\/[^/]+$/)) {
        const id = p.split("/").pop()!;
        const sub = await getSubscription(sql, id);
        return sub ? json(sub) : json({ error: "Not found" }, 404);
      }
      if (m === "GET" && p.match(/^\/billing\/workspaces\/[^/]+\/subscription$/)) {
        const workspaceId = p.split("/")[3];
        const sub = await getWorkspaceSubscription(sql, workspaceId);
        return sub ? json(sub) : json({ error: "No active subscription" }, 404);
      }

      // Invoices
      if (m === "GET" && p === "/billing/invoices") {
        const workspaceId = url.searchParams.get("workspace_id");
        if (!workspaceId) return json({ error: "workspace_id required" }, 400);
        return json(await listWorkspaceInvoices(sql, workspaceId));
      }

      // Checkout
      if (m === "POST" && p === "/billing/checkout") {
        const body = await req.json() as Record<string, string>;
        const stripeKey = body["stripe_secret_key"] ?? process.env["STRIPE_SECRET_KEY"] ?? "";
        if (!stripeKey) return json({ error: "STRIPE_SECRET_KEY required" }, 400);
        const result = await createCheckoutSession({
          workspaceId: body["workspace_id"] ?? "",
          userId: body["user_id"] ?? "",
          planId: body["plan_id"] ?? "",
          successUrl: body["success_url"] ?? "",
          cancelUrl: body["cancel_url"] ?? "",
          stripeSecretKey: stripeKey,
          stripePriceId: body["stripe_price_id"],
          stripeCustomerId: body["stripe_customer_id"],
          trialPeriodDays: body["trial_period_days"] ? parseInt(body["trial_period_days"], 10) : undefined,
        });
        return json(result);
      }

      // Portal
      if (m === "POST" && p === "/billing/portal") {
        const body = await req.json() as Record<string, string>;
        const stripeKey = body["stripe_secret_key"] ?? process.env["STRIPE_SECRET_KEY"] ?? "";
        if (!stripeKey) return json({ error: "STRIPE_SECRET_KEY required" }, 400);
        const result = await createPortalSession(
          body["customer_id"] ?? "",
          body["return_url"] ?? "",
          stripeKey
        );
        return json(result);
      }

      // Webhooks
      if (m === "POST" && p === "/billing/webhooks") {
        const signature = req.headers.get("stripe-signature") ?? "";
        const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"] ?? "";
        if (!webhookSecret) return json({ error: "STRIPE_WEBHOOK_SECRET required" }, 500);
        const payload = await req.text();
        try {
          const result = await handleStripeWebhook(sql, payload, signature, webhookSecret);
          return json(result);
        } catch (err) {
          if (err instanceof WebhookSignatureError) return json({ error: err.message }, 400);
          throw err;
        }
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "Server error" }, 500);
    }
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
