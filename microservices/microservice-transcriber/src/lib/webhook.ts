/**
 * Webhook notifications — fires a POST to a configured URL after transcription events.
 */

import { getConfig } from "./config.js";

export interface WebhookPayload {
  event: "transcription.completed" | "transcription.failed";
  id: string;
  title: string | null;
  status: string;
  source_url: string | null;
  provider: string;
  duration_seconds: number | null;
  word_count: number | null;
  timestamp: string;
}

/**
 * Fire a webhook if configured. Silently ignores failures — webhooks are best-effort.
 */
export async function fireWebhook(payload: WebhookPayload): Promise<void> {
  const cfg = getConfig();
  const url = (cfg as Record<string, unknown>)["webhook"] as string | undefined;
  if (!url) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000), // 10s timeout
    });
  } catch {
    // Webhooks are fire-and-forget — don't fail the transcription
  }
}
