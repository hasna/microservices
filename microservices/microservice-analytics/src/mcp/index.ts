#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  recordKpi,
  getKpi,
  getKpiTrend,
  listKpis,
  getLatestKpis,
  deleteKpi,
  createDashboard,
  getDashboard,
  listDashboards,
  updateDashboard,
  deleteDashboard,
  generateReport,
  getReport,
  listReports,
  deleteReport,
  getBusinessHealth,
  generateExecutiveSummary,
} from "../db/analytics.js";

const server = new McpServer({
  name: "microservice-analytics",
  version: "0.0.1",
});

// --- KPIs ---

server.registerTool(
  "record_kpi",
  {
    title: "Record KPI",
    description: "Record a KPI value.",
    inputSchema: {
      name: z.string(),
      value: z.number(),
      category: z.string().optional(),
      source_service: z.string().optional(),
      period: z.string().optional(),
    },
  },
  async (params) => {
    const kpi = recordKpi(params);
    return { content: [{ type: "text", text: JSON.stringify(kpi, null, 2) }] };
  }
);

server.registerTool(
  "get_kpi",
  {
    title: "Get KPI",
    description: "Get the latest value for a KPI by name.",
    inputSchema: {
      name: z.string(),
      period: z.string().optional(),
    },
  },
  async ({ name, period }) => {
    const kpi = getKpi(name, period);
    if (!kpi) {
      return { content: [{ type: "text", text: `KPI '${name}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(kpi, null, 2) }] };
  }
);

server.registerTool(
  "get_kpi_trend",
  {
    title: "Get KPI Trend",
    description: "Get the trend for a KPI over a number of days.",
    inputSchema: {
      name: z.string(),
      days: z.number().optional(),
    },
  },
  async ({ name, days }) => {
    const trend = getKpiTrend(name, days);
    return {
      content: [
        { type: "text", text: JSON.stringify({ trend, count: trend.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "list_kpis",
  {
    title: "List KPIs",
    description: "List KPIs with optional filters.",
    inputSchema: {
      category: z.string().optional(),
      source_service: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const kpis = listKpis(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ kpis, count: kpis.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_latest_kpis",
  {
    title: "Get Latest KPIs",
    description: "Get the most recent value for each unique KPI.",
    inputSchema: {},
  },
  async () => {
    const kpis = getLatestKpis();
    return {
      content: [
        { type: "text", text: JSON.stringify({ kpis, count: kpis.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "delete_kpi",
  {
    title: "Delete KPI",
    description: "Delete a KPI entry by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteKpi(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Dashboards ---

server.registerTool(
  "create_dashboard",
  {
    title: "Create Dashboard",
    description: "Create a new dashboard.",
    inputSchema: {
      name: z.string(),
      description: z.string().optional(),
      widgets: z.array(z.unknown()).optional(),
    },
  },
  async (params) => {
    const dashboard = createDashboard(params);
    return { content: [{ type: "text", text: JSON.stringify(dashboard, null, 2) }] };
  }
);

server.registerTool(
  "get_dashboard",
  {
    title: "Get Dashboard",
    description: "Get a dashboard by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const dashboard = getDashboard(id);
    if (!dashboard) {
      return { content: [{ type: "text", text: `Dashboard '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(dashboard, null, 2) }] };
  }
);

server.registerTool(
  "list_dashboards",
  {
    title: "List Dashboards",
    description: "List all dashboards.",
    inputSchema: {},
  },
  async () => {
    const dashboards = listDashboards();
    return {
      content: [
        { type: "text", text: JSON.stringify({ dashboards, count: dashboards.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_dashboard",
  {
    title: "Update Dashboard",
    description: "Update a dashboard.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      widgets: z.array(z.unknown()).optional(),
    },
  },
  async ({ id, ...input }) => {
    const dashboard = updateDashboard(id, input);
    if (!dashboard) {
      return { content: [{ type: "text", text: `Dashboard '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(dashboard, null, 2) }] };
  }
);

server.registerTool(
  "delete_dashboard",
  {
    title: "Delete Dashboard",
    description: "Delete a dashboard by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteDashboard(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Reports ---

server.registerTool(
  "generate_report",
  {
    title: "Generate Report",
    description: "Generate a business report.",
    inputSchema: {
      name: z.string(),
      type: z.enum(["daily", "weekly", "monthly", "quarterly", "annual", "custom"]),
      period: z.string().optional(),
    },
  },
  async (params) => {
    const report = generateReport(params);
    return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
  }
);

server.registerTool(
  "get_report",
  {
    title: "Get Report",
    description: "Get a report by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const report = getReport(id);
    if (!report) {
      return { content: [{ type: "text", text: `Report '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
  }
);

server.registerTool(
  "list_reports",
  {
    title: "List Reports",
    description: "List reports with optional filters.",
    inputSchema: {
      type: z.enum(["daily", "weekly", "monthly", "quarterly", "annual", "custom"]).optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const reports = listReports(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ reports, count: reports.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "delete_report",
  {
    title: "Delete Report",
    description: "Delete a report by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteReport(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Health & Summary ---

server.registerTool(
  "get_business_health",
  {
    title: "Get Business Health",
    description: "Get overall business health summary across all KPI categories.",
    inputSchema: {},
  },
  async () => {
    const health = getBusinessHealth();
    return { content: [{ type: "text", text: JSON.stringify(health, null, 2) }] };
  }
);

server.registerTool(
  "generate_executive_summary",
  {
    title: "Generate Executive Summary",
    description: "Generate an AI-powered executive summary of KPI trends.",
    inputSchema: {},
  },
  async () => {
    const summary = await generateExecutiveSummary();
    return { content: [{ type: "text", text: summary }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-analytics MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
