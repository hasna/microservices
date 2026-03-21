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
      status: z.enum(["trialing", "active", "past_due", "canceled", "expired"]).optional(),
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
