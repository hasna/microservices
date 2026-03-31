import { z } from "zod";
import type { Sql } from "postgres";
import { createPlan, getPlan, listPlans } from "../lib/plans.js";
import { getSubscription, getWorkspaceSubscription, listSubscriptions } from "../lib/subscriptions.js";
import { listWorkspaceInvoices } from "../lib/invoices.js";
import { handleStripeWebhook, WebhookSignatureError } from "../lib/stripe-webhooks.js";
import { createCheckoutSession, createPortalSession } from "../lib/checkout.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const CreatePlanSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  amount_cents: z.number().int().positive(),
  currency: z.string().length(3).default("usd"),
  interval: z.enum(["month", "year", "one_time"]),
  stripe_price_id: z.string().optional(),
});

const CheckoutSchema = z.object({
  workspace_id: z.string(),
  user_id: z.string(),
  plan_id: z.string(),
  success_url: z.string().url(),
  cancel_url: z.string().url(),
});

const PortalSchema = z.object({
  customer_id: z.string(),
  return_url: z.string().url(),
});

export function makeRouter(sql: Sql) {
  return async function router(req: Request): Promise<Response> {
    const url = new URL(req.url); const p = url.pathname; const m = req.method;
    if (m === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    try {
      if (m === "GET" && p === "/health") {
        try {
          const start = Date.now();
          await sql`SELECT 1`;
          return json({ ok: true, service: "microservice-billing", db: true, latency_ms: Date.now() - start });
        } catch (e) {
          return json({ ok: false, service: "microservice-billing", db: false, error: e instanceof Error ? e.message : "db error" }, 503);
        }
      }

      // Plans
      if (m === "POST" && p === "/billing/plans") {
        const parsed = await parseBody(req, CreatePlanSchema);
        if ("error" in parsed) return parsed.error;
        return json(await createPlan(sql, parsed.data), 201);
      }
      if (m === "GET" && p === "/billing/plans") {
        const activeOnly = url.searchParams.get("active") === "true";
        const items = await listPlans(sql, { activeOnly });
        return json({ data: items, count: items.length });
      }
      if (m === "GET" && p.match(/^\/billing\/plans\/[^/]+$/)) {
        const id = p.split("/").pop()!;
        const plan = await getPlan(sql, id);
        return plan ? json(plan) : apiError("NOT_FOUND", "Not found", undefined, 404);
      }

      // Subscriptions
      if (m === "GET" && p === "/billing/subscriptions") {
        const items = await listSubscriptions(sql, {
          workspaceId: url.searchParams.get("workspace_id") ?? undefined,
          status: url.searchParams.get("status") as any ?? undefined,
        });
        return json({ data: items, count: items.length });
      }
      if (m === "GET" && p.match(/^\/billing\/subscriptions\/[^/]+$/)) {
        const id = p.split("/").pop()!;
        const sub = await getSubscription(sql, id);
        return sub ? json(sub) : apiError("NOT_FOUND", "Not found", undefined, 404);
      }
      if (m === "GET" && p.match(/^\/billing\/workspaces\/[^/]+\/subscription$/)) {
        const workspaceId = p.split("/")[3];
        const sub = await getWorkspaceSubscription(sql, workspaceId);
        return sub ? json(sub) : apiError("NOT_FOUND", "No active subscription", undefined, 404);
      }

      // Invoices
      if (m === "GET" && p === "/billing/invoices") {
        const workspaceId = url.searchParams.get("workspace_id");
        if (!workspaceId) return apiError("MISSING_PARAM", "workspace_id required");
        const items = await listWorkspaceInvoices(sql, workspaceId);
        return json({ data: items, count: items.length });
      }

      // Checkout
      if (m === "POST" && p === "/billing/checkout") {
        const parsed = await parseBody(req, CheckoutSchema);
        if ("error" in parsed) return parsed.error;
        const rawBody = parsed.data as any;
        const stripeKey = rawBody["stripe_secret_key"] ?? process.env["STRIPE_SECRET_KEY"] ?? "";
        if (!stripeKey) return apiError("MISSING_CONFIG", "STRIPE_SECRET_KEY required");
        const result = await createCheckoutSession({
          workspaceId: parsed.data.workspace_id,
          userId: parsed.data.user_id,
          planId: parsed.data.plan_id,
          successUrl: parsed.data.success_url,
          cancelUrl: parsed.data.cancel_url,
          stripeSecretKey: stripeKey,
          stripePriceId: rawBody["stripe_price_id"],
          stripeCustomerId: rawBody["stripe_customer_id"],
          trialPeriodDays: rawBody["trial_period_days"] ? parseInt(rawBody["trial_period_days"], 10) : undefined,
        });
        return json(result);
      }

      // Portal
      if (m === "POST" && p === "/billing/portal") {
        const parsed = await parseBody(req, PortalSchema);
        if ("error" in parsed) return parsed.error;
        const rawBody = parsed.data as any;
        const stripeKey = rawBody["stripe_secret_key"] ?? process.env["STRIPE_SECRET_KEY"] ?? "";
        if (!stripeKey) return apiError("MISSING_CONFIG", "STRIPE_SECRET_KEY required");
        const result = await createPortalSession(
          parsed.data.customer_id,
          parsed.data.return_url,
          stripeKey
        );
        return json(result);
      }

      // Webhooks
      if (m === "POST" && p === "/billing/webhooks") {
        const signature = req.headers.get("stripe-signature") ?? "";
        const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"] ?? "";
        if (!webhookSecret) return apiError("MISSING_CONFIG", "STRIPE_WEBHOOK_SECRET required", undefined, 500);
        const payload = await req.text();
        try {
          const result = await handleStripeWebhook(sql, payload, signature, webhookSecret);
          return json(result);
        } catch (err) {
          if (err instanceof WebhookSignatureError) return apiError("WEBHOOK_SIGNATURE_INVALID", err.message);
          throw err;
        }
      }

      return apiError("NOT_FOUND", "Not found", undefined, 404);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "Server error" }, 500);
    }
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function apiError(code: string, message: string, fields?: Record<string, string>, status = 400): Response {
  return json({ error: { code, message, ...(fields ? { fields } : {}) } }, status);
}

async function parseBody<T>(req: Request, schema: z.ZodSchema<T>): Promise<{ data: T } | { error: Response }> {
  try {
    const raw = await req.json();
    const result = schema.safeParse(raw);
    if (!result.success) {
      const fields = Object.fromEntries(result.error.errors.map(e => [e.path.join(".") || "body", e.message]));
      return { error: apiError("VALIDATION_ERROR", "Invalid request body", fields) };
    }
    return { data: result.data };
  } catch {
    return { error: apiError("INVALID_JSON", "Request body must be valid JSON") };
  }
}
