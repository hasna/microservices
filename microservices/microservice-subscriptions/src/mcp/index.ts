#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createPlan,
  getPlan,
  listPlans,
  updatePlan,
  deletePlan,
  createSubscriber,
  getSubscriber,
  listSubscribers,
  cancelSubscriber,
  upgradeSubscriber,
  downgradeSubscriber,
  listEvents,
  getMrr,
  getArr,
  getChurnRate,
  listExpiring,
  getSubscriberStats,
  pauseSubscriber,
  resumeSubscriber,
  extendTrial,
  createDunning,
  listDunning,
  updateDunning,
  bulkImportSubscribers,
  exportSubscribers,
  getLtv,
  getNrr,
  getCohortReport,
  comparePlans,
  getExpiringRenewals,
} from "../db/subscriptions.js";

const server = new McpServer({
  name: "microservice-subscriptions",
  version: "0.0.1",
});

// --- Plans ---

server.registerTool(
  "create_plan",
  {
    title: "Create Plan",
    description: "Create a new subscription plan.",
    inputSchema: {
      name: z.string(),
      price: z.number(),
      interval: z.enum(["monthly", "yearly", "lifetime"]).default("monthly"),
      features: z.array(z.string()).optional(),
      active: z.boolean().optional(),
    },
  },
  async (params) => {
    const plan = createPlan(params);
    return { content: [{ type: "text", text: JSON.stringify(plan, null, 2) }] };
  }
);

server.registerTool(
  "get_plan",
  {
    title: "Get Plan",
    description: "Get a subscription plan by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const plan = getPlan(id);
    if (!plan) {
      return { content: [{ type: "text", text: `Plan '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(plan, null, 2) }] };
  }
);

server.registerTool(
  "list_plans",
  {
    title: "List Plans",
    description: "List subscription plans with optional filters.",
    inputSchema: {
      active_only: z.boolean().optional(),
      interval: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const plans = listPlans(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ plans, count: plans.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_plan",
  {
    title: "Update Plan",
    description: "Update a subscription plan.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      price: z.number().optional(),
      interval: z.enum(["monthly", "yearly", "lifetime"]).optional(),
      features: z.array(z.string()).optional(),
      active: z.boolean().optional(),
    },
  },
  async ({ id, ...input }) => {
    const plan = updatePlan(id, input);
    if (!plan) {
      return { content: [{ type: "text", text: `Plan '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(plan, null, 2) }] };
  }
);

server.registerTool(
  "delete_plan",
  {
    title: "Delete Plan",
    description: "Delete a subscription plan by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deletePlan(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Subscribers ---

server.registerTool(
  "create_subscriber",
  {
    title: "Create Subscriber",
    description: "Create a new subscriber for a plan.",
    inputSchema: {
      plan_id: z.string(),
      customer_name: z.string(),
      customer_email: z.string(),
      status: z.enum(["trialing", "active", "past_due", "canceled", "expired", "paused"]).optional(),
      trial_ends_at: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async (params) => {
    const subscriber = createSubscriber(params);
    return { content: [{ type: "text", text: JSON.stringify(subscriber, null, 2) }] };
  }
);

server.registerTool(
  "get_subscriber",
  {
    title: "Get Subscriber",
    description: "Get a subscriber by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const subscriber = getSubscriber(id);
    if (!subscriber) {
      return { content: [{ type: "text", text: `Subscriber '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(subscriber, null, 2) }] };
  }
);

server.registerTool(
  "list_subscribers",
  {
    title: "List Subscribers",
    description: "List subscribers with optional filters.",
    inputSchema: {
      plan_id: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const subscribers = listSubscribers(params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ subscribers, count: subscribers.length }, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "cancel_subscriber",
  {
    title: "Cancel Subscriber",
    description: "Cancel a subscription.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const subscriber = cancelSubscriber(id);
    if (!subscriber) {
      return { content: [{ type: "text", text: `Subscriber '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(subscriber, null, 2) }] };
  }
);

server.registerTool(
  "upgrade_subscriber",
  {
    title: "Upgrade Subscriber",
    description: "Upgrade a subscriber to a new plan.",
    inputSchema: {
      subscriber_id: z.string(),
      new_plan_id: z.string(),
    },
  },
  async ({ subscriber_id, new_plan_id }) => {
    const subscriber = upgradeSubscriber(subscriber_id, new_plan_id);
    if (!subscriber) {
      return {
        content: [{ type: "text", text: `Subscriber or plan not found.` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(subscriber, null, 2) }] };
  }
);

server.registerTool(
  "downgrade_subscriber",
  {
    title: "Downgrade Subscriber",
    description: "Downgrade a subscriber to a new plan.",
    inputSchema: {
      subscriber_id: z.string(),
      new_plan_id: z.string(),
    },
  },
  async ({ subscriber_id, new_plan_id }) => {
    const subscriber = downgradeSubscriber(subscriber_id, new_plan_id);
    if (!subscriber) {
      return {
        content: [{ type: "text", text: `Subscriber or plan not found.` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(subscriber, null, 2) }] };
  }
);

// --- Events ---

server.registerTool(
  "list_events",
  {
    title: "List Events",
    description: "List subscription events.",
    inputSchema: {
      subscriber_id: z.string().optional(),
      type: z.string().optional(),
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

// --- Analytics ---

server.registerTool(
  "get_mrr",
  {
    title: "Get MRR",
    description: "Get monthly recurring revenue.",
    inputSchema: {},
  },
  async () => {
    const mrr = getMrr();
    return { content: [{ type: "text", text: JSON.stringify({ mrr }) }] };
  }
);

server.registerTool(
  "get_arr",
  {
    title: "Get ARR",
    description: "Get annual recurring revenue.",
    inputSchema: {},
  },
  async () => {
    const arr = getArr();
    return { content: [{ type: "text", text: JSON.stringify({ arr }) }] };
  }
);

server.registerTool(
  "get_churn_rate",
  {
    title: "Get Churn Rate",
    description: "Get churn rate for a period.",
    inputSchema: {
      period_days: z.number().default(30),
    },
  },
  async ({ period_days }) => {
    const rate = getChurnRate(period_days);
    return { content: [{ type: "text", text: JSON.stringify({ churn_rate: rate, period_days }) }] };
  }
);

server.registerTool(
  "list_expiring",
  {
    title: "List Expiring Subscriptions",
    description: "List subscriptions expiring within a number of days.",
    inputSchema: {
      days: z.number().default(7),
    },
  },
  async ({ days }) => {
    const expiring = listExpiring(days);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ expiring, count: expiring.length }, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "get_subscriber_stats",
  {
    title: "Get Subscriber Stats",
    description: "Get subscriber statistics including counts by status, MRR, and ARR.",
    inputSchema: {},
  },
  async () => {
    const stats = getSubscriberStats();
    const mrr = getMrr();
    const arr = getArr();
    return {
      content: [
        { type: "text", text: JSON.stringify({ ...stats, mrr, arr }, null, 2) },
      ],
    };
  }
);

// --- Pause/Resume ---

server.registerTool(
  "pause_subscriber",
  {
    title: "Pause Subscriber",
    description: "Pause a subscription. Paused subscribers are excluded from MRR.",
    inputSchema: {
      id: z.string(),
      resume_date: z.string().optional().describe("Optional scheduled resume date (YYYY-MM-DD HH:MM:SS)"),
    },
  },
  async ({ id, resume_date }) => {
    const subscriber = pauseSubscriber(id, resume_date);
    if (!subscriber) {
      return { content: [{ type: "text", text: `Subscriber '${id}' not found or cannot be paused.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(subscriber, null, 2) }] };
  }
);

server.registerTool(
  "resume_subscriber",
  {
    title: "Resume Subscriber",
    description: "Resume a paused subscription.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const subscriber = resumeSubscriber(id);
    if (!subscriber) {
      return { content: [{ type: "text", text: `Subscriber '${id}' not found or not paused.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(subscriber, null, 2) }] };
  }
);

// --- Trial Extension ---

server.registerTool(
  "extend_trial",
  {
    title: "Extend Trial",
    description: "Extend a subscriber's trial period by a number of days.",
    inputSchema: {
      id: z.string(),
      days: z.number().describe("Number of days to extend the trial"),
    },
  },
  async ({ id, days }) => {
    const subscriber = extendTrial(id, days);
    if (!subscriber) {
      return { content: [{ type: "text", text: `Subscriber '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(subscriber, null, 2) }] };
  }
);

// --- Bulk Import/Export ---

server.registerTool(
  "bulk_import_subscribers",
  {
    title: "Bulk Import Subscribers",
    description: "Bulk import multiple subscribers at once.",
    inputSchema: {
      subscribers: z.array(z.object({
        plan_id: z.string(),
        customer_name: z.string(),
        customer_email: z.string(),
        status: z.enum(["trialing", "active", "past_due", "canceled", "expired", "paused"]).optional(),
        trial_ends_at: z.string().optional(),
        current_period_end: z.string().optional(),
      })),
    },
  },
  async ({ subscribers }) => {
    const imported = bulkImportSubscribers(subscribers);
    return {
      content: [
        { type: "text", text: JSON.stringify({ imported: imported.length, subscribers: imported }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "export_subscribers",
  {
    title: "Export Subscribers",
    description: "Export all subscribers in CSV or JSON format.",
    inputSchema: {
      format: z.enum(["csv", "json"]).default("json"),
    },
  },
  async ({ format }) => {
    const output = exportSubscribers(format);
    return { content: [{ type: "text", text: output }] };
  }
);

// --- Dunning ---

server.registerTool(
  "create_dunning",
  {
    title: "Create Dunning Attempt",
    description: "Create a new dunning attempt for a subscriber.",
    inputSchema: {
      subscriber_id: z.string(),
      attempt_number: z.number().optional(),
      status: z.enum(["pending", "retrying", "failed", "recovered"]).optional(),
      next_retry_at: z.string().optional(),
    },
  },
  async (params) => {
    const attempt = createDunning(params);
    return { content: [{ type: "text", text: JSON.stringify(attempt, null, 2) }] };
  }
);

server.registerTool(
  "list_dunning",
  {
    title: "List Dunning Attempts",
    description: "List dunning attempts with optional filters.",
    inputSchema: {
      subscriber_id: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const attempts = listDunning(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ attempts, count: attempts.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_dunning",
  {
    title: "Update Dunning Attempt",
    description: "Update a dunning attempt status or next retry date.",
    inputSchema: {
      id: z.string(),
      status: z.enum(["pending", "retrying", "failed", "recovered"]).optional(),
      next_retry_at: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const attempt = updateDunning(id, input);
    if (!attempt) {
      return { content: [{ type: "text", text: `Dunning attempt '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(attempt, null, 2) }] };
  }
);

// --- LTV ---

server.registerTool(
  "get_ltv",
  {
    title: "Get LTV",
    description: "Get lifetime value per subscriber and average LTV.",
    inputSchema: {},
  },
  async () => {
    const result = getLtv();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- NRR ---

server.registerTool(
  "get_nrr",
  {
    title: "Get NRR",
    description: "Calculate net revenue retention for a given month.",
    inputSchema: {
      month: z.string().describe("Month in YYYY-MM format"),
    },
  },
  async ({ month }) => {
    const result = getNrr(month);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Cohort Analysis ---

server.registerTool(
  "cohort_report",
  {
    title: "Cohort Report",
    description: "Generate a cohort retention analysis for the last N months.",
    inputSchema: {
      months: z.number().default(6),
    },
  },
  async ({ months }) => {
    const report = getCohortReport(months);
    return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
  }
);

// --- Plan Comparison ---

server.registerTool(
  "compare_plans",
  {
    title: "Compare Plans",
    description: "Compare two plans side by side showing price and feature differences.",
    inputSchema: {
      id1: z.string().describe("First plan ID"),
      id2: z.string().describe("Second plan ID"),
    },
  },
  async ({ id1, id2 }) => {
    const result = comparePlans(id1, id2);
    if (!result) {
      return { content: [{ type: "text", text: "One or both plans not found." }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Expiring Renewals ---

server.registerTool(
  "expiring_renewals",
  {
    title: "Expiring Renewals",
    description: "List subscribers whose current period ends within N days.",
    inputSchema: {
      days: z.number().default(7),
    },
  },
  async ({ days }) => {
    const expiring = getExpiringRenewals(days);
    return {
      content: [
        { type: "text", text: JSON.stringify({ expiring, count: expiring.length }, null, 2) },
      ],
    };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-subscriptions MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
