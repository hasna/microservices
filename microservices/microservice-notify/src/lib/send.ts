import type { Sql } from "postgres";
import { createNotification } from "./notifications.js";
import { isChannelEnabled } from "./preferences.js";
import { triggerWebhooks } from "./webhooks.js";
import { createHmac } from "crypto";

export interface SendNotificationData {
  userId: string;
  workspaceId?: string;
  channel: "email" | "sms" | "in_app" | "webhook";
  type: string;
  title?: string;
  body: string;
  data?: Record<string, unknown>;
}

export async function sendNotification(sql: Sql, data: SendNotificationData): Promise<void> {
  // 1. Create notification record
  const notification = await createNotification(sql, {
    userId: data.userId,
    workspaceId: data.workspaceId,
    channel: data.channel,
    type: data.type,
    title: data.title,
    body: data.body,
    data: data.data,
  });

  // 2. Check preferences (skip if disabled)
  const enabled = await isChannelEnabled(sql, data.userId, data.channel, data.type);
  if (!enabled) {
    await logDelivery(sql, notification.id, data.channel, "failed", "Channel disabled by user preference");
    return;
  }

  // 3. Deliver based on channel
  let deliveryError: string | null = null;
  try {
    if (data.channel === "in_app") {
      // in_app: already stored in DB, SSE will pick it up
    } else if (data.channel === "email") {
      await sendEmail(data.title ?? data.type, data.body, data.userId);
    } else if (data.channel === "sms") {
      await sendSms(data.body, data.userId);
    } else if (data.channel === "webhook") {
      if (data.workspaceId) {
        await triggerWebhooks(sql, data.workspaceId, data.type, {
          notification_id: notification.id,
          user_id: data.userId,
          type: data.type,
          title: data.title,
          body: data.body,
          data: data.data ?? {},
        });
      }
    }
  } catch (err) {
    deliveryError = err instanceof Error ? err.message : String(err);
  }

  // 4. Log delivery result
  await logDelivery(sql, notification.id, data.channel, deliveryError ? "failed" : "sent", deliveryError);
}

async function logDelivery(sql: Sql, notificationId: string, channel: string, status: "pending" | "sent" | "failed", error: string | null = null): Promise<void> {
  await sql`
    INSERT INTO notify.delivery_log (notification_id, channel, status, error, sent_at)
    VALUES (${notificationId}, ${channel}, ${status}, ${error}, ${status === "sent" ? sql`NOW()` : null})`;
}

async function sendEmail(subject: string, body: string, userId: string): Promise<void> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    console.log(`[notify] email fallback — to: ${userId} subject: ${subject}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env["NOTIFY_FROM_EMAIL"] ?? "notify@example.com",
      to: [userId],
      subject,
      text: body,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend API error ${res.status}: ${text}`);
  }
}

async function sendSms(body: string, userId: string): Promise<void> {
  const accountSid = process.env["TWILIO_ACCOUNT_SID"];
  const authToken = process.env["TWILIO_AUTH_TOKEN"];
  if (!accountSid || !authToken) {
    console.log(`[notify] sms fallback — to: ${userId} body: ${body}`);
    return;
  }
  const from = process.env["TWILIO_FROM_NUMBER"] ?? "";
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: from, To: userId, Body: body }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio API error ${res.status}: ${text}`);
  }
}
