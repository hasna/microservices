#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createHabit,
  getHabit,
  listHabits,
  updateHabit,
  deleteHabit,
  activateHabit,
  deactivateHabit,
  completeHabit,
  getStreak,
  getAllStreaks,
  getCompletionRate,
  getCompletions,
  getTodayStatus,
  getWeeklyReport,
  countHabits,
} from "../db/habits.js";

const server = new McpServer({
  name: "microservice-habits",
  version: "0.0.1",
});

// --- Habits CRUD ---

server.registerTool(
  "create_habit",
  {
    title: "Create Habit",
    description: "Create a new habit to track.",
    inputSchema: {
      name: z.string(),
      description: z.string().optional(),
      frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
      target_count: z.number().optional(),
      category: z.string().optional(),
    },
  },
  async (params) => {
    const habit = createHabit(params);
    return { content: [{ type: "text", text: JSON.stringify(habit, null, 2) }] };
  }
);

server.registerTool(
  "get_habit",
  {
    title: "Get Habit",
    description: "Get a habit by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const habit = getHabit(id);
    if (!habit) {
      return { content: [{ type: "text", text: `Habit '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(habit, null, 2) }] };
  }
);

server.registerTool(
  "list_habits",
  {
    title: "List Habits",
    description: "List habits with optional filters.",
    inputSchema: {
      category: z.string().optional(),
      active: z.boolean().optional(),
      frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const habits = listHabits(params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ habits, count: habits.length }, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "update_habit",
  {
    title: "Update Habit",
    description: "Update an existing habit.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
      target_count: z.number().optional(),
      category: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const habit = updateHabit(id, input);
    if (!habit) {
      return { content: [{ type: "text", text: `Habit '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(habit, null, 2) }] };
  }
);

server.registerTool(
  "delete_habit",
  {
    title: "Delete Habit",
    description: "Delete a habit by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteHabit(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "activate_habit",
  {
    title: "Activate Habit",
    description: "Activate a deactivated habit.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const habit = activateHabit(id);
    if (!habit) {
      return { content: [{ type: "text", text: `Habit '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(habit, null, 2) }] };
  }
);

server.registerTool(
  "deactivate_habit",
  {
    title: "Deactivate Habit",
    description: "Deactivate a habit without deleting it.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const habit = deactivateHabit(id);
    if (!habit) {
      return { content: [{ type: "text", text: `Habit '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(habit, null, 2) }] };
  }
);

// --- Completions ---

server.registerTool(
  "complete_habit",
  {
    title: "Complete Habit",
    description: "Record a habit completion. Auto-updates streak.",
    inputSchema: {
      id: z.string(),
      notes: z.string().optional(),
      value: z.number().optional(),
    },
  },
  async ({ id, notes, value }) => {
    const completion = completeHabit(id, notes, value);
    if (!completion) {
      return { content: [{ type: "text", text: `Habit '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(completion, null, 2) }] };
  }
);

server.registerTool(
  "get_completions",
  {
    title: "Get Completions",
    description: "Get completion history for a habit.",
    inputSchema: {
      habit_id: z.string(),
      limit: z.number().optional(),
    },
  },
  async ({ habit_id, limit }) => {
    const completions = getCompletions(habit_id, limit);
    return {
      content: [
        { type: "text", text: JSON.stringify({ completions, count: completions.length }, null, 2) },
      ],
    };
  }
);

// --- Streaks ---

server.registerTool(
  "get_streak",
  {
    title: "Get Streak",
    description: "Get streak information for a habit.",
    inputSchema: { habit_id: z.string() },
  },
  async ({ habit_id }) => {
    const streak = getStreak(habit_id);
    if (!streak) {
      return { content: [{ type: "text", text: `No streak data for habit '${habit_id}'.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(streak, null, 2) }] };
  }
);

server.registerTool(
  "get_all_streaks",
  {
    title: "Get All Streaks",
    description: "Get streaks for all active habits.",
    inputSchema: {},
  },
  async () => {
    const streaks = getAllStreaks();
    return {
      content: [
        { type: "text", text: JSON.stringify({ streaks, count: streaks.length }, null, 2) },
      ],
    };
  }
);

// --- Analytics ---

server.registerTool(
  "get_completion_rate",
  {
    title: "Get Completion Rate",
    description: "Get completion rate percentage for a habit over N days.",
    inputSchema: {
      habit_id: z.string(),
      days: z.number().default(30),
    },
  },
  async ({ habit_id, days }) => {
    const rate = getCompletionRate(habit_id, days);
    return {
      content: [{ type: "text", text: JSON.stringify({ habit_id, days, rate }) }],
    };
  }
);

server.registerTool(
  "get_today_status",
  {
    title: "Get Today Status",
    description: "Get today's completion status for all active habits.",
    inputSchema: {},
  },
  async () => {
    const status = getTodayStatus();
    return {
      content: [
        { type: "text", text: JSON.stringify({ status, count: status.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_weekly_report",
  {
    title: "Get Weekly Report",
    description: "Get weekly completion report for all active habits.",
    inputSchema: {},
  },
  async () => {
    const report = getWeeklyReport();
    return {
      content: [
        { type: "text", text: JSON.stringify({ report, count: report.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "count_habits",
  {
    title: "Count Habits",
    description: "Get total number of habits.",
    inputSchema: {},
  },
  async () => {
    const count = countHabits();
    return { content: [{ type: "text", text: JSON.stringify({ count }) }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-habits MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
