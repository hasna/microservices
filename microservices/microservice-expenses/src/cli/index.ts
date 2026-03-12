#!/usr/bin/env bun

import { Command } from "commander";
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

const program = new Command();

program
  .name("microservice-expenses")
  .description("Expense management microservice")
  .version("0.0.1");

// --- Expenses ---

program
  .command("add")
  .description("Add a new expense")
  .requiredOption("--amount <amount>", "Expense amount")
  .option("--currency <code>", "Currency code", "USD")
  .option("--category <category>", "Expense category")
  .option("--description <text>", "Description")
  .option("--vendor <vendor>", "Vendor name")
  .option("--date <date>", "Date (YYYY-MM-DD)")
  .option("--receipt <url>", "Receipt URL")
  .option("--status <status>", "Status: pending|approved|rejected|reimbursed", "pending")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const expense = createExpense({
      amount: parseFloat(opts.amount),
      currency: opts.currency,
      category: opts.category,
      description: opts.description,
      vendor: opts.vendor,
      date: opts.date,
      receipt_url: opts.receipt,
      status: opts.status,
      tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(expense, null, 2));
    } else {
      console.log(`Created expense: ${expense.amount} ${expense.currency} (${expense.id})`);
    }
  });

program
  .command("get")
  .description("Get an expense by ID")
  .argument("<id>", "Expense ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const expense = getExpense(id);
    if (!expense) {
      console.error(`Expense '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(expense, null, 2));
    } else {
      console.log(`${expense.amount} ${expense.currency} — ${expense.description || "No description"}`);
      console.log(`  Status:   ${expense.status}`);
      console.log(`  Date:     ${expense.date}`);
      if (expense.category) console.log(`  Category: ${expense.category}`);
      if (expense.vendor) console.log(`  Vendor:   ${expense.vendor}`);
      if (expense.receipt_url) console.log(`  Receipt:  ${expense.receipt_url}`);
      if (expense.tags.length) console.log(`  Tags:     ${expense.tags.join(", ")}`);
    }
  });

program
  .command("list")
  .description("List expenses")
  .option("--category <category>", "Filter by category")
  .option("--status <status>", "Filter by status")
  .option("--vendor <vendor>", "Filter by vendor")
  .option("--from <date>", "From date (YYYY-MM-DD)")
  .option("--to <date>", "To date (YYYY-MM-DD)")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const expenses = listExpenses({
      category: opts.category,
      status: opts.status,
      vendor: opts.vendor,
      from_date: opts.from,
      to_date: opts.to,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(expenses, null, 2));
    } else {
      if (expenses.length === 0) {
        console.log("No expenses found.");
        return;
      }
      for (const e of expenses) {
        const status = e.status.toUpperCase().padEnd(12);
        const desc = e.description || "No description";
        console.log(`  ${e.date}  ${status}  ${e.currency} ${e.amount.toFixed(2)}  ${desc}`);
      }
      console.log(`\n${expenses.length} expense(s)`);
    }
  });

program
  .command("update")
  .description("Update an expense")
  .argument("<id>", "Expense ID")
  .option("--amount <amount>", "Amount")
  .option("--currency <code>", "Currency")
  .option("--category <category>", "Category")
  .option("--description <text>", "Description")
  .option("--vendor <vendor>", "Vendor")
  .option("--date <date>", "Date (YYYY-MM-DD)")
  .option("--receipt <url>", "Receipt URL")
  .option("--status <status>", "Status: pending|approved|rejected|reimbursed")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.amount !== undefined) input.amount = parseFloat(opts.amount);
    if (opts.currency !== undefined) input.currency = opts.currency;
    if (opts.category !== undefined) input.category = opts.category;
    if (opts.description !== undefined) input.description = opts.description;
    if (opts.vendor !== undefined) input.vendor = opts.vendor;
    if (opts.date !== undefined) input.date = opts.date;
    if (opts.receipt !== undefined) input.receipt_url = opts.receipt;
    if (opts.status !== undefined) input.status = opts.status;
    if (opts.tags !== undefined) input.tags = opts.tags.split(",").map((t: string) => t.trim());

    const expense = updateExpense(id, input);
    if (!expense) {
      console.error(`Expense '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(expense, null, 2));
    } else {
      console.log(`Updated: ${expense.amount} ${expense.currency} (${expense.id})`);
    }
  });

program
  .command("delete")
  .description("Delete an expense")
  .argument("<id>", "Expense ID")
  .action((id) => {
    const deleted = deleteExpense(id);
    if (deleted) {
      console.log(`Deleted expense ${id}`);
    } else {
      console.error(`Expense '${id}' not found.`);
      process.exit(1);
    }
  });

program
  .command("summary")
  .description("Show expense summary")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const summary = getExpenseSummary();

    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log("\n  Expense Summary");
      console.log(`  Total:      ${summary.total_expenses}`);
      console.log(`  Pending:    ${summary.pending}`);
      console.log(`  Approved:   ${summary.approved}`);
      console.log(`  Rejected:   ${summary.rejected}`);
      console.log(`  Reimbursed: ${summary.reimbursed}`);
      console.log(`  Amount:     $${summary.total_amount.toFixed(2)}`);
      if (summary.by_category.length > 0) {
        console.log(`\n  By Category:`);
        for (const c of summary.by_category) {
          console.log(`    ${c.category || "Uncategorized"}: $${c.total.toFixed(2)} (${c.count})`);
        }
      }
      if (summary.by_month.length > 0) {
        console.log(`\n  By Month:`);
        for (const m of summary.by_month) {
          console.log(`    ${m.month}: $${m.total.toFixed(2)} (${m.count})`);
        }
      }
      console.log();
    }
  });

// --- Categories ---

const categoryCmd = program
  .command("category")
  .description("Expense category management");

categoryCmd
  .command("add")
  .description("Add an expense category")
  .requiredOption("--name <name>", "Category name")
  .option("--budget <amount>", "Budget limit")
  .option("--parent <id>", "Parent category ID")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const category = createCategory({
      name: opts.name,
      budget_limit: opts.budget ? parseFloat(opts.budget) : undefined,
      parent_id: opts.parent,
    });

    if (opts.json) {
      console.log(JSON.stringify(category, null, 2));
    } else {
      console.log(`Created category: ${category.name} (${category.id})`);
    }
  });

categoryCmd
  .command("list")
  .description("List expense categories")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const categories = listCategories();

    if (opts.json) {
      console.log(JSON.stringify(categories, null, 2));
    } else {
      if (categories.length === 0) {
        console.log("No categories found.");
        return;
      }
      for (const c of categories) {
        const budget = c.budget_limit ? ` (budget: $${c.budget_limit.toFixed(2)})` : "";
        console.log(`  ${c.name}${budget}`);
      }
    }
  });

categoryCmd
  .command("delete")
  .description("Delete an expense category")
  .argument("<id>", "Category ID")
  .action((id) => {
    const deleted = deleteCategory(id);
    if (deleted) {
      console.log(`Deleted category ${id}`);
    } else {
      console.error(`Category '${id}' not found.`);
      process.exit(1);
    }
  });

program.parse(process.argv);
