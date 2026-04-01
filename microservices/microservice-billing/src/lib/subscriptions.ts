import type { Sql } from "postgres";

export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "trialing"
  | "incomplete";

export interface Subscription {
  id: string;
  workspace_id: string;
  user_id: string;
  plan_id: string;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  metadata: any;
  created_at: string;
  updated_at: string;
}

export interface UpsertSubscriptionData {
  workspace_id: string;
  user_id: string;
  plan_id: string;
  stripe_subscription_id?: string;
  stripe_customer_id?: string;
  status?: SubscriptionStatus;
  current_period_start?: string;
  current_period_end?: string;
  cancel_at_period_end?: boolean;
  canceled_at?: string;
  metadata?: any;
}

export async function getSubscription(
  sql: Sql,
  id: string,
): Promise<Subscription | null> {
  const [sub] = await sql<
    Subscription[]
  >`SELECT * FROM billing.subscriptions WHERE id = ${id}`;
  return sub ?? null;
}

export async function getSubscriptionByStripeId(
  sql: Sql,
  stripeSubscriptionId: string,
): Promise<Subscription | null> {
  const [sub] = await sql<
    Subscription[]
  >`SELECT * FROM billing.subscriptions WHERE stripe_subscription_id = ${stripeSubscriptionId}`;
  return sub ?? null;
}

export async function getWorkspaceSubscription(
  sql: Sql,
  workspaceId: string,
): Promise<Subscription | null> {
  const [sub] = await sql<Subscription[]>`
    SELECT * FROM billing.subscriptions
    WHERE workspace_id = ${workspaceId} AND status IN ('active','trialing','past_due')
    ORDER BY created_at DESC LIMIT 1`;
  return sub ?? null;
}

export async function upsertSubscription(
  sql: Sql,
  data: UpsertSubscriptionData,
): Promise<Subscription> {
  if (data.stripe_subscription_id) {
    const [sub] = await sql<Subscription[]>`
      INSERT INTO billing.subscriptions
        (workspace_id, user_id, plan_id, stripe_subscription_id, stripe_customer_id, status,
         current_period_start, current_period_end, cancel_at_period_end, canceled_at, metadata)
      VALUES (
        ${data.workspace_id}, ${data.user_id}, ${data.plan_id},
        ${data.stripe_subscription_id}, ${data.stripe_customer_id ?? null},
        ${data.status ?? "incomplete"},
        ${data.current_period_start ?? null}, ${data.current_period_end ?? null},
        ${data.cancel_at_period_end ?? false}, ${data.canceled_at ?? null},
        ${JSON.stringify(data.metadata ?? {})}
      )
      ON CONFLICT (stripe_subscription_id) DO UPDATE SET
        plan_id = EXCLUDED.plan_id,
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        status = EXCLUDED.status,
        current_period_start = EXCLUDED.current_period_start,
        current_period_end = EXCLUDED.current_period_end,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        canceled_at = EXCLUDED.canceled_at,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING *`;
    return sub;
  }
  const [sub] = await sql<Subscription[]>`
    INSERT INTO billing.subscriptions
      (workspace_id, user_id, plan_id, stripe_customer_id, status,
       current_period_start, current_period_end, cancel_at_period_end, canceled_at, metadata)
    VALUES (
      ${data.workspace_id}, ${data.user_id}, ${data.plan_id},
      ${data.stripe_customer_id ?? null},
      ${data.status ?? "incomplete"},
      ${data.current_period_start ?? null}, ${data.current_period_end ?? null},
      ${data.cancel_at_period_end ?? false}, ${data.canceled_at ?? null},
      ${JSON.stringify(data.metadata ?? {})}
    )
    RETURNING *`;
  return sub;
}

export async function updateSubscriptionStatus(
  sql: Sql,
  id: string,
  status: SubscriptionStatus,
): Promise<Subscription | null> {
  const [sub] = await sql<Subscription[]>`
    UPDATE billing.subscriptions SET status = ${status}, updated_at = NOW()
    WHERE id = ${id} RETURNING *`;
  return sub ?? null;
}

export async function cancelSubscription(
  sql: Sql,
  id: string,
  atPeriodEnd = true,
): Promise<Subscription | null> {
  if (atPeriodEnd) {
    const [sub] = await sql<Subscription[]>`
      UPDATE billing.subscriptions SET cancel_at_period_end = true, updated_at = NOW()
      WHERE id = ${id} RETURNING *`;
    return sub ?? null;
  }
  const [sub] = await sql<Subscription[]>`
    UPDATE billing.subscriptions SET
      status = 'canceled', canceled_at = NOW(), cancel_at_period_end = false, updated_at = NOW()
    WHERE id = ${id} RETURNING *`;
  return sub ?? null;
}

export async function listSubscriptions(
  sql: Sql,
  opts?: { workspaceId?: string; userId?: string; status?: SubscriptionStatus },
): Promise<Subscription[]> {
  if (opts?.workspaceId && opts?.status) {
    return sql<
      Subscription[]
    >`SELECT * FROM billing.subscriptions WHERE workspace_id = ${opts.workspaceId} AND status = ${opts.status} ORDER BY created_at DESC`;
  }
  if (opts?.workspaceId) {
    return sql<
      Subscription[]
    >`SELECT * FROM billing.subscriptions WHERE workspace_id = ${opts.workspaceId} ORDER BY created_at DESC`;
  }
  if (opts?.userId) {
    return sql<
      Subscription[]
    >`SELECT * FROM billing.subscriptions WHERE user_id = ${opts.userId} ORDER BY created_at DESC`;
  }
  if (opts?.status) {
    return sql<
      Subscription[]
    >`SELECT * FROM billing.subscriptions WHERE status = ${opts.status} ORDER BY created_at DESC`;
  }
  return sql<
    Subscription[]
  >`SELECT * FROM billing.subscriptions ORDER BY created_at DESC`;
}
