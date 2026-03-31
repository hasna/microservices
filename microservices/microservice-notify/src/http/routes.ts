import { z } from "zod";
import type { Sql } from "postgres";
import { sendNotification } from "../lib/send.js";
import { listUserNotifications, markRead, markAllRead, countUnread } from "../lib/notifications.js";
import { getUserPreferences, setPreference } from "../lib/preferences.js";
import { createTemplate, listTemplates } from "../lib/templates.js";
import { createWebhookEndpoint, listWorkspaceWebhooks } from "../lib/webhooks.js";
import { sendBatch } from "../lib/batch.js";
import { verifyUnsubscribeToken } from "../lib/unsubscribe.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const SendSchema = z.object({
  user_id: z.string(),
  workspace_id: z.string().optional(),
  channel: z.enum(["email", "sms", "in_app", "webhook"]),
  type: z.string().min(1),
  title: z.string().optional(),
  body: z.string().min(1),
  data: z.record(z.unknown()).optional(),
});

const PreferenceSchema = z.object({
  user_id: z.string(),
  channel: z.enum(["email", "sms", "in_app", "webhook"]),
  type: z.string().min(1),
  enabled: z.boolean(),
});

const CreateTemplateSchema = z.object({
  name: z.string().min(1),
  subject: z.string().optional(),
  body: z.string().min(1),
  channel: z.string().optional(),
  variables: z.array(z.string()).optional(),
});

export function makeRouter(sql: Sql) {
  return async function router(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    const m = req.method;
    if (m === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    try {
      if (m === "GET" && p === "/health") {
        try {
          const start = Date.now();
          await sql`SELECT 1`;
          return json({ ok: true, service: "microservice-notify", db: true, latency_ms: Date.now() - start });
        } catch (e) {
          return json({ ok: false, service: "microservice-notify", db: false, error: e instanceof Error ? e.message : "db error" }, 503);
        }
      }

      // POST /notify/send
      if (m === "POST" && p === "/notify/send") {
        const parsed = await parseBody(req, SendSchema);
        if ("error" in parsed) return parsed.error;
        await sendNotification(sql, {
          userId: parsed.data.user_id,
          workspaceId: parsed.data.workspace_id,
          channel: parsed.data.channel,
          type: parsed.data.type,
          title: parsed.data.title,
          body: parsed.data.body,
          data: parsed.data.data,
        });
        return json({ ok: true }, 202);
      }

      // GET /notify/notifications?user_id=X
      if (m === "GET" && p === "/notify/notifications") {
        const userId = url.searchParams.get("user_id");
        if (!userId) return apiError("MISSING_PARAM", "user_id required");
        const items = await listUserNotifications(sql, userId, {
          limit: url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!, 10) : undefined,
          offset: url.searchParams.get("offset") ? parseInt(url.searchParams.get("offset")!, 10) : undefined,
          unreadOnly: url.searchParams.get("unread_only") === "true",
          channel: url.searchParams.get("channel") ?? undefined,
          type: url.searchParams.get("type") ?? undefined,
        });
        return json({ data: items, count: items.length });
      }

      // PATCH /notify/notifications/:id/read
      if (m === "PATCH" && p.match(/^\/notify\/notifications\/[^/]+\/read$/)) {
        const id = p.split("/")[3];
        const n = await markRead(sql, id);
        return n ? json(n) : apiError("NOT_FOUND", "Not found", undefined, 404);
      }

      // POST /notify/notifications/read-all?user_id=X
      if (m === "POST" && p === "/notify/notifications/read-all") {
        const userId = url.searchParams.get("user_id");
        if (!userId) return apiError("MISSING_PARAM", "user_id required");
        const count = await markAllRead(sql, userId);
        return json({ marked_read: count });
      }

      // GET /notify/preferences/:user_id
      if (m === "GET" && p.match(/^\/notify\/preferences\/[^/]+$/)) {
        const userId = p.split("/").pop()!;
        const prefs = await getUserPreferences(sql, userId);
        return json(prefs);
      }

      // PUT /notify/preferences
      if (m === "PUT" && p === "/notify/preferences") {
        const parsed = await parseBody(req, PreferenceSchema);
        if ("error" in parsed) return parsed.error;
        const pref = await setPreference(sql, parsed.data.user_id, parsed.data.channel, parsed.data.type, parsed.data.enabled);
        return json(pref);
      }

      // POST /notify/templates
      if (m === "POST" && p === "/notify/templates") {
        const parsed = await parseBody(req, CreateTemplateSchema);
        if ("error" in parsed) return parsed.error;
        const t = await createTemplate(sql, {
          name: parsed.data.name,
          subject: parsed.data.subject,
          body: parsed.data.body,
          channel: parsed.data.channel,
          variables: parsed.data.variables,
        });
        return json(t, 201);
      }

      // GET /notify/templates
      if (m === "GET" && p === "/notify/templates") {
        const items = await listTemplates(sql);
        return json({ data: items, count: items.length });
      }

      // POST /notify/webhooks
      if (m === "POST" && p === "/notify/webhooks") {
        const body = await req.json();
        const wh = await createWebhookEndpoint(sql, {
          workspaceId: body.workspace_id,
          url: body.url,
          secret: body.secret,
          events: body.events,
        });
        return json(wh, 201);
      }

      // GET /notify/webhooks?workspace_id=X
      if (m === "GET" && p === "/notify/webhooks") {
        const workspaceId = url.searchParams.get("workspace_id");
        if (!workspaceId) return apiError("MISSING_PARAM", "workspace_id required");
        return json(await listWorkspaceWebhooks(sql, workspaceId));
      }

      // POST /notify/send-batch
      if (m === "POST" && p === "/notify/send-batch") {
        const raw = await req.json().catch(() => null);
        if (!raw || !Array.isArray(raw.notifications)) {
          return apiError("VALIDATION_ERROR", "body must have notifications array");
        }
        const results = await sendBatch(sql, raw.notifications);
        return json({ results, total: raw.notifications.length, succeeded: results.filter((r: { success: boolean }) => r.success).length, failed: results.filter((r: { success: boolean }) => !r.success).length });
      }

      // GET /notify/unsubscribe?token=X
      if (m === "GET" && p === "/notify/unsubscribe") {
        const token = url.searchParams.get("token");
        if (!token) return apiError("MISSING_PARAM", "token required");
        const parsed = await verifyUnsubscribeToken(token);
        if (!parsed) return apiError("INVALID_TOKEN", "Invalid or expired unsubscribe token", undefined, 400);
        // Disable the preference for this user/type across all channels
        for (const channel of ["email", "sms", "in_app", "webhook"] as const) {
          await setPreference(sql, parsed.userId, channel, parsed.type, false);
        }
        return json({ ok: true, message: "Unsubscribed" });
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
