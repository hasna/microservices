import type { Sql } from "postgres";
import { createHmac } from "crypto";

export interface WebhookEndpoint {
  id: string;
  workspace_id: string;
  url: string;
  secret: string | null;
  events: string[];
  active: boolean;
  created_at: string;
}

export interface CreateWebhookEndpointData {
  workspaceId: string;
  url: string;
  secret?: string;
  events?: string[];
}

export async function createWebhookEndpoint(sql: Sql, data: CreateWebhookEndpointData): Promise<WebhookEndpoint> {
  const [wh] = await sql<WebhookEndpoint[]>`
    INSERT INTO notify.webhook_endpoints (workspace_id, url, secret, events)
    VALUES (${data.workspaceId}, ${data.url}, ${data.secret ?? null}, ${data.events ?? []})
    RETURNING *`;
  return wh;
}

export async function listWorkspaceWebhooks(sql: Sql, workspaceId: string): Promise<WebhookEndpoint[]> {
  return sql<WebhookEndpoint[]>`SELECT * FROM notify.webhook_endpoints WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC`;
}

export async function updateWebhookEndpoint(sql: Sql, id: string, data: { url?: string; secret?: string; events?: string[]; active?: boolean }): Promise<WebhookEndpoint | null> {
  const [wh] = await sql<WebhookEndpoint[]>`
    UPDATE notify.webhook_endpoints SET
      url    = COALESCE(${data.url ?? null}, url),
      secret = COALESCE(${data.secret ?? null}, secret),
      events = COALESCE(${data.events ?? null}, events),
      active = COALESCE(${data.active ?? null}, active)
    WHERE id = ${id} RETURNING *`;
  return wh ?? null;
}

export async function deleteWebhookEndpoint(sql: Sql, id: string): Promise<boolean> {
  const r = await sql`DELETE FROM notify.webhook_endpoints WHERE id = ${id}`;
  return r.count > 0;
}

/**
 * POST to all active webhook endpoints for a workspace.
 * Sends HMAC-SHA256 signature in X-Notify-Signature header if endpoint has a secret.
 */
export async function triggerWebhooks(sql: Sql, workspaceId: string, event: string, payload: Record<string, unknown>): Promise<void> {
  const endpoints = await sql<WebhookEndpoint[]>`
    SELECT * FROM notify.webhook_endpoints
    WHERE workspace_id = ${workspaceId} AND active = true AND (events = '{}' OR ${event} = ANY(events))`;

  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });

  for (const ep of endpoints) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (ep.secret) {
      const sig = createHmac("sha256", ep.secret).update(body).digest("hex");
      headers["X-Notify-Signature"] = `sha256=${sig}`;
    }
    try {
      await fetch(ep.url, { method: "POST", headers, body });
    } catch {
      // Silently ignore delivery failures — delivery_log handles this in sendNotification
    }
  }
}
