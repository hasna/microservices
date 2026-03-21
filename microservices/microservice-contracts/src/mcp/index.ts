#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createContract,
  getContract,
  listContracts,
  updateContract,
  deleteContract,
  searchContracts,
  listExpiring,
  renewContract,
  getContractStats,
  submitForReview,
  approveContract,
  getContractHistory,
  recordSignature,
  listSignatures,
  compareContracts,
  exportContract,
} from "../db/contracts.js";
import {
  createClause,
  listClauses,
  deleteClause,
  addClauseFromTemplate,
  saveClauseTemplate,
  listClauseTemplates,
} from "../db/contracts.js";
import {
  createReminder,
  listReminders,
  deleteReminder,
  setMultiReminders,
} from "../db/contracts.js";
import {
  createObligation,
  listObligations,
  completeObligation,
  listOverdueObligations,
} from "../db/contracts.js";

const server = new McpServer({
  name: "microservice-contracts",
  version: "0.0.1",
});

// --- Contracts ---

server.registerTool(
  "create_contract",
  {
    title: "Create Contract",
    description: "Create a new contract or agreement.",
    inputSchema: {
      title: z.string(),
      type: z.enum(["nda", "service", "employment", "license", "other"]).optional(),
      status: z.enum(["draft", "pending_review", "pending_signature", "active", "expired", "terminated"]).optional(),
      counterparty: z.string().optional(),
      counterparty_email: z.string().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      auto_renew: z.boolean().optional(),
      renewal_period: z.string().optional(),
      value: z.number().optional(),
      currency: z.string().optional(),
      file_path: z.string().optional(),
    },
  },
  async (params) => {
    const contract = createContract(params);
    return { content: [{ type: "text", text: JSON.stringify(contract, null, 2) }] };
  }
);

server.registerTool(
  "get_contract",
  {
    title: "Get Contract",
    description: "Get a contract by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const contract = getContract(id);
    if (!contract) {
      return { content: [{ type: "text", text: `Contract '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(contract, null, 2) }] };
  }
);

server.registerTool(
  "list_contracts",
  {
    title: "List Contracts",
    description: "List contracts with optional filters.",
    inputSchema: {
      search: z.string().optional(),
      type: z.enum(["nda", "service", "employment", "license", "other"]).optional(),
      status: z.enum(["draft", "pending_review", "pending_signature", "active", "expired", "terminated"]).optional(),
      counterparty: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const contracts = listContracts(params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ contracts, count: contracts.length }, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "update_contract",
  {
    title: "Update Contract",
    description: "Update an existing contract.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      type: z.enum(["nda", "service", "employment", "license", "other"]).optional(),
      status: z.enum(["draft", "pending_review", "pending_signature", "active", "expired", "terminated"]).optional(),
      counterparty: z.string().optional(),
      counterparty_email: z.string().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      auto_renew: z.boolean().optional(),
      renewal_period: z.string().optional(),
      value: z.number().optional(),
      currency: z.string().optional(),
      file_path: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const contract = updateContract(id, input);
    if (!contract) {
      return { content: [{ type: "text", text: `Contract '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(contract, null, 2) }] };
  }
);

server.registerTool(
  "delete_contract",
  {
    title: "Delete Contract",
    description: "Delete a contract by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteContract(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "search_contracts",
  {
    title: "Search Contracts",
    description: "Search contracts by title, counterparty, or email.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const results = searchContracts(query);
    return {
      content: [
        { type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "list_expiring_contracts",
  {
    title: "List Expiring Contracts",
    description: "List contracts expiring within the given number of days.",
    inputSchema: { days: z.number().optional() },
  },
  async ({ days }) => {
    const contracts = listExpiring(days ?? 30);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ contracts, count: contracts.length }, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "renew_contract",
  {
    title: "Renew Contract",
    description: "Renew a contract, extending end_date by its renewal_period.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const contract = renewContract(id);
    if (!contract) {
      return { content: [{ type: "text", text: `Contract '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(contract, null, 2) }] };
  }
);

server.registerTool(
  "contract_stats",
  {
    title: "Contract Stats",
    description: "Get aggregate statistics about contracts.",
    inputSchema: {},
  },
  async () => {
    const stats = getContractStats();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

// --- Approval workflow ---

server.registerTool(
  "submit_for_review",
  {
    title: "Submit for Review",
    description: "Submit a draft contract for review (draft -> pending_review).",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    try {
      const contract = submitForReview(id);
      if (!contract) {
        return { content: [{ type: "text", text: `Contract '${id}' not found.` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(contract, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: (err as Error).message }], isError: true };
    }
  }
);

server.registerTool(
  "approve_contract",
  {
    title: "Approve Contract",
    description: "Approve a contract, advancing it through the approval workflow (pending_review -> pending_signature -> active).",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    try {
      const contract = approveContract(id);
      if (!contract) {
        return { content: [{ type: "text", text: `Contract '${id}' not found.` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(contract, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: (err as Error).message }], isError: true };
    }
  }
);

// --- Version history ---

server.registerTool(
  "contract_history",
  {
    title: "Contract History",
    description: "Get version history for a contract, showing previous states before each update.",
    inputSchema: { contract_id: z.string() },
  },
  async ({ contract_id }) => {
    const history = getContractHistory(contract_id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ history, count: history.length }, null, 2) },
      ],
    };
  }
);

// --- Signature logging ---

server.registerTool(
  "record_signature",
  {
    title: "Record Signature",
    description: "Record a signature on a contract.",
    inputSchema: {
      contract_id: z.string(),
      signer_name: z.string(),
      signer_email: z.string().optional(),
      method: z.enum(["digital", "wet", "docusign"]).optional(),
    },
  },
  async (params) => {
    const sig = recordSignature(params);
    return { content: [{ type: "text", text: JSON.stringify(sig, null, 2) }] };
  }
);

server.registerTool(
  "list_signatures",
  {
    title: "List Signatures",
    description: "List all signatures for a contract.",
    inputSchema: { contract_id: z.string() },
  },
  async ({ contract_id }) => {
    const sigs = listSignatures(contract_id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ signatures: sigs, count: sigs.length }, null, 2) },
      ],
    };
  }
);

// --- Contract comparison ---

server.registerTool(
  "compare_contracts",
  {
    title: "Compare Contracts",
    description: "Compare two contracts, showing field and clause differences.",
    inputSchema: {
      id1: z.string(),
      id2: z.string(),
    },
  },
  async ({ id1, id2 }) => {
    try {
      const diff = compareContracts(id1, id2);
      return { content: [{ type: "text", text: JSON.stringify(diff, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: (err as Error).message }], isError: true };
    }
  }
);

// --- Markdown export ---

server.registerTool(
  "export_contract",
  {
    title: "Export Contract",
    description: "Export a contract as formatted markdown or JSON.",
    inputSchema: {
      id: z.string(),
      format: z.enum(["md", "json"]).optional(),
    },
  },
  async ({ id, format }) => {
    try {
      const output = exportContract(id, format || "md");
      return { content: [{ type: "text", text: output }] };
    } catch (err) {
      return { content: [{ type: "text", text: (err as Error).message }], isError: true };
    }
  }
);

// --- Clauses ---

server.registerTool(
  "add_clause",
  {
    title: "Add Clause",
    description: "Add a clause to a contract.",
    inputSchema: {
      contract_id: z.string(),
      name: z.string(),
      text: z.string(),
      type: z.enum(["standard", "custom", "negotiated"]).optional(),
    },
  },
  async (params) => {
    const clause = createClause(params);
    return { content: [{ type: "text", text: JSON.stringify(clause, null, 2) }] };
  }
);

server.registerTool(
  "list_clauses",
  {
    title: "List Clauses",
    description: "List all clauses for a contract.",
    inputSchema: { contract_id: z.string() },
  },
  async ({ contract_id }) => {
    const clauses = listClauses(contract_id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ clauses, count: clauses.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "remove_clause",
  {
    title: "Remove Clause",
    description: "Remove a clause by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteClause(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Clause templates ---

server.registerTool(
  "save_clause_template",
  {
    title: "Save Clause Template",
    description: "Save a clause as a reusable template in the clause library.",
    inputSchema: {
      name: z.string(),
      text: z.string(),
      type: z.enum(["standard", "custom", "negotiated"]).optional(),
    },
  },
  async (params) => {
    const template = saveClauseTemplate(params);
    return { content: [{ type: "text", text: JSON.stringify(template, null, 2) }] };
  }
);

server.registerTool(
  "list_clause_templates",
  {
    title: "List Clause Templates",
    description: "List all clause templates in the clause library.",
    inputSchema: {},
  },
  async () => {
    const templates = listClauseTemplates();
    return {
      content: [
        { type: "text", text: JSON.stringify({ templates, count: templates.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "add_clause_from_template",
  {
    title: "Add Clause from Template",
    description: "Add a clause to a contract using a clause template by name.",
    inputSchema: {
      contract_id: z.string(),
      template_name: z.string(),
    },
  },
  async ({ contract_id, template_name }) => {
    try {
      const clause = addClauseFromTemplate(contract_id, template_name);
      return { content: [{ type: "text", text: JSON.stringify(clause, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: (err as Error).message }], isError: true };
    }
  }
);

// --- Obligations ---

server.registerTool(
  "add_obligation",
  {
    title: "Add Obligation",
    description: "Add an obligation to a clause for tracking.",
    inputSchema: {
      clause_id: z.string(),
      description: z.string(),
      due_date: z.string().optional(),
      assigned_to: z.string().optional(),
    },
  },
  async (params) => {
    const obligation = createObligation(params);
    return { content: [{ type: "text", text: JSON.stringify(obligation, null, 2) }] };
  }
);

server.registerTool(
  "list_obligations",
  {
    title: "List Obligations",
    description: "List all obligations for a clause.",
    inputSchema: { clause_id: z.string() },
  },
  async ({ clause_id }) => {
    const obligations = listObligations(clause_id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ obligations, count: obligations.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "complete_obligation",
  {
    title: "Complete Obligation",
    description: "Mark an obligation as completed.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const obligation = completeObligation(id);
    if (!obligation) {
      return { content: [{ type: "text", text: `Obligation '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(obligation, null, 2) }] };
  }
);

server.registerTool(
  "list_overdue_obligations",
  {
    title: "List Overdue Obligations",
    description: "List all overdue obligations across all contracts.",
    inputSchema: {},
  },
  async () => {
    const obligations = listOverdueObligations();
    return {
      content: [
        { type: "text", text: JSON.stringify({ obligations, count: obligations.length }, null, 2) },
      ],
    };
  }
);

// --- Reminders ---

server.registerTool(
  "set_reminder",
  {
    title: "Set Reminder",
    description: "Set a reminder for a contract.",
    inputSchema: {
      contract_id: z.string(),
      remind_at: z.string(),
      message: z.string(),
    },
  },
  async (params) => {
    const reminder = createReminder(params);
    return { content: [{ type: "text", text: JSON.stringify(reminder, null, 2) }] };
  }
);

server.registerTool(
  "list_reminders",
  {
    title: "List Reminders",
    description: "List all reminders for a contract.",
    inputSchema: { contract_id: z.string() },
  },
  async ({ contract_id }) => {
    const reminders = listReminders(contract_id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ reminders, count: reminders.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "set_multi_reminders",
  {
    title: "Set Multi-Stage Reminders",
    description: "Set multiple reminders at once based on days before contract end date.",
    inputSchema: {
      contract_id: z.string(),
      days_before: z.array(z.number()),
    },
  },
  async ({ contract_id, days_before }) => {
    try {
      const reminders = setMultiReminders(contract_id, days_before);
      return {
        content: [
          { type: "text", text: JSON.stringify({ reminders, count: reminders.length }, null, 2) },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text", text: (err as Error).message }], isError: true };
    }
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-contracts MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
