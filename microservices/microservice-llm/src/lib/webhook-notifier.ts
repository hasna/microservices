/**
 * Webhook notifier for budget alerts and LLM events.
 * Fires HTTP POST callbacks to registered endpoints.
 */

import type { Sql } from "postgres";

export interface WebhookEndpoint {
  id: string;
  workspaceId: string;
  url: string;
  secret: string;
  eventTypes: WebhookEventType[];
  isActive: boolean;
  createdAt: Date;
}

export type WebhookEventType =
  | "budget_threshold"
  | "budget_exceeded"
  | "model_budget_exceeded"
  | "circuit_open"
  | "circuit_close";

export interface WebhookPayload {
  event: WebhookEventType;
  workspaceId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export async function registerWebhook(
  sql: Sql,
  opts: {
    workspaceId: string;
    url: string;
    secret: string;
    eventTypes: WebhookEventType[];
  },
): Promise<WebhookEndpoint> {
  const [endpoint] = await sql`
    INSERT INTO llm.webhooks (workspace_id, url, secret, event_types, is_active)
    VALUES (
      ${opts.workspaceId},
      ${opts.url},
      ${opts.secret},
      ${opts.eventTypes},
      true
    )
    RETURNING id, workspace_id, url, secret, event_types, is_active, created_at
  `;
  return {
    id: endpoint.id,
    workspaceId: endpoint.workspace_id,
    url: endpoint.url,
    secret: endpoint.secret,
    eventTypes: endpoint.event_types,
    isActive: endpoint.is_active,
    createdAt: endpoint.created_at,
  };
}

export async function deleteWebhook(
  sql: Sql,
  id: string,
  workspaceId: string,
): Promise<void> {
  await sql`
    DELETE FROM llm.webhooks
    WHERE id = ${id} AND workspace_id = ${workspaceId}
  `;
}

export async function listWebhooks(
  sql: Sql,
  workspaceId: string,
): Promise<WebhookEndpoint[]> {
  const rows = await sql`
    SELECT id, workspace_id, url, secret, event_types, is_active, created_at
    FROM llm.webhooks
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
  `;
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    url: r.url,
    secret: r.secret,
    eventTypes: r.event_types as WebhookEventType[],
    isActive: r.is_active,
    createdAt: r.created_at,
  }));
}

export async function fireWebhook(
  url: string,
  secret: string,
  payload: WebhookPayload,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const body = JSON.stringify(payload);
    const timestamp = new Date().toISOString();
    const signature = await computeSignature(body, secret, timestamp);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Timestamp": timestamp,
        "X-Webhook-Event": payload.event,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    return { ok: res.ok, status: res.status };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

async function computeSignature(
  body: string,
  secret: string,
  timestamp: string,
): Promise<string> {
  // Simple HMAC-like signature using Web Crypto API
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret + timestamp);
  const messageData = encoder.encode(body);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function notifyBudgetAlert(
  sql: Sql,
  opts: {
    workspaceId: string;
    eventType: "budget_threshold" | "budget_exceeded";
    spendUsd: number;
    limitUsd: number;
    thresholdPct: number;
    modelName?: string;
  },
): Promise<void> {
  const rows = await sql`
    SELECT id, url, secret, event_types
    FROM llm.webhooks
    WHERE workspace_id = ${opts.workspaceId}
      AND is_active = true
      AND ${opts.eventType} = ANY(event_types)
  `;

  const payload: WebhookPayload = {
    event: opts.eventType,
    workspaceId: opts.workspaceId,
    timestamp: new Date().toISOString(),
    data: {
      spend_usd: opts.spendUsd,
      limit_usd: opts.limitUsd,
      threshold_pct: opts.thresholdPct,
      ...(opts.modelName && { model_name: opts.modelName }),
    },
  };

  await Promise.allSettled(
    rows.map(async (row) => {
      const result = await fireWebhook(row.url, row.secret, payload);
      await sql`
        INSERT INTO llm.webhook_logs (webhook_id, event_type, payload, response_status, error)
        VALUES (
          ${row.id},
          ${opts.eventType},
          ${JSON.stringify(payload)},
          ${result.status ?? null},
          ${result.error ?? null}
        )
      `;
    }),
  );
}
