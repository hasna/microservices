#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createAccount,
  getAccount,
  listAccounts,
  updateAccount,
  deleteAccount,
  createTransaction,
  getTransaction,
  listTransactions,
  deleteTransaction,
  getTrialBalance,
  getAccountBalance,
  getIncomeStatement,
} from "../db/bookkeeping.js";

const server = new McpServer({
  name: "microservice-bookkeeping",
  version: "0.0.1",
});

// --- Accounts ---

server.registerTool(
  "create_account",
  {
    title: "Create Account",
    description: "Create a new chart-of-accounts entry.",
    inputSchema: {
      name: z.string(),
      type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
      code: z.string().optional(),
      description: z.string().optional(),
      parent_id: z.string().optional(),
      currency: z.string().optional(),
    },
  },
  async (params) => {
    const account = createAccount(params);
    return { content: [{ type: "text", text: JSON.stringify(account, null, 2) }] };
  }
);

server.registerTool(
  "get_account",
  {
    title: "Get Account",
    description: "Get an account by ID or code.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const account = getAccount(id);
    if (!account) {
      return { content: [{ type: "text", text: `Account '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(account, null, 2) }] };
  }
);

server.registerTool(
  "list_accounts",
  {
    title: "List Accounts",
    description: "List accounts with optional filters.",
    inputSchema: {
      type: z.enum(["asset", "liability", "equity", "revenue", "expense"]).optional(),
      search: z.string().optional(),
      parent_id: z.string().optional(),
      currency: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const accounts = listAccounts(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ accounts, count: accounts.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_account",
  {
    title: "Update Account",
    description: "Update an existing account.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      type: z.enum(["asset", "liability", "equity", "revenue", "expense"]).optional(),
      code: z.string().optional(),
      description: z.string().optional(),
      parent_id: z.string().optional(),
      currency: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const account = updateAccount(id, input);
    if (!account) {
      return { content: [{ type: "text", text: `Account '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(account, null, 2) }] };
  }
);

server.registerTool(
  "delete_account",
  {
    title: "Delete Account",
    description: "Delete an account. Fails if account has transaction entries.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    try {
      const deleted = deleteAccount(id);
      return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// --- Transactions ---

const entrySchema = z.object({
  account_id: z.string(),
  debit: z.number().optional(),
  credit: z.number().optional(),
  description: z.string().optional(),
});

server.registerTool(
  "create_transaction",
  {
    title: "Create Transaction",
    description:
      "Record a double-entry transaction. Entries must balance (total debits = total credits). Requires at least two entries.",
    inputSchema: {
      description: z.string(),
      date: z.string().optional(),
      reference: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
      entries: z.array(entrySchema),
    },
  },
  async (params) => {
    try {
      const txn = createTransaction(params);
      return { content: [{ type: "text", text: JSON.stringify(txn, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_transaction",
  {
    title: "Get Transaction",
    description: "Get a transaction with its entries by ID or reference.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const txn = getTransaction(id);
    if (!txn) {
      return { content: [{ type: "text", text: `Transaction '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(txn, null, 2) }] };
  }
);

server.registerTool(
  "list_transactions",
  {
    title: "List Transactions",
    description: "List transactions with optional filters.",
    inputSchema: {
      from_date: z.string().optional(),
      to_date: z.string().optional(),
      account_id: z.string().optional(),
      reference: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const transactions = listTransactions(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ transactions, count: transactions.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "delete_transaction",
  {
    title: "Delete Transaction",
    description: "Delete a transaction and reverse all account balance changes.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    try {
      const deleted = deleteTransaction(id);
      return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
);

// --- Reports ---

server.registerTool(
  "trial_balance",
  {
    title: "Trial Balance",
    description: "Get the trial balance report. Shows all accounts with their total debits and credits.",
    inputSchema: {},
  },
  async () => {
    const tb = getTrialBalance();
    return { content: [{ type: "text", text: JSON.stringify(tb, null, 2) }] };
  }
);

server.registerTool(
  "account_balance",
  {
    title: "Account Balance",
    description: "Get detailed balance information for a specific account.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const result = getAccountBalance(id);
    if (!result) {
      return { content: [{ type: "text", text: `Account '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "income_statement",
  {
    title: "Income Statement",
    description: "Get the income statement (revenue minus expenses). Optionally filter by date range.",
    inputSchema: {
      from_date: z.string().optional(),
      to_date: z.string().optional(),
    },
  },
  async (params) => {
    const result = getIncomeStatement(params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-bookkeeping MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
