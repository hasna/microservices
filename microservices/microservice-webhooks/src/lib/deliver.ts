import { createHmac } from "node:crypto";
import type { Sql } from "postgres";
import { disableEndpoint } from "./endpoints.js";

export interface Delivery {
  id: string;
  endpoint_id: string;
  event: string;
  payload: any;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  delivered_at: string | null;
  created_at: string;
}

/** Compute HMAC-SHA256 signature: "sha256=<hex>" */
export function computeSignature(secret: string, body: string): string {
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${sig}`;
}

/** Compute exponential backoff in seconds: attempt 1→30s, 2→60s, 3→120s, capped at 3600s */
export function backoffSeconds(attempt: number): number {
  return Math.min(30 * 2 ** (attempt - 1), 3600);
}

/** Check if an endpoint's events list matches a given event.
 *  Empty array = wildcard (matches all). Non-empty = must contain the event. */
export function matchesEvent(endpointEvents: string[], event: string): boolean {
  if (endpointEvents.length === 0) return true;
  return endpointEvents.includes(event);
}

/**
 * Find all active endpoints for the workspace that match the event,
 * and create a pending delivery record for each.
 */
export async function triggerWebhook(
  sql: Sql,
  workspaceId: string,
  event: string,
  payload: any,
): Promise<void> {
  const endpoints = await sql<{ id: string; events: string[] }[]>`
    SELECT id, events FROM webhooks.endpoints
    WHERE workspace_id = ${workspaceId} AND active = true`;

  const matching = endpoints.filter((ep) => matchesEvent(ep.events, event));
  if (matching.length === 0) return;

  for (const ep of matching) {
    await sql`
      INSERT INTO webhooks.deliveries (endpoint_id, event, payload)
      VALUES (${ep.id}, ${event}, ${JSON.stringify(payload)})`;
  }
}

/**
 * Fetch the delivery + endpoint, sign the payload, POST to the endpoint URL.
 * On 2xx: mark delivered, reset endpoint failure_count.
 * On failure: increment attempts, schedule exponential backoff retry,
 *   increment endpoint.failure_count, disable endpoint if >= 10 failures.
 */
export async function processDelivery(
  sql: Sql,
  deliveryId: string,
): Promise<void> {
  const [delivery] = await sql<Delivery[]>`
    SELECT * FROM webhooks.deliveries WHERE id = ${deliveryId}`;
  if (!delivery) throw new Error(`Delivery not found: ${deliveryId}`);

  const [endpoint] = await sql<
    { id: string; url: string; secret: string | null; failure_count: number }[]
  >`
    SELECT id, url, secret, failure_count FROM webhooks.endpoints WHERE id = ${delivery.endpoint_id}`;
  if (!endpoint) throw new Error(`Endpoint not found: ${delivery.endpoint_id}`);

  const body = JSON.stringify(delivery.payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Webhook-Event": delivery.event,
    "User-Agent": "microservice-webhooks/0.0.1",
  };
  if (endpoint.secret) {
    headers["X-Webhook-Signature"] = computeSignature(endpoint.secret, body);
  }

  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let errorMessage: string | null = null;
  let success = false;

  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(30_000),
    });
    statusCode = res.status;
    responseBody = await res.text().catch(() => null);
    success = res.status >= 200 && res.status < 300;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  // Record the attempt
  await sql`
    INSERT INTO webhooks.delivery_attempts (delivery_id, status_code, response_body, error)
    VALUES (${deliveryId}, ${statusCode}, ${responseBody}, ${errorMessage})`;

  if (success) {
    await sql`
      UPDATE webhooks.deliveries
      SET status = 'delivered', delivered_at = NOW()
      WHERE id = ${deliveryId}`;
    // Reset failure count on success
    await sql`
      UPDATE webhooks.endpoints SET failure_count = 0, updated_at = NOW()
      WHERE id = ${endpoint.id}`;
  } else {
    const newAttempts = delivery.attempts + 1;
    const isFinal = newAttempts >= delivery.max_attempts;
    const backoff = backoffSeconds(newAttempts);
    const nextAttemptAt = new Date(Date.now() + backoff * 1000).toISOString();

    await sql`
      UPDATE webhooks.deliveries
      SET attempts = ${newAttempts},
          status = ${isFinal ? "failed" : "pending"},
          next_attempt_at = ${isFinal ? sql`next_attempt_at` : sql`${nextAttemptAt}::TIMESTAMPTZ`}
      WHERE id = ${deliveryId}`;

    const newFailureCount = endpoint.failure_count + 1;
    await sql`
      UPDATE webhooks.endpoints
      SET failure_count = ${newFailureCount}, last_failure_at = NOW(), updated_at = NOW()
      WHERE id = ${endpoint.id}`;

    if (newFailureCount >= 10) {
      await disableEndpoint(sql, endpoint.id);
    }
  }
}

/**
 * Find deliveries with status='pending' AND next_attempt_at <= NOW(),
 * claim each with SKIP LOCKED, process it, return count processed.
 */
export async function processPendingDeliveries(
  sql: Sql,
  limit = 50,
): Promise<number> {
  const pending = await sql<{ id: string }[]>`
    SELECT id FROM webhooks.deliveries
    WHERE status = 'pending' AND next_attempt_at <= NOW()
    ORDER BY next_attempt_at ASC
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED`;

  for (const d of pending) {
    try {
      await processDelivery(sql, d.id);
    } catch {
      // Best-effort: log and continue
    }
  }
  return pending.length;
}

/**
 * Reset a delivery to pending so it will be retried.
 */
export async function replayDelivery(
  sql: Sql,
  deliveryId: string,
): Promise<void> {
  await sql`
    UPDATE webhooks.deliveries
    SET status = 'pending', attempts = 0, next_attempt_at = NOW()
    WHERE id = ${deliveryId}`;
}

export async function listDeliveries(
  sql: Sql,
  opts: {
    workspaceId?: string;
    endpointId?: string;
    status?: string;
    limit?: number;
  } = {},
): Promise<Delivery[]> {
  return sql<Delivery[]>`
    SELECT d.* FROM webhooks.deliveries d
    JOIN webhooks.endpoints e ON e.id = d.endpoint_id
    WHERE (${opts.workspaceId ?? null} IS NULL OR e.workspace_id = ${opts.workspaceId ?? null})
      AND (${opts.endpointId ?? null} IS NULL OR d.endpoint_id = ${opts.endpointId ?? null})
      AND (${opts.status ?? null} IS NULL OR d.status = ${opts.status ?? null})
    ORDER BY d.created_at DESC
    LIMIT ${opts.limit ?? 50}`;
}
