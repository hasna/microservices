#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createMetric,
  getMetric,
  listMetrics,
  deleteMetric,
  getMetricTrend,
  createMedication,
  getMedication,
  listMedications,
  updateMedication,
  deactivateMedication,
  getMedicationSchedule,
  createAppointment,
  getAppointment,
  listAppointments,
  updateAppointment,
  completeAppointment,
  cancelAppointment,
  getUpcomingAppointments,
  createFitnessLog,
  getFitnessLog,
  listFitnessLogs,
  deleteFitnessLog,
  getFitnessStats,
  getHealthSummary,
} from "../db/health.js";

const server = new McpServer({
  name: "microservice-health",
  version: "0.0.1",
});

// --- Metrics ---

server.registerTool(
  "record_metric",
  {
    title: "Record Metric",
    description: "Record a health metric (e.g. weight, blood pressure, heart rate).",
    inputSchema: {
      type: z.string(),
      value: z.number(),
      unit: z.string().optional(),
      notes: z.string().optional(),
      recorded_at: z.string().optional(),
    },
  },
  async (params) => {
    const metric = createMetric(params);
    return { content: [{ type: "text", text: JSON.stringify(metric, null, 2) }] };
  }
);

server.registerTool(
  "get_metric",
  {
    title: "Get Metric",
    description: "Get a metric by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const metric = getMetric(id);
    if (!metric) {
      return { content: [{ type: "text", text: `Metric '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(metric, null, 2) }] };
  }
);

server.registerTool(
  "list_metrics",
  {
    title: "List Metrics",
    description: "List health metrics with optional filters.",
    inputSchema: {
      type: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const metrics = listMetrics(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ metrics, count: metrics.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "delete_metric",
  {
    title: "Delete Metric",
    description: "Delete a metric by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteMetric(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "get_metric_trend",
  {
    title: "Get Metric Trend",
    description: "Get daily average trend for a metric type over N days.",
    inputSchema: {
      type: z.string(),
      days: z.number().optional().default(30),
    },
  },
  async ({ type, days }) => {
    const trend = getMetricTrend(type, days);
    return {
      content: [{ type: "text", text: JSON.stringify({ type, days, trend }, null, 2) }],
    };
  }
);

// --- Medications ---

server.registerTool(
  "add_medication",
  {
    title: "Add Medication",
    description: "Add a new medication.",
    inputSchema: {
      name: z.string(),
      dosage: z.string().optional(),
      frequency: z.string().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      refill_date: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async (params) => {
    const med = createMedication(params);
    return { content: [{ type: "text", text: JSON.stringify(med, null, 2) }] };
  }
);

server.registerTool(
  "get_medication",
  {
    title: "Get Medication",
    description: "Get a medication by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const med = getMedication(id);
    if (!med) {
      return { content: [{ type: "text", text: `Medication '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(med, null, 2) }] };
  }
);

server.registerTool(
  "list_medications",
  {
    title: "List Medications",
    description: "List medications with optional filters.",
    inputSchema: {
      active: z.boolean().optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const meds = listMedications(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ medications: meds, count: meds.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_medication",
  {
    title: "Update Medication",
    description: "Update an existing medication.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      dosage: z.string().optional(),
      frequency: z.string().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      refill_date: z.string().optional(),
      notes: z.string().optional(),
      active: z.boolean().optional(),
    },
  },
  async ({ id, ...input }) => {
    const med = updateMedication(id, input);
    if (!med) {
      return { content: [{ type: "text", text: `Medication '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(med, null, 2) }] };
  }
);

server.registerTool(
  "deactivate_medication",
  {
    title: "Deactivate Medication",
    description: "Deactivate a medication (mark as no longer active).",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const med = deactivateMedication(id);
    if (!med) {
      return { content: [{ type: "text", text: `Medication '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(med, null, 2) }] };
  }
);

server.registerTool(
  "get_medication_schedule",
  {
    title: "Get Medication Schedule",
    description: "Get all active medications (current medication schedule).",
    inputSchema: {},
  },
  async () => {
    const meds = getMedicationSchedule();
    return {
      content: [
        { type: "text", text: JSON.stringify({ medications: meds, count: meds.length }, null, 2) },
      ],
    };
  }
);

// --- Appointments ---

server.registerTool(
  "schedule_appointment",
  {
    title: "Schedule Appointment",
    description: "Schedule a new appointment.",
    inputSchema: {
      provider: z.string(),
      scheduled_at: z.string(),
      specialty: z.string().optional(),
      location: z.string().optional(),
      notes: z.string().optional(),
      follow_up_date: z.string().optional(),
    },
  },
  async (params) => {
    const appt = createAppointment(params);
    return { content: [{ type: "text", text: JSON.stringify(appt, null, 2) }] };
  }
);

server.registerTool(
  "get_appointment",
  {
    title: "Get Appointment",
    description: "Get an appointment by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const appt = getAppointment(id);
    if (!appt) {
      return { content: [{ type: "text", text: `Appointment '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(appt, null, 2) }] };
  }
);

server.registerTool(
  "list_appointments",
  {
    title: "List Appointments",
    description: "List appointments with optional filters.",
    inputSchema: {
      status: z.string().optional(),
      provider: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const appts = listAppointments(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ appointments: appts, count: appts.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "complete_appointment",
  {
    title: "Complete Appointment",
    description: "Mark an appointment as completed.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const appt = completeAppointment(id);
    if (!appt) {
      return { content: [{ type: "text", text: `Appointment '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(appt, null, 2) }] };
  }
);

server.registerTool(
  "cancel_appointment",
  {
    title: "Cancel Appointment",
    description: "Cancel an appointment.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const appt = cancelAppointment(id);
    if (!appt) {
      return { content: [{ type: "text", text: `Appointment '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(appt, null, 2) }] };
  }
);

server.registerTool(
  "get_upcoming_appointments",
  {
    title: "Get Upcoming Appointments",
    description: "Get scheduled appointments within the next N days.",
    inputSchema: {
      days: z.number().optional().default(30),
    },
  },
  async ({ days }) => {
    const appts = getUpcomingAppointments(days);
    return {
      content: [
        { type: "text", text: JSON.stringify({ appointments: appts, count: appts.length, days }, null, 2) },
      ],
    };
  }
);

// --- Fitness ---

server.registerTool(
  "log_fitness",
  {
    title: "Log Fitness Activity",
    description: "Log a fitness activity (e.g. running, swimming, yoga).",
    inputSchema: {
      activity: z.string(),
      duration_min: z.number().optional(),
      calories_burned: z.number().optional(),
      distance: z.number().optional(),
      notes: z.string().optional(),
      logged_at: z.string().optional(),
    },
  },
  async (params) => {
    const log = createFitnessLog(params);
    return { content: [{ type: "text", text: JSON.stringify(log, null, 2) }] };
  }
);

server.registerTool(
  "list_fitness_logs",
  {
    title: "List Fitness Logs",
    description: "List fitness logs with optional filters.",
    inputSchema: {
      activity: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const logs = listFitnessLogs(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ logs, count: logs.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_fitness_stats",
  {
    title: "Get Fitness Stats",
    description: "Get fitness statistics for the last N days.",
    inputSchema: {
      days: z.number().optional().default(30),
    },
  },
  async ({ days }) => {
    const stats = getFitnessStats(days);
    return { content: [{ type: "text", text: JSON.stringify({ days, ...stats }, null, 2) }] };
  }
);

// --- Summary ---

server.registerTool(
  "get_health_summary",
  {
    title: "Get Health Summary",
    description: "Get an overview of all health data: metrics, medications, appointments, and fitness.",
    inputSchema: {},
  },
  async () => {
    const summary = getHealthSummary();
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-health MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
