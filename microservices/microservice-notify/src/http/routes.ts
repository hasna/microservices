import type { Sql } from "postgres";
import { sendNotification } from "../lib/send.js";
import { listUserNotifications, markRead, markAllRead, countUnread } from "../lib/notifications.js";
import { getUserPreferences, setPreference } from "../lib/preferences.js";
import { createTemplate, listTemplates } from "../lib/templates.js";
import { createWebhookEndpoint, listWorkspaceWebhooks } from "../lib/webhooks.js";

export function makeRouter(sql: Sql) {
  return async function router(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    const m = req.method;
    try {
      if (m === "GET" && p === "/health") {
        return json({ ok: true, service: "microservice-notify" });
      }

      // POST /notify/send
      if (m === "POST" && p === "/notify/send") {
        const body = await req.json();
        await sendNotification(sql, {
          userId: body.user_id,
          workspaceId: body.workspace_id,
          channel: body.channel,
          type: body.type,
          title: body.title,
          body: body.body,
          data: body.data,
        });
        return json({ ok: true }, 202);
      }

      // GET /notify/notifications?user_id=X
      if (m === "GET" && p === "/notify/notifications") {
        const userId = url.searchParams.get("user_id");
        if (!userId) return json({ error: "user_id required" }, 400);
        const notifications = await listUserNotifications(sql, userId, {
          limit: url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!, 10) : undefined,
          offset: url.searchParams.get("offset") ? parseInt(url.searchParams.get("offset")!, 10) : undefined,
          unreadOnly: url.searchParams.get("unread_only") === "true",
          channel: url.searchParams.get("channel") ?? undefined,
          type: url.searchParams.get("type") ?? undefined,
        });
        return json(notifications);
      }

      // PATCH /notify/notifications/:id/read
      if (m === "PATCH" && p.match(/^\/notify\/notifications\/[^/]+\/read$/)) {
        const id = p.split("/")[3];
        const n = await markRead(sql, id);
        return n ? json(n) : json({ error: "Not found" }, 404);
      }

      // POST /notify/notifications/read-all?user_id=X
      if (m === "POST" && p === "/notify/notifications/read-all") {
        const userId = url.searchParams.get("user_id");
        if (!userId) return json({ error: "user_id required" }, 400);
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
        const { user_id, channel, type, enabled } = await req.json();
        const pref = await setPreference(sql, user_id, channel, type, enabled);
        return json(pref);
      }

      // POST /notify/templates
      if (m === "POST" && p === "/notify/templates") {
        const body = await req.json();
        const t = await createTemplate(sql, {
          name: body.name,
          subject: body.subject,
          body: body.body,
          channel: body.channel,
          variables: body.variables,
        });
        return json(t, 201);
      }

      // GET /notify/templates
      if (m === "GET" && p === "/notify/templates") {
        return json(await listTemplates(sql));
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
        if (!workspaceId) return json({ error: "workspace_id required" }, 400);
        return json(await listWorkspaceWebhooks(sql, workspaceId));
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "Server error" }, 500);
    }
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
