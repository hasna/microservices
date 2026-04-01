export interface CheckoutSessionData {
  workspaceId: string;
  userId: string;
  planId: string;
  successUrl: string;
  cancelUrl: string;
  stripeSecretKey: string;
  stripePriceId?: string;
  stripeCustomerId?: string;
  trialPeriodDays?: number;
}

export interface CheckoutSessionResult {
  url: string;
  sessionId: string;
}

export interface PortalSessionResult {
  url: string;
}

export async function createCheckoutSession(
  data: CheckoutSessionData,
): Promise<CheckoutSessionResult> {
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("success_url", data.successUrl);
  params.set("cancel_url", data.cancelUrl);

  if (data.stripePriceId) {
    params.set("line_items[0][price]", data.stripePriceId);
    params.set("line_items[0][quantity]", "1");
  }

  if (data.stripeCustomerId) {
    params.set("customer", data.stripeCustomerId);
  }

  if (data.trialPeriodDays) {
    params.set(
      "subscription_data[trial_period_days]",
      String(data.trialPeriodDays),
    );
  }

  // Pass metadata so webhook can link back to our records
  params.set("subscription_data[metadata][workspace_id]", data.workspaceId);
  params.set("subscription_data[metadata][user_id]", data.userId);
  params.set("subscription_data[metadata][plan_id]", data.planId);

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const err = (await response.json()) as { error?: { message?: string } };
    throw new Error(
      `Stripe checkout error: ${err.error?.message ?? response.statusText}`,
    );
  }

  const session = (await response.json()) as { id: string; url: string };
  return { url: session.url, sessionId: session.id };
}

export async function createPortalSession(
  customerId: string,
  returnUrl: string,
  stripeSecretKey: string,
): Promise<PortalSessionResult> {
  const params = new URLSearchParams();
  params.set("customer", customerId);
  params.set("return_url", returnUrl);

  const response = await fetch(
    "https://api.stripe.com/v1/billing_portal/sessions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    },
  );

  if (!response.ok) {
    const err = (await response.json()) as { error?: { message?: string } };
    throw new Error(
      `Stripe portal error: ${err.error?.message ?? response.statusText}`,
    );
  }

  const session = (await response.json()) as { url: string };
  return { url: session.url };
}
