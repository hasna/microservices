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
} from "../db/contracts.js";
import {
  createClause,
  listClauses,
  deleteClause,
} from "../db/contracts.js";
import {
  createReminder,
  listReminders,
  deleteReminder,
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
      status: z.enum(["draft", "pending_signature", "active", "expired", "terminated"]).optional(),
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
      status: z.enum(["draft", "pending_signature", "active", "expired", "terminated"]).optional(),
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
      status: z.enum(["draft", "pending_signature", "active", "expired", "terminated"]).optional(),
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
