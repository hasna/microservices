#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createEvent,
  getEvent,
  listEvents,
  updateEvent,
  deleteEvent,
  getUpcoming,
  getToday,
  createReminder,
  listPendingReminders,
  markReminderSent,
} from "../db/calendar.js";

const server = new McpServer({
  name: "microservice-calendar",
  version: "0.0.1",
});

// --- Events ---

server.registerTool(
  "create_event",
  {
    title: "Create Event",
    description: "Create a new calendar event.",
    inputSchema: {
      title: z.string(),
      start_at: z.string(),
      end_at: z.string().optional(),
      all_day: z.boolean().optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      calendar: z.string().optional(),
      status: z.enum(["confirmed", "tentative", "cancelled"]).optional(),
      recurrence_rule: z.string().optional(),
      reminder_minutes: z.number().optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async (params) => {
    const event = createEvent(params);
    return { content: [{ type: "text", text: JSON.stringify(event, null, 2) }] };
  }
);

server.registerTool(
  "get_event",
  {
    title: "Get Event",
    description: "Get a calendar event by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const event = getEvent(id);
    if (!event) {
      return { content: [{ type: "text", text: `Event '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(event, null, 2) }] };
  }
);

server.registerTool(
  "list_events",
  {
    title: "List Events",
    description: "List calendar events with optional filters (date range, calendar, status).",
    inputSchema: {
      from: z.string().optional(),
      to: z.string().optional(),
      calendar: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const events = listEvents(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ events, count: events.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_event",
  {
    title: "Update Event",
    description: "Update an existing calendar event.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      start_at: z.string().optional(),
      end_at: z.string().optional(),
      all_day: z.boolean().optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      calendar: z.string().optional(),
      status: z.enum(["confirmed", "tentative", "cancelled"]).optional(),
      recurrence_rule: z.string().optional(),
      reminder_minutes: z.number().optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async ({ id, ...input }) => {
    const event = updateEvent(id, input);
    if (!event) {
      return { content: [{ type: "text", text: `Event '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(event, null, 2) }] };
  }
);

server.registerTool(
  "delete_event",
  {
    title: "Delete Event",
    description: "Delete a calendar event by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteEvent(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "get_upcoming",
  {
    title: "Get Upcoming Events",
    description: "Get the next N upcoming events.",
    inputSchema: {
      limit: z.number().optional(),
    },
  },
  async ({ limit }) => {
    const events = getUpcoming(limit || 10);
    return {
      content: [
        { type: "text", text: JSON.stringify({ events, count: events.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_today",
  {
    title: "Get Today's Events",
    description: "Get all events for today.",
    inputSchema: {},
  },
  async () => {
    const events = getToday();
    return {
      content: [
        { type: "text", text: JSON.stringify({ events, count: events.length }, null, 2) },
      ],
    };
  }
);

// --- Reminders ---

server.registerTool(
  "create_reminder",
  {
    title: "Create Reminder",
    description: "Create a reminder for a calendar event.",
    inputSchema: {
      event_id: z.string(),
      remind_at: z.string(),
    },
  },
  async (params) => {
    const reminder = createReminder(params);
    return { content: [{ type: "text", text: JSON.stringify(reminder, null, 2) }] };
  }
);

server.registerTool(
  "list_pending_reminders",
  {
    title: "List Pending Reminders",
    description: "List all reminders that are due but not yet sent.",
    inputSchema: {},
  },
  async () => {
    const reminders = listPendingReminders();
    return {
      content: [
        { type: "text", text: JSON.stringify({ reminders, count: reminders.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "mark_reminder_sent",
  {
    title: "Mark Reminder Sent",
    description: "Mark a reminder as sent.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const marked = markReminderSent(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, marked }) }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-calendar MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
