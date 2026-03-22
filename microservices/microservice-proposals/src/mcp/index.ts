#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createProposal,
  getProposal,
  listProposals,
  updateProposal,
  deleteProposal,
  sendProposal,
  markViewed,
  acceptProposal,
  declineProposal,
  convertToInvoice,
  listExpiring,
  getProposalStats,
  searchProposals,
  countProposals,
  createTemplate,
  listTemplates,
  deleteTemplate,
  useTemplate,
} from "../db/proposals.js";

const itemSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unit_price: z.number(),
  amount: z.number(),
});

const server = new McpServer({
  name: "microservice-proposals",
  version: "0.0.1",
});

// --- Proposals ---

server.registerTool(
  "create_proposal",
  {
    title: "Create Proposal",
    description: "Create a new proposal.",
    inputSchema: {
      title: z.string(),
      client_name: z.string(),
      client_email: z.string().optional(),
      items: z.array(itemSchema).optional(),
      tax_rate: z.number().optional(),
      discount: z.number().optional(),
      currency: z.string().optional(),
      valid_until: z.string().optional(),
      notes: z.string().optional(),
      terms: z.string().optional(),
    },
  },
  async (params) => {
    const proposal = createProposal(params);
    return { content: [{ type: "text", text: JSON.stringify(proposal, null, 2) }] };
  }
);

server.registerTool(
  "get_proposal",
  {
    title: "Get Proposal",
    description: "Get a proposal by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const proposal = getProposal(id);
    if (!proposal) {
      return { content: [{ type: "text", text: `Proposal '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(proposal, null, 2) }] };
  }
);

server.registerTool(
  "list_proposals",
  {
    title: "List Proposals",
    description: "List proposals with optional filters.",
    inputSchema: {
      status: z.enum(["draft", "sent", "viewed", "accepted", "declined", "expired"]).optional(),
      client_name: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const proposals = listProposals(params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ proposals, count: proposals.length }, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "update_proposal",
  {
    title: "Update Proposal",
    description: "Update an existing proposal.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      client_name: z.string().optional(),
      client_email: z.string().optional(),
      items: z.array(itemSchema).optional(),
      tax_rate: z.number().optional(),
      discount: z.number().optional(),
      currency: z.string().optional(),
      valid_until: z.string().optional(),
      notes: z.string().optional(),
      terms: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const proposal = updateProposal(id, input);
    if (!proposal) {
      return { content: [{ type: "text", text: `Proposal '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(proposal, null, 2) }] };
  }
);

server.registerTool(
  "delete_proposal",
  {
    title: "Delete Proposal",
    description: "Delete a proposal by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteProposal(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "send_proposal",
  {
    title: "Send Proposal",
    description: "Send a proposal — sets status to 'sent' and records sent_at timestamp.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const proposal = sendProposal(id);
    if (!proposal) {
      return { content: [{ type: "text", text: `Proposal '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(proposal, null, 2) }] };
  }
);

server.registerTool(
  "mark_proposal_viewed",
  {
    title: "Mark Proposal Viewed",
    description: "Mark a proposal as viewed — sets status to 'viewed' and records viewed_at timestamp.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const proposal = markViewed(id);
    if (!proposal) {
      return { content: [{ type: "text", text: `Proposal '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(proposal, null, 2) }] };
  }
);

server.registerTool(
  "accept_proposal",
  {
    title: "Accept Proposal",
    description: "Accept a proposal — sets status to 'accepted' and records responded_at timestamp.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const proposal = acceptProposal(id);
    if (!proposal) {
      return { content: [{ type: "text", text: `Proposal '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(proposal, null, 2) }] };
  }
);

server.registerTool(
  "decline_proposal",
  {
    title: "Decline Proposal",
    description: "Decline a proposal with an optional reason.",
    inputSchema: {
      id: z.string(),
      reason: z.string().optional(),
    },
  },
  async ({ id, reason }) => {
    const proposal = declineProposal(id, reason);
    if (!proposal) {
      return { content: [{ type: "text", text: `Proposal '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(proposal, null, 2) }] };
  }
);

server.registerTool(
  "convert_proposal_to_invoice",
  {
    title: "Convert Proposal to Invoice",
    description: "Convert a proposal into invoice-ready data.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const invoiceData = convertToInvoice(id);
    if (!invoiceData) {
      return { content: [{ type: "text", text: `Proposal '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(invoiceData, null, 2) }] };
  }
);

server.registerTool(
  "list_expiring_proposals",
  {
    title: "List Expiring Proposals",
    description: "List proposals expiring within a given number of days.",
    inputSchema: { days: z.number().default(30) },
  },
  async ({ days }) => {
    const proposals = listExpiring(days);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ proposals, count: proposals.length }, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "get_proposal_stats",
  {
    title: "Get Proposal Stats",
    description: "Get proposal statistics including conversion rate, total value, and status breakdown.",
    inputSchema: {},
  },
  async () => {
    const stats = getProposalStats();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

server.registerTool(
  "search_proposals",
  {
    title: "Search Proposals",
    description: "Search proposals by title, client name, email, or notes.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const results = searchProposals(query);
    return {
      content: [
        { type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "count_proposals",
  {
    title: "Count Proposals",
    description: "Get the total number of proposals.",
    inputSchema: {},
  },
  async () => {
    const count = countProposals();
    return { content: [{ type: "text", text: JSON.stringify({ count }) }] };
  }
);

// --- Templates ---

server.registerTool(
  "create_proposal_template",
  {
    title: "Create Proposal Template",
    description: "Create a reusable proposal template.",
    inputSchema: {
      name: z.string(),
      items: z.array(itemSchema).optional(),
      terms: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async (params) => {
    const template = createTemplate(params);
    return { content: [{ type: "text", text: JSON.stringify(template, null, 2) }] };
  }
);

server.registerTool(
  "list_proposal_templates",
  {
    title: "List Proposal Templates",
    description: "List all proposal templates.",
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
  "delete_proposal_template",
  {
    title: "Delete Proposal Template",
    description: "Delete a proposal template by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteTemplate(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "use_proposal_template",
  {
    title: "Use Proposal Template",
    description: "Create a new proposal from a template.",
    inputSchema: {
      template_id: z.string(),
      title: z.string(),
      client_name: z.string(),
      client_email: z.string().optional(),
      valid_until: z.string().optional(),
    },
  },
  async ({ template_id, ...overrides }) => {
    const proposal = useTemplate(template_id, overrides);
    if (!proposal) {
      return { content: [{ type: "text", text: `Template '${template_id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(proposal, null, 2) }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-proposals MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
