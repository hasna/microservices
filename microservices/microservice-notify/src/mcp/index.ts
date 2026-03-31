#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { sendNotification } from "../lib/send.js";
import { listUserNotifications, markRead, countUnread } from "../lib/notifications.js";
import { setPreference } from "../lib/preferences.js";
import { createTemplate, listTemplates } from "../lib/templates.js";

const server = new Server({ name: "microservice-notify", version: "0.0.1" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  {
    name: "notify_send",
    description: "Send a notification to a user via the specified channel",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        workspace_id: { type: "string" },
        channel: { type: "string", enum: ["email", "sms", "in_app", "webhook"] },
        type: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        data: { type: "object" },
      },
      required: ["user_id", "channel", "type", "body"],
    },
  },
  {
    name: "notify_list_notifications",
    description: "List notifications for a user",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        limit: { type: "number" },
        offset: { type: "number" },
        unread_only: { type: "boolean" },
        channel: { type: "string" },
        type: { type: "string" },
      },
      required: ["user_id"],
    },
  },
  {
    name: "notify_mark_read",
    description: "Mark a notification as read",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "notify_count_unread",
    description: "Count unread notifications for a user",
    inputSchema: {
      type: "object",
      properties: { user_id: { type: "string" } },
      required: ["user_id"],
    },
  },
  {
    name: "notify_set_preference",
    description: "Set notification preference for a user/channel/type combination",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        channel: { type: "string" },
        type: { type: "string" },
        enabled: { type: "boolean" },
      },
      required: ["user_id", "channel", "type", "enabled"],
    },
  },
  {
    name: "notify_create_template",
    description: "Create a notification template",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        channel: { type: "string" },
        variables: { type: "array", items: { type: "string" } },
      },
      required: ["name", "body"],
    },
  },
  {
    name: "notify_list_templates",
    description: "List all notification templates",
    inputSchema: { type: "object", properties: {} },
  },
]}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb();
  const { name, arguments: args } = req.params;
  const a = args as Record<string, unknown>;
  const t = (d: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(d, null, 2) }] });

  if (name === "notify_send") {
    await sendNotification(sql, {
      userId: String(a.user_id),
      workspaceId: a.workspace_id ? String(a.workspace_id) : undefined,
      channel: a.channel as "email" | "sms" | "in_app" | "webhook",
      type: String(a.type),
      title: a.title ? String(a.title) : undefined,
      body: String(a.body),
      data: a.data as Record<string, unknown> | undefined,
    });
    return t({ ok: true });
  }

  if (name === "notify_list_notifications") {
    return t(await listUserNotifications(sql, String(a.user_id), {
      limit: a.limit as number | undefined,
      offset: a.offset as number | undefined,
      unreadOnly: a.unread_only as boolean | undefined,
      channel: a.channel ? String(a.channel) : undefined,
      type: a.type ? String(a.type) : undefined,
    }));
  }

  if (name === "notify_mark_read") {
    return t(await markRead(sql, String(a.id)));
  }

  if (name === "notify_count_unread") {
    return t({ count: await countUnread(sql, String(a.user_id)) });
  }

  if (name === "notify_set_preference") {
    return t(await setPreference(sql, String(a.user_id), String(a.channel), String(a.type), Boolean(a.enabled)));
  }

  if (name === "notify_create_template") {
    return t(await createTemplate(sql, {
      name: String(a.name),
      subject: a.subject ? String(a.subject) : undefined,
      body: String(a.body),
      channel: a.channel ? String(a.channel) : undefined,
      variables: a.variables as string[] | undefined,
    }));
  }

  if (name === "notify_list_templates") {
    return t(await listTemplates(sql));
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const sql = getDb();
  await migrate(sql);
  await server.connect(new StdioServerTransport());
}
main().catch(console.error);
