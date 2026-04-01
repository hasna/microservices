export interface Subscription {
  id: string;
  status: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
}

export function isTrialing(subscription: Subscription): boolean {
  return subscription.status === "trialing";
}

export function isActive(subscription: Subscription): boolean {
  return ["active", "trialing"].includes(subscription.status);
}

export function daysUntilRenewal(subscription: Subscription): number {
  const end = new Date(subscription.current_period_end);
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000));
}

export function canAccess(
  subscription: Subscription | null,
  feature: string,
  planMetadata: any,
): boolean {
  if (!subscription || !isActive(subscription)) return false;
  if (!planMetadata) return true; // no restrictions defined = full access
  const features = (planMetadata.features as string[] | undefined) ?? [];
  return features.length === 0 || features.includes(feature);
}
