#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  sendNotification,
  getNotification,
  listNotifications,
  markRead,
  markAllRead,
  markSent,
  markFailed,
  createRule,
  getRule,
  listRules,
  updateRule,
  deleteRule,
  enableRule,
  disableRule,
  createTemplate,
  getTemplate,
  listTemplates,
  deleteTemplate,
  renderTemplate,
  processEvent,
  getNotificationStats,
} from "../db/notifications.js";

const server = new McpServer({
  name: "microservice-notifications",
  version: "0.0.1",
});

// --- Notifications ---

server.registerTool(
  "send_notification",
  {
    title: "Send Notification",
    description: "Send a notification via a specified channel.",
    inputSchema: {
      channel: z.enum(["email", "slack", "sms", "webhook", "in_app"]),
      recipient: z.string(),
      subject: z.string().optional(),
      body: z.string().optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      source_service: z.string().optional(),
      source_event: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async (params) => {
    const notification = sendNotification(params);
    return { content: [{ type: "text", text: JSON.stringify(notification, null, 2) }] };
  }
);

server.registerTool(
  "get_notification",
  {
    title: "Get Notification",
    description: "Get a notification by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const notification = getNotification(id);
    if (!notification) {
      return { content: [{ type: "text", text: `Notification '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(notification, null, 2) }] };
  }
);

server.registerTool(
  "list_notifications",
  {
    title: "List Notifications",
    description: "List notifications with optional filters.",
    inputSchema: {
      status: z.enum(["pending", "sent", "failed", "read"]).optional(),
      channel: z.enum(["email", "slack", "sms", "webhook", "in_app"]).optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      recipient: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const notifications = listNotifications(params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ notifications, count: notifications.length }, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "mark_notification_read",
  {
    title: "Mark Notification Read",
    description: "Mark a notification as read.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const notification = markRead(id);
    if (!notification) {
      return { content: [{ type: "text", text: `Notification '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(notification, null, 2) }] };
  }
);

server.registerTool(
  "mark_all_notifications_read",
  {
    title: "Mark All Notifications Read",
    description: "Mark all notifications as read for a recipient.",
    inputSchema: { recipient: z.string() },
  },
  async ({ recipient }) => {
    const count = markAllRead(recipient);
    return { content: [{ type: "text", text: JSON.stringify({ recipient, marked_read: count }) }] };
  }
);

server.registerTool(
  "mark_notification_sent",
  {
    title: "Mark Notification Sent",
    description: "Mark a notification as sent.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const notification = markSent(id);
    if (!notification) {
      return { content: [{ type: "text", text: `Notification '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(notification, null, 2) }] };
  }
);

server.registerTool(
  "mark_notification_failed",
  {
    title: "Mark Notification Failed",
    description: "Mark a notification as failed.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const notification = markFailed(id);
    if (!notification) {
      return { content: [{ type: "text", text: `Notification '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(notification, null, 2) }] };
  }
);

// --- Rules ---

server.registerTool(
  "create_notification_rule",
  {
    title: "Create Notification Rule",
    description: "Create a rule that triggers notifications on events.",
    inputSchema: {
      name: z.string().optional(),
      trigger_event: z.string(),
      channel: z.string(),
      recipient: z.string(),
      template_id: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async (params) => {
    const rule = createRule(params);
    return { content: [{ type: "text", text: JSON.stringify(rule, null, 2) }] };
  }
);

server.registerTool(
  "get_notification_rule",
  {
    title: "Get Notification Rule",
    description: "Get a notification rule by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const rule = getRule(id);
    if (!rule) {
      return { content: [{ type: "text", text: `Rule '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(rule, null, 2) }] };
  }
);

server.registerTool(
  "list_notification_rules",
  {
    title: "List Notification Rules",
    description: "List all notification rules.",
    inputSchema: {},
  },
  async () => {
    const rules = listRules();
    return {
      content: [
        { type: "text", text: JSON.stringify({ rules, count: rules.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_notification_rule",
  {
    title: "Update Notification Rule",
    description: "Update a notification rule.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      trigger_event: z.string().optional(),
      channel: z.string().optional(),
      recipient: z.string().optional(),
      template_id: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async ({ id, ...input }) => {
    const rule = updateRule(id, input);
    if (!rule) {
      return { content: [{ type: "text", text: `Rule '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(rule, null, 2) }] };
  }
);

server.registerTool(
  "delete_notification_rule",
  {
    title: "Delete Notification Rule",
    description: "Delete a notification rule by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteRule(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "enable_notification_rule",
  {
    title: "Enable Notification Rule",
    description: "Enable a notification rule.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const rule = enableRule(id);
    if (!rule) {
      return { content: [{ type: "text", text: `Rule '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(rule, null, 2) }] };
  }
);

server.registerTool(
  "disable_notification_rule",
  {
    title: "Disable Notification Rule",
    description: "Disable a notification rule.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const rule = disableRule(id);
    if (!rule) {
      return { content: [{ type: "text", text: `Rule '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(rule, null, 2) }] };
  }
);

// --- Templates ---

server.registerTool(
  "create_notification_template",
  {
    title: "Create Notification Template",
    description: "Create a notification template with variable substitution.",
    inputSchema: {
      name: z.string(),
      channel: z.string().optional(),
      subject_template: z.string().optional(),
      body_template: z.string().optional(),
      variables: z.array(z.string()).optional(),
    },
  },
  async (params) => {
    const template = createTemplate(params);
    return { content: [{ type: "text", text: JSON.stringify(template, null, 2) }] };
  }
);

server.registerTool(
  "get_notification_template",
  {
    title: "Get Notification Template",
    description: "Get a notification template by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const template = getTemplate(id);
    if (!template) {
      return { content: [{ type: "text", text: `Template '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(template, null, 2) }] };
  }
);

server.registerTool(
  "list_notification_templates",
  {
    title: "List Notification Templates",
    description: "List all notification templates.",
    inputSchema: {},
  },
  async () => {
    const templates = listTemplates();
    return {
      content: [
        { type: "text", text: JSON.stringify({ templates, count: templates.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "delete_notification_template",
  {
    title: "Delete Notification Template",
    description: "Delete a notification template by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteTemplate(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "render_notification_template",
  {
    title: "Render Notification Template",
    description: "Render a template with variable substitution.",
    inputSchema: {
      template_id: z.string(),
      variables: z.record(z.string()),
    },
  },
  async ({ template_id, variables }) => {
    const rendered = renderTemplate(template_id, variables);
    if (!rendered) {
      return { content: [{ type: "text", text: `Template '${template_id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(rendered, null, 2) }] };
  }
);

// --- Event Processing ---

server.registerTool(
  "process_notification_event",
  {
    title: "Process Notification Event",
    description: "Process an event, matching rules and creating notifications with template substitution.",
    inputSchema: {
      event: z.string(),
      data: z.record(z.string()).optional(),
    },
  },
  async ({ event, data }) => {
    const notifications = processEvent(event, data || {});
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ event, notifications, count: notifications.length }, null, 2),
        },
      ],
    };
  }
);

// --- Stats ---

server.registerTool(
  "get_notification_stats",
  {
    title: "Get Notification Stats",
    description: "Get notification statistics by channel, status, and priority.",
    inputSchema: {},
  },
  async () => {
    const stats = getNotificationStats();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-notifications MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
