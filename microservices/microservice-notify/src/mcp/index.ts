#!/usr/bin/env bun
/**
 * MCP server for microservice-notify.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { sendBatch } from "../lib/batch.js";
import {
  countUnread,
  deleteNotification,
  listUserNotifications,
  markRead,
} from "../lib/notifications.js";
import { getUserPreferences, setPreference } from "../lib/preferences.js";
import { sendNotification } from "../lib/send.js";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
} from "../lib/templates.js";

const server = new McpServer({
  name: "microservice-notify",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const ChannelSchema = z.enum(["email", "sms", "in_app", "webhook"]);

server.tool(
  "notify_send",
  "Send a notification to a user via the specified channel",
  {
    user_id: z.string(),
    workspace_id: z.string().optional(),
    channel: ChannelSchema,
    type: z.string(),
    title: z.string().optional(),
    body: z.string(),
    data: z.record(z.any()).optional(),
  },
  async (notifData) => {
    await sendNotification(sql, {
      userId: notifData.user_id,
      workspaceId: notifData.workspace_id,
      channel: notifData.channel,
      type: notifData.type,
      title: notifData.title,
      body: notifData.body,
      data: notifData.data,
    });
    return text({ ok: true });
  },
);

server.tool(
  "notify_list_notifications",
  "List notifications for a user",
  {
    user_id: z.string(),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
    unread_only: z.boolean().optional().default(false),
    channel: z.string().optional(),
    type: z.string().optional(),
  },
  async ({ user_id, limit, offset, unread_only, channel, type }) =>
    text(
      await listUserNotifications(sql, user_id, {
        limit,
        offset,
        unreadOnly: unread_only,
        channel,
        type,
      }),
    ),
);

server.tool(
  "notify_mark_read",
  "Mark a notification as read",
  { id: z.string() },
  async ({ id }) => text(await markRead(sql, id)),
);

server.tool(
  "notify_count_unread",
  "Count unread notifications for a user",
  { user_id: z.string() },
  async ({ user_id }) => text({ count: await countUnread(sql, user_id) }),
);

server.tool(
  "notify_set_preference",
  "Set notification preference for a user/channel/type combination",
  {
    user_id: z.string(),
    channel: z.string(),
    type: z.string(),
    enabled: z.boolean(),
  },
  async ({ user_id, channel, type, enabled }) =>
    text(await setPreference(sql, user_id, channel, type, enabled)),
);

server.tool(
  "notify_create_template",
  "Create a notification template",
  {
    name: z.string(),
    subject: z.string().optional(),
    body: z.string(),
    channel: z.string().optional(),
    variables: z.array(z.string()).optional(),
  },
  async (templateData) => text(await createTemplate(sql, templateData)),
);

server.tool(
  "notify_list_templates",
  "List all notification templates",
  {},
  async () => text(await listTemplates(sql)),
);

server.tool(
  "notify_delete_notification",
  "Delete a notification by ID",
  { id: z.string() },
  async ({ id }) => {
    const deleted = await deleteNotification(sql, id);
    return text({ ok: deleted });
  },
);

server.tool(
  "notify_list_preferences",
  "List all notification preferences for a user",
  { user_id: z.string() },
  async ({ user_id }) => text(await getUserPreferences(sql, user_id)),
);

server.tool(
  "notify_delete_template",
  "Delete a notification template by ID",
  { id: z.string() },
  async ({ id }) => {
    const deleted = await deleteTemplate(sql, id);
    return text({ ok: deleted });
  },
);

server.tool(
  "notify_send_batch",
  "Send multiple notifications in batch",
  {
    notifications: z.array(z.object({
      userId: z.string(),
      workspaceId: z.string().optional(),
      channel: ChannelSchema,
      type: z.string(),
      title: z.string().optional(),
      body: z.string(),
      data: z.record(z.any()).optional(),
    })),
  },
  async ({ notifications }) => {
    const results = await sendBatch(sql, notifications as any);
    return text({
      results,
      total: notifications.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    });
  },
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
