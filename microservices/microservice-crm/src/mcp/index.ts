#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createPipeline,
  listPipelines,
  createStage,
  listStages,
  createDeal,
  getDeal,
  listDeals,
  updateDeal,
  moveDeal,
  closeDeal,
  deleteDeal,
  addActivity,
  listActivities,
  getPipelineSummary,
} from "../db/pipeline.js";

const server = new McpServer({
  name: "microservice-crm",
  version: "0.0.1",
});

// --- Pipelines ---

server.registerTool(
  "create_pipeline",
  {
    title: "Create Pipeline",
    description: "Create a new sales pipeline.",
    inputSchema: {
      name: z.string(),
      description: z.string().optional(),
    },
  },
  async (params) => {
    const pipeline = createPipeline(params);
    return { content: [{ type: "text", text: JSON.stringify(pipeline, null, 2) }] };
  }
);

server.registerTool(
  "list_pipelines",
  {
    title: "List Pipelines",
    description: "List all sales pipelines.",
    inputSchema: {},
  },
  async () => {
    const pipelines = listPipelines();
    return {
      content: [{ type: "text", text: JSON.stringify({ pipelines, count: pipelines.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "pipeline_summary",
  {
    title: "Pipeline Summary",
    description: "Get pipeline summary with deals per stage and total value.",
    inputSchema: { pipeline_id: z.string() },
  },
  async ({ pipeline_id }) => {
    const summary = getPipelineSummary(pipeline_id);
    if (!summary) {
      return { content: [{ type: "text", text: `Pipeline '${pipeline_id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }
);

// --- Stages ---

server.registerTool(
  "create_stage",
  {
    title: "Create Stage",
    description: "Create a new stage in a pipeline.",
    inputSchema: {
      pipeline_id: z.string(),
      name: z.string(),
      sort_order: z.number().optional(),
    },
  },
  async (params) => {
    const stage = createStage(params);
    return { content: [{ type: "text", text: JSON.stringify(stage, null, 2) }] };
  }
);

server.registerTool(
  "list_stages",
  {
    title: "List Stages",
    description: "List stages in a pipeline, ordered by sort_order.",
    inputSchema: { pipeline_id: z.string() },
  },
  async ({ pipeline_id }) => {
    const stages = listStages(pipeline_id);
    return {
      content: [{ type: "text", text: JSON.stringify({ stages, count: stages.length }, null, 2) }],
    };
  }
);

// --- Deals ---

server.registerTool(
  "create_deal",
  {
    title: "Create Deal",
    description: "Create a new deal in a pipeline stage.",
    inputSchema: {
      pipeline_id: z.string(),
      stage_id: z.string(),
      title: z.string(),
      value: z.number().optional(),
      currency: z.string().optional(),
      contact_name: z.string().optional(),
      contact_email: z.string().optional(),
      probability: z.number().optional(),
      expected_close_date: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async (params) => {
    const deal = createDeal(params);
    return { content: [{ type: "text", text: JSON.stringify(deal, null, 2) }] };
  }
);

server.registerTool(
  "get_deal",
  {
    title: "Get Deal",
    description: "Get a deal by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deal = getDeal(id);
    if (!deal) {
      return { content: [{ type: "text", text: `Deal '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(deal, null, 2) }] };
  }
);

server.registerTool(
  "list_deals",
  {
    title: "List Deals",
    description: "List deals with optional filters by pipeline, stage, or status.",
    inputSchema: {
      pipeline_id: z.string().optional(),
      stage_id: z.string().optional(),
      status: z.enum(["open", "won", "lost"]).optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const deals = listDeals(params);
    return {
      content: [{ type: "text", text: JSON.stringify({ deals, count: deals.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "update_deal",
  {
    title: "Update Deal",
    description: "Update deal fields (title, value, contact, probability, etc.).",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      value: z.number().optional(),
      currency: z.string().optional(),
      contact_name: z.string().optional(),
      contact_email: z.string().optional(),
      probability: z.number().optional(),
      expected_close_date: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const deal = updateDeal(id, input);
    if (!deal) {
      return { content: [{ type: "text", text: `Deal '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(deal, null, 2) }] };
  }
);

server.registerTool(
  "move_deal",
  {
    title: "Move Deal",
    description: "Move a deal to a different stage in the pipeline.",
    inputSchema: {
      id: z.string(),
      stage_id: z.string(),
    },
  },
  async ({ id, stage_id }) => {
    const deal = moveDeal(id, stage_id);
    if (!deal) {
      return { content: [{ type: "text", text: `Deal '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(deal, null, 2) }] };
  }
);

server.registerTool(
  "close_deal",
  {
    title: "Close Deal",
    description: "Close a deal as won or lost.",
    inputSchema: {
      id: z.string(),
      outcome: z.enum(["won", "lost"]),
    },
  },
  async ({ id, outcome }) => {
    const deal = closeDeal(id, outcome);
    if (!deal) {
      return { content: [{ type: "text", text: `Deal '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(deal, null, 2) }] };
  }
);

server.registerTool(
  "delete_deal",
  {
    title: "Delete Deal",
    description: "Delete a deal.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteDeal(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Activities ---

server.registerTool(
  "add_activity",
  {
    title: "Add Activity",
    description: "Add an activity (note, call, email, meeting) to a deal.",
    inputSchema: {
      deal_id: z.string(),
      type: z.enum(["note", "call", "email", "meeting"]).optional(),
      description: z.string(),
    },
  },
  async (params) => {
    const activity = addActivity(params);
    return { content: [{ type: "text", text: JSON.stringify(activity, null, 2) }] };
  }
);

server.registerTool(
  "list_activities",
  {
    title: "List Activities",
    description: "List all activities for a deal.",
    inputSchema: { deal_id: z.string() },
  },
  async ({ deal_id }) => {
    const activities = listActivities(deal_id);
    return {
      content: [{ type: "text", text: JSON.stringify({ activities, count: activities.length }, null, 2) }],
    };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-crm MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
