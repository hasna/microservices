import type { Sql } from "postgres";
import { upsertSubscription, updateSubscriptionStatus } from "./subscriptions.js";
import { upsertInvoice } from "./invoices.js";

export class WebhookSignatureError extends Error {
  constructor(msg: string) { super(msg); this.name = "WebhookSignatureError"; }
}

async function verifyStripeSignature(payload: string, signature: string, secret: string): Promise<void> {
  // Parse Stripe-Signature header: t=timestamp,v1=signature
  const parts = Object.fromEntries(
    signature.split(",").map(part => {
      const idx = part.indexOf("=");
      return [part.slice(0, idx), part.slice(idx + 1)];
    })
  );
  const timestamp = parts["t"];
  const v1 = parts["v1"];
  if (!timestamp || !v1) throw new WebhookSignatureError("Invalid Stripe-Signature header format");

  // Reject old webhooks (>5 min tolerance)
  const ts = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) throw new WebhookSignatureError("Webhook timestamp too old");

  // Compute HMAC-SHA256 of `{timestamp}.{payload}` using Web Crypto
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(`${timestamp}.${payload}`);

  const key = await crypto.subtle.importKey(
    "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, messageData);
  const computed = Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time compare
  if (computed.length !== v1.length) throw new WebhookSignatureError("Webhook signature mismatch");
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ v1.charCodeAt(i);
  }
  if (diff !== 0) throw new WebhookSignatureError("Webhook signature mismatch");
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export async function handleStripeWebhook(
  sql: Sql,
  payload: string,
  signature: string,
  webhookSecret: string
): Promise<{ handled: boolean; type: string }> {
  await verifyStripeSignature(payload, signature, webhookSecret);

  const event: StripeEvent = JSON.parse(payload);
  const obj = event.data.object;

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const stripeSubId = String(obj["id"] ?? "");
      const customerId = String(obj["customer"] ?? "");
      const status = mapStripeStatus(String(obj["status"] ?? ""));
      const periodStart = obj["current_period_start"] ? new Date(Number(obj["current_period_start"]) * 1000).toISOString() : undefined;
      const periodEnd = obj["current_period_end"] ? new Date(Number(obj["current_period_end"]) * 1000).toISOString() : undefined;
      const cancelAtPeriodEnd = Boolean(obj["cancel_at_period_end"]);
      const canceledAt = obj["canceled_at"] ? new Date(Number(obj["canceled_at"]) * 1000).toISOString() : undefined;

      // Look up existing subscription by stripe id to preserve workspace_id/user_id/plan_id
      const existing = await sql`SELECT * FROM billing.subscriptions WHERE stripe_subscription_id = ${stripeSubId} LIMIT 1`;
      if (existing.length > 0) {
        const row = existing[0] as Record<string, unknown>;
        await upsertSubscription(sql, {
          workspace_id: String(row["workspace_id"]),
          user_id: String(row["user_id"]),
          plan_id: String(row["plan_id"]),
          stripe_subscription_id: stripeSubId,
          stripe_customer_id: customerId,
          status,
          current_period_start: periodStart,
          current_period_end: periodEnd,
          cancel_at_period_end: cancelAtPeriodEnd,
          canceled_at: canceledAt,
        });
      } else {
        // New subscription from Stripe — store with placeholder workspace/user until linked
        const metaWorkspaceId = String((obj["metadata"] as Record<string, unknown> | undefined)?.["workspace_id"] ?? "");
        const metaUserId = String((obj["metadata"] as Record<string, unknown> | undefined)?.["user_id"] ?? "");
        const metaPlanId = String((obj["metadata"] as Record<string, unknown> | undefined)?.["plan_id"] ?? "");
        if (metaWorkspaceId && metaUserId && metaPlanId) {
          await upsertSubscription(sql, {
            workspace_id: metaWorkspaceId,
            user_id: metaUserId,
            plan_id: metaPlanId,
            stripe_subscription_id: stripeSubId,
            stripe_customer_id: customerId,
            status,
            current_period_start: periodStart,
            current_period_end: periodEnd,
            cancel_at_period_end: cancelAtPeriodEnd,
            canceled_at: canceledAt,
          });
        }
      }
      break;
    }

    case "customer.subscription.deleted": {
      const stripeSubId = String(obj["id"] ?? "");
      const rows = await sql`SELECT id FROM billing.subscriptions WHERE stripe_subscription_id = ${stripeSubId} LIMIT 1`;
      if (rows.length > 0) {
        const row = rows[0] as Record<string, unknown>;
        await updateSubscriptionStatus(sql, String(row["id"]), "canceled");
        await sql`UPDATE billing.subscriptions SET canceled_at = NOW(), updated_at = NOW() WHERE id = ${String(row["id"])} AND canceled_at IS NULL`;
      }
      break;
    }

    case "invoice.created":
    case "invoice.payment_succeeded":
    case "invoice.payment_failed": {
      const stripeInvoiceId = String(obj["id"] ?? "");
      const amountPaid = Number(obj["amount_paid"] ?? obj["amount_due"] ?? 0);
      const currency = String(obj["currency"] ?? "usd");
      const stripeSubId = obj["subscription"] ? String(obj["subscription"]) : undefined;
      const invoicePdfUrl = obj["invoice_pdf"] ? String(obj["invoice_pdf"]) : undefined;
      const dueDate = obj["due_date"] ? new Date(Number(obj["due_date"]) * 1000).toISOString() : undefined;

      // Resolve workspace_id from subscription
      let workspaceId = "";
      let subscriptionId: string | undefined;
      if (stripeSubId) {
        const subRows = await sql`SELECT id, workspace_id FROM billing.subscriptions WHERE stripe_subscription_id = ${stripeSubId} LIMIT 1`;
        if (subRows.length > 0) {
          const subRow = subRows[0] as Record<string, unknown>;
          workspaceId = String(subRow["workspace_id"]);
          subscriptionId = String(subRow["id"]);
        }
      }
      if (!workspaceId) {
        // Try metadata
        workspaceId = String((obj["metadata"] as Record<string, unknown> | undefined)?.["workspace_id"] ?? "unknown");
      }

      const invoiceStatus =
        event.type === "invoice.payment_succeeded" ? "paid" :
        event.type === "invoice.payment_failed" ? "open" :
        mapStripeInvoiceStatus(String(obj["status"] ?? "draft"));

      const paidAt = event.type === "invoice.payment_succeeded" ? new Date().toISOString() : undefined;

      await upsertInvoice(sql, {
        workspace_id: workspaceId,
        subscription_id: subscriptionId,
        stripe_invoice_id: stripeInvoiceId,
        amount_cents: amountPaid,
        currency,
        status: invoiceStatus,
        invoice_pdf_url: invoicePdfUrl,
        paid_at: paidAt,
        due_date: dueDate,
      });
      break;
    }
  }

  return { handled: true, type: event.type };
}

function mapStripeStatus(stripeStatus: string): "active" | "past_due" | "canceled" | "trialing" | "incomplete" {
  switch (stripeStatus) {
    case "active": return "active";
    case "past_due": return "past_due";
    case "canceled": return "canceled";
    case "trialing": return "trialing";
    default: return "incomplete";
  }
}

function mapStripeInvoiceStatus(stripeStatus: string): "draft" | "open" | "paid" | "uncollectible" | "void" {
  switch (stripeStatus) {
    case "draft": return "draft";
    case "open": return "open";
    case "paid": return "paid";
    case "uncollectible": return "uncollectible";
    case "void": return "void";
    default: return "draft";
  }
}
