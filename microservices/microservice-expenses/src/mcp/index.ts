#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createExpense,
  getExpense,
  listExpenses,
  updateExpense,
  deleteExpense,
  getExpenseSummary,
  createCategory,
  listCategories,
  deleteCategory,
} from "../db/expenses.js";

const server = new McpServer({
  name: "microservice-expenses",
  version: "0.0.1",
});

// --- Expenses ---

server.registerTool(
  "create_expense",
  {
    title: "Create Expense",
    description: "Create a new expense.",
    inputSchema: {
      amount: z.number(),
      currency: z.string().optional(),
      category: z.string().optional(),
      description: z.string().optional(),
      vendor: z.string().optional(),
      date: z.string().optional(),
      receipt_url: z.string().optional(),
      status: z.enum(["pending", "approved", "rejected", "reimbursed"]).optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async (params) => {
    const expense = createExpense(params);
    return { content: [{ type: "text", text: JSON.stringify(expense, null, 2) }] };
  }
);

server.registerTool(
  "get_expense",
  {
    title: "Get Expense",
    description: "Get an expense by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const expense = getExpense(id);
    if (!expense) {
      return { content: [{ type: "text", text: `Expense '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(expense, null, 2) }] };
  }
);

server.registerTool(
  "list_expenses",
  {
    title: "List Expenses",
    description: "List expenses with optional filters.",
    inputSchema: {
      category: z.string().optional(),
      status: z.string().optional(),
      vendor: z.string().optional(),
      from_date: z.string().optional(),
      to_date: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const expenses = listExpenses(params);
    return {
      content: [{ type: "text", text: JSON.stringify({ expenses, count: expenses.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "update_expense",
  {
    title: "Update Expense",
    description: "Update an existing expense.",
    inputSchema: {
      id: z.string(),
      amount: z.number().optional(),
      currency: z.string().optional(),
      category: z.string().optional(),
      description: z.string().optional(),
      vendor: z.string().optional(),
      date: z.string().optional(),
      receipt_url: z.string().optional(),
      status: z.enum(["pending", "approved", "rejected", "reimbursed"]).optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async ({ id, ...input }) => {
    const expense = updateExpense(id, input);
    if (!expense) {
      return { content: [{ type: "text", text: `Expense '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(expense, null, 2) }] };
  }
);

server.registerTool(
  "delete_expense",
  {
    title: "Delete Expense",
    description: "Delete an expense by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteExpense(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "expense_summary",
  {
    title: "Expense Summary",
    description: "Get summary statistics for expenses — totals by status, category, and month.",
    inputSchema: {},
  },
  async () => {
    const summary = getExpenseSummary();
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }
);

// --- Categories ---

server.registerTool(
  "create_category",
  {
    title: "Create Expense Category",
    description: "Create a new expense category.",
    inputSchema: {
      name: z.string(),
      budget_limit: z.number().optional(),
      parent_id: z.string().optional(),
    },
  },
  async (params) => {
    const category = createCategory(params);
    return { content: [{ type: "text", text: JSON.stringify(category, null, 2) }] };
  }
);

server.registerTool(
  "list_categories",
  {
    title: "List Expense Categories",
    description: "List all expense categories.",
    inputSchema: {},
  },
  async () => {
    const categories = listCategories();
    return {
      content: [{ type: "text", text: JSON.stringify({ categories, count: categories.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "delete_category",
  {
    title: "Delete Expense Category",
    description: "Delete an expense category by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteCategory(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-expenses MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
