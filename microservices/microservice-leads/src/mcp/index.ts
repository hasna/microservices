#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createLead,
  getLead,
  listLeads,
  updateLead,
  deleteLead,
  searchLeads,
  bulkImportLeads,
  exportLeads,
  addActivity,
  getActivities,
  getLeadTimeline,
  getLeadStats,
  getPipeline,
  deduplicateLeads,
  mergeLeads,
} from "../db/leads.js";
import {
  createList,
  listLists,
  getListMembers,
  getSmartListMembers,
  addToList,
  removeFromList,
  deleteList,
} from "../db/lists.js";
import { enrichLead, bulkEnrich } from "../lib/enrichment.js";
import { scoreLead, autoScoreAll, getScoreDistribution } from "../lib/scoring.js";

const server = new McpServer({
  name: "microservice-leads",
  version: "0.0.1",
});

// --- Lead CRUD ---

server.registerTool(
  "create_lead",
  {
    title: "Create Lead",
    description: "Create a new lead.",
    inputSchema: {
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      company: z.string().optional(),
      title: z.string().optional(),
      website: z.string().optional(),
      linkedin_url: z.string().optional(),
      source: z.string().optional(),
      tags: z.array(z.string()).optional(),
      notes: z.string().optional(),
    },
  },
  async (params) => {
    const lead = createLead(params);
    return { content: [{ type: "text", text: JSON.stringify(lead, null, 2) }] };
  }
);

server.registerTool(
  "get_lead",
  {
    title: "Get Lead",
    description: "Get a lead by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const lead = getLead(id);
    if (!lead) {
      return { content: [{ type: "text", text: `Lead '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(lead, null, 2) }] };
  }
);

server.registerTool(
  "list_leads",
  {
    title: "List Leads",
    description: "List leads with optional filters.",
    inputSchema: {
      status: z.string().optional(),
      source: z.string().optional(),
      score_min: z.number().optional(),
      score_max: z.number().optional(),
      enriched: z.boolean().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
  },
  async (params) => {
    const leads = listLeads(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ leads, count: leads.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_lead",
  {
    title: "Update Lead",
    description: "Update an existing lead.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      company: z.string().optional(),
      title: z.string().optional(),
      website: z.string().optional(),
      linkedin_url: z.string().optional(),
      source: z.string().optional(),
      status: z.string().optional(),
      tags: z.array(z.string()).optional(),
      notes: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const lead = updateLead(id, input);
    if (!lead) {
      return { content: [{ type: "text", text: `Lead '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(lead, null, 2) }] };
  }
);

server.registerTool(
  "delete_lead",
  {
    title: "Delete Lead",
    description: "Delete a lead by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteLead(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "search_leads",
  {
    title: "Search Leads",
    description: "Search leads by name, email, or company.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const results = searchLeads(query);
    return {
      content: [
        { type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) },
      ],
    };
  }
);

// --- Import/Export ---

server.registerTool(
  "bulk_import_leads",
  {
    title: "Bulk Import Leads",
    description: "Import multiple leads at once with deduplication by email.",
    inputSchema: {
      leads: z.array(
        z.object({
          name: z.string().optional(),
          email: z.string().optional(),
          phone: z.string().optional(),
          company: z.string().optional(),
          title: z.string().optional(),
          website: z.string().optional(),
          linkedin_url: z.string().optional(),
          source: z.string().optional(),
        })
      ),
    },
  },
  async ({ leads }) => {
    const result = bulkImportLeads(leads);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "export_leads",
  {
    title: "Export Leads",
    description: "Export leads in CSV or JSON format.",
    inputSchema: {
      format: z.enum(["csv", "json"]).optional(),
      status: z.string().optional(),
    },
  },
  async ({ format, status }) => {
    const output = exportLeads(format || "json", status ? { status } : undefined);
    return { content: [{ type: "text", text: output }] };
  }
);

// --- Enrichment ---

server.registerTool(
  "enrich_lead",
  {
    title: "Enrich Lead",
    description: "Enrich a lead with data from email/domain research.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const lead = enrichLead(id);
    if (!lead) {
      return { content: [{ type: "text", text: `Lead '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(lead, null, 2) }] };
  }
);

server.registerTool(
  "bulk_enrich_leads",
  {
    title: "Bulk Enrich Leads",
    description: "Enrich multiple leads by their IDs.",
    inputSchema: { lead_ids: z.array(z.string()) },
  },
  async ({ lead_ids }) => {
    const result = bulkEnrich(lead_ids);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Scoring ---

server.registerTool(
  "score_lead",
  {
    title: "Score Lead",
    description: "Score a lead (0-100) based on data completeness and engagement.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const result = scoreLead(id);
    if (!result) {
      return { content: [{ type: "text", text: `Lead '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "auto_score_all",
  {
    title: "Auto Score All",
    description: "Auto-score all leads with score=0.",
    inputSchema: {},
  },
  async () => {
    const result = autoScoreAll();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "get_score_distribution",
  {
    title: "Score Distribution",
    description: "Get the distribution of lead scores across ranges.",
    inputSchema: {},
  },
  async () => {
    const distribution = getScoreDistribution();
    return { content: [{ type: "text", text: JSON.stringify(distribution, null, 2) }] };
  }
);

// --- Pipeline & Stats ---

server.registerTool(
  "get_lead_stats",
  {
    title: "Lead Stats",
    description: "Get lead statistics including totals, by status, by source, avg score, and conversion rate.",
    inputSchema: {},
  },
  async () => {
    const stats = getLeadStats();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

server.registerTool(
  "get_pipeline",
  {
    title: "Lead Pipeline",
    description: "Get the lead pipeline funnel view.",
    inputSchema: {},
  },
  async () => {
    const pipeline = getPipeline();
    return { content: [{ type: "text", text: JSON.stringify(pipeline, null, 2) }] };
  }
);

// --- Activities ---

server.registerTool(
  "add_activity",
  {
    title: "Add Activity",
    description: "Add an activity to a lead.",
    inputSchema: {
      lead_id: z.string(),
      type: z.enum(["email_sent", "email_opened", "call", "meeting", "note", "status_change", "score_change", "enriched"]),
      description: z.string().optional(),
    },
  },
  async ({ lead_id, type, description }) => {
    const activity = addActivity(lead_id, type, description);
    return { content: [{ type: "text", text: JSON.stringify(activity, null, 2) }] };
  }
);

server.registerTool(
  "get_activities",
  {
    title: "Get Activities",
    description: "Get activities for a lead.",
    inputSchema: {
      lead_id: z.string(),
      limit: z.number().optional(),
    },
  },
  async ({ lead_id, limit }) => {
    const activities = limit ? getActivities(lead_id, limit) : getActivities(lead_id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ activities, count: activities.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_lead_timeline",
  {
    title: "Lead Timeline",
    description: "Get full activity timeline for a lead.",
    inputSchema: { lead_id: z.string() },
  },
  async ({ lead_id }) => {
    const timeline = getLeadTimeline(lead_id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ timeline, count: timeline.length }, null, 2) },
      ],
    };
  }
);

// --- Dedup & Merge ---

server.registerTool(
  "deduplicate_leads",
  {
    title: "Deduplicate Leads",
    description: "Find duplicate leads by email.",
    inputSchema: {},
  },
  async () => {
    const pairs = deduplicateLeads();
    return { content: [{ type: "text", text: JSON.stringify({ pairs, count: pairs.length }, null, 2) }] };
  }
);

server.registerTool(
  "merge_leads",
  {
    title: "Merge Leads",
    description: "Merge two leads — keep the first, merge data from the second, delete the second.",
    inputSchema: {
      keep_id: z.string(),
      merge_id: z.string(),
    },
  },
  async ({ keep_id, merge_id }) => {
    const result = mergeLeads(keep_id, merge_id);
    if (!result) {
      return { content: [{ type: "text", text: "One or both leads not found." }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Convert ---

server.registerTool(
  "convert_lead",
  {
    title: "Convert Lead",
    description: "Mark a lead as converted.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const lead = updateLead(id, { status: "converted" });
    if (!lead) {
      return { content: [{ type: "text", text: `Lead '${id}' not found.` }], isError: true };
    }
    addActivity(id, "status_change", "Lead converted");
    return { content: [{ type: "text", text: JSON.stringify(lead, null, 2) }] };
  }
);

// --- Lists ---

server.registerTool(
  "create_lead_list",
  {
    title: "Create Lead List",
    description: "Create a lead list.",
    inputSchema: {
      name: z.string(),
      description: z.string().optional(),
      filter_query: z.string().optional(),
    },
  },
  async (params) => {
    const list = createList(params);
    return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
  }
);

server.registerTool(
  "list_lead_lists",
  {
    title: "List Lead Lists",
    description: "List all lead lists.",
    inputSchema: {},
  },
  async () => {
    const lists = listLists();
    return {
      content: [
        { type: "text", text: JSON.stringify({ lists, count: lists.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_list_members",
  {
    title: "Get List Members",
    description: "Get members of a lead list. For smart lists with filter_query, returns dynamically matched leads.",
    inputSchema: {
      list_id: z.string(),
      smart: z.boolean().optional(),
    },
  },
  async ({ list_id, smart }) => {
    const members = smart ? getSmartListMembers(list_id) : getListMembers(list_id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ members, count: members.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "add_to_list",
  {
    title: "Add to List",
    description: "Add a lead to a list.",
    inputSchema: {
      list_id: z.string(),
      lead_id: z.string(),
    },
  },
  async ({ list_id, lead_id }) => {
    const added = addToList(list_id, lead_id);
    return { content: [{ type: "text", text: JSON.stringify({ list_id, lead_id, added }) }] };
  }
);

server.registerTool(
  "remove_from_list",
  {
    title: "Remove from List",
    description: "Remove a lead from a list.",
    inputSchema: {
      list_id: z.string(),
      lead_id: z.string(),
    },
  },
  async ({ list_id, lead_id }) => {
    const removed = removeFromList(list_id, lead_id);
    return { content: [{ type: "text", text: JSON.stringify({ list_id, lead_id, removed }) }] };
  }
);

server.registerTool(
  "delete_lead_list",
  {
    title: "Delete Lead List",
    description: "Delete a lead list.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteList(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-leads MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
