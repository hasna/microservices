#!/usr/bin/env bun

import { Command } from "commander";
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

const program = new Command();

program
  .name("microservice-bookkeeping")
  .description("Double-entry bookkeeping microservice")
  .version("0.0.1");

// --- Accounts ---

const accountCmd = program
  .command("account")
  .alias("acc")
  .description("Account management");

accountCmd
  .command("add")
  .description("Add a new account")
  .requiredOption("--name <name>", "Account name")
  .requiredOption("--type <type>", "Account type: asset|liability|equity|revenue|expense")
  .option("--code <code>", "Account code")
  .option("--description <text>", "Description")
  .option("--parent <id>", "Parent account ID")
  .option("--currency <code>", "Currency code", "USD")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const account = createAccount({
      name: opts.name,
      type: opts.type,
      code: opts.code,
      description: opts.description,
      parent_id: opts.parent,
      currency: opts.currency,
    });

    if (opts.json) {
      console.log(JSON.stringify(account, null, 2));
    } else {
      console.log(`Created account: ${account.name} [${account.type}] (${account.id})`);
    }
  });

accountCmd
  .command("get")
  .description("Get an account by ID or code")
  .argument("<id>", "Account ID or code")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const account = getAccount(id);
    if (!account) {
      console.error(`Account '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(account, null, 2));
    } else {
      console.log(`${account.name} [${account.type}]`);
      if (account.code) console.log(`  Code:     ${account.code}`);
      if (account.description) console.log(`  Desc:     ${account.description}`);
      console.log(`  Balance:  ${account.currency} ${account.balance.toFixed(2)}`);
      console.log(`  Currency: ${account.currency}`);
    }
  });

accountCmd
  .command("list")
  .description("List accounts")
  .option("--type <type>", "Filter by type: asset|liability|equity|revenue|expense")
  .option("--search <query>", "Search by name, code, or description")
  .option("--parent <id>", "Filter by parent account")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const accounts = listAccounts({
      type: opts.type,
      search: opts.search,
      parent_id: opts.parent,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(accounts, null, 2));
    } else {
      if (accounts.length === 0) {
        console.log("No accounts found.");
        return;
      }
      for (const a of accounts) {
        const code = a.code ? `[${a.code}] ` : "";
        console.log(`  ${code}${a.name} (${a.type}) — ${a.currency} ${a.balance.toFixed(2)}`);
      }
      console.log(`\n${accounts.length} account(s)`);
    }
  });

accountCmd
  .command("update")
  .description("Update an account")
  .argument("<id>", "Account ID or code")
  .option("--name <name>", "Name")
  .option("--type <type>", "Type")
  .option("--code <code>", "Code")
  .option("--description <text>", "Description")
  .option("--parent <id>", "Parent account ID")
  .option("--currency <code>", "Currency")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.type !== undefined) input.type = opts.type;
    if (opts.code !== undefined) input.code = opts.code;
    if (opts.description !== undefined) input.description = opts.description;
    if (opts.parent !== undefined) input.parent_id = opts.parent;
    if (opts.currency !== undefined) input.currency = opts.currency;

    const account = updateAccount(id, input);
    if (!account) {
      console.error(`Account '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(account, null, 2));
    } else {
      console.log(`Updated: ${account.name} [${account.type}]`);
    }
  });

accountCmd
  .command("delete")
  .description("Delete an account")
  .argument("<id>", "Account ID")
  .action((id) => {
    try {
      const deleted = deleteAccount(id);
      if (deleted) {
        console.log(`Deleted account ${id}`);
      } else {
        console.error(`Account '${id}' not found.`);
        process.exit(1);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

accountCmd
  .command("balance")
  .description("Get account balance details")
  .argument("<id>", "Account ID or code")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const result = getAccountBalance(id);
    if (!result) {
      console.error(`Account '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`${result.account.name} [${result.account.type}]`);
      console.log(`  Total Debits:  ${result.total_debits.toFixed(2)}`);
      console.log(`  Total Credits: ${result.total_credits.toFixed(2)}`);
      console.log(`  Balance:       ${result.account.currency} ${result.balance.toFixed(2)}`);
    }
  });

// --- Transactions ---

program
  .command("record")
  .description("Record a transaction (JSON entries via --entries)")
  .requiredOption("--description <text>", "Transaction description")
  .requiredOption("--entries <json>", "JSON array of entries: [{account_id, debit, credit, description}]")
  .option("--date <date>", "Transaction date (YYYY-MM-DD)")
  .option("--reference <ref>", "Reference number")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    try {
      const entries = JSON.parse(opts.entries);
      const txn = createTransaction({
        description: opts.description,
        date: opts.date,
        reference: opts.reference,
        entries,
      });

      if (opts.json) {
        console.log(JSON.stringify(txn, null, 2));
      } else {
        console.log(`Recorded transaction: ${txn.description} (${txn.id})`);
        console.log(`  Date: ${txn.date}`);
        if (txn.reference) console.log(`  Ref:  ${txn.reference}`);
        for (const e of txn.entries) {
          const dr = e.debit > 0 ? `DR ${e.debit.toFixed(2)}` : "";
          const cr = e.credit > 0 ? `CR ${e.credit.toFixed(2)}` : "";
          console.log(`  ${e.account_id}: ${dr}${cr}${e.description ? ` — ${e.description}` : ""}`);
        }
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command("get")
  .description("Get a transaction by ID or reference")
  .argument("<id>", "Transaction ID or reference")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const txn = getTransaction(id);
    if (!txn) {
      console.error(`Transaction '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(txn, null, 2));
    } else {
      console.log(`Transaction: ${txn.description}`);
      console.log(`  Date: ${txn.date}`);
      if (txn.reference) console.log(`  Ref:  ${txn.reference}`);
      console.log(`  Entries:`);
      for (const e of txn.entries) {
        const dr = e.debit > 0 ? `DR ${e.debit.toFixed(2)}` : "";
        const cr = e.credit > 0 ? `CR ${e.credit.toFixed(2)}` : "";
        console.log(`    ${e.account_id}: ${dr}${cr}`);
      }
    }
  });

program
  .command("list")
  .description("List transactions")
  .option("--from <date>", "From date (YYYY-MM-DD)")
  .option("--to <date>", "To date (YYYY-MM-DD)")
  .option("--account <id>", "Filter by account ID")
  .option("--reference <ref>", "Filter by reference")
  .option("--search <query>", "Search description or reference")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const transactions = listTransactions({
      from_date: opts.from,
      to_date: opts.to,
      account_id: opts.account,
      reference: opts.reference,
      search: opts.search,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(transactions, null, 2));
    } else {
      if (transactions.length === 0) {
        console.log("No transactions found.");
        return;
      }
      for (const txn of transactions) {
        const ref = txn.reference ? ` [${txn.reference}]` : "";
        const totalDebit = txn.entries.reduce((s, e) => s + e.debit, 0);
        console.log(`  ${txn.date}  ${txn.description}${ref}  ${totalDebit.toFixed(2)}`);
      }
      console.log(`\n${transactions.length} transaction(s)`);
    }
  });

program
  .command("delete")
  .description("Delete a transaction (reverses balances)")
  .argument("<id>", "Transaction ID")
  .action((id) => {
    try {
      const deleted = deleteTransaction(id);
      if (deleted) {
        console.log(`Deleted transaction ${id}`);
      } else {
        console.error(`Transaction '${id}' not found.`);
        process.exit(1);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// --- Reports ---

program
  .command("trial-balance")
  .alias("tb")
  .description("Show trial balance")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const tb = getTrialBalance();

    if (opts.json) {
      console.log(JSON.stringify(tb, null, 2));
    } else {
      console.log("\n  Trial Balance");
      console.log("  " + "-".repeat(60));
      console.log("  Account".padEnd(40) + "Debits".padStart(12) + "Credits".padStart(12));
      console.log("  " + "-".repeat(60));
      for (const entry of tb.entries) {
        const name = (entry.account_code ? `[${entry.account_code}] ` : "") + entry.account_name;
        console.log(
          `  ${name.padEnd(38)}${entry.debit.toFixed(2).padStart(12)}${entry.credit.toFixed(2).padStart(12)}`
        );
      }
      console.log("  " + "-".repeat(60));
      console.log(
        `  ${"TOTALS".padEnd(38)}${tb.total_debits.toFixed(2).padStart(12)}${tb.total_credits.toFixed(2).padStart(12)}`
      );
      console.log(`  Balanced: ${tb.balanced ? "YES" : "NO"}`);
      console.log();
    }
  });

program
  .command("income-statement")
  .alias("is")
  .description("Show income statement (revenue - expenses)")
  .option("--from <date>", "From date")
  .option("--to <date>", "To date")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const is_ = getIncomeStatement({
      from_date: opts.from,
      to_date: opts.to,
    });

    if (opts.json) {
      console.log(JSON.stringify(is_, null, 2));
    } else {
      console.log("\n  Income Statement");
      console.log("  " + "-".repeat(50));

      if (is_.revenue.length > 0) {
        console.log("  REVENUE:");
        for (const r of is_.revenue) {
          const name = (r.account_code ? `[${r.account_code}] ` : "") + r.account_name;
          console.log(`    ${name.padEnd(36)}${r.amount.toFixed(2).padStart(12)}`);
        }
        console.log(`    ${"Total Revenue".padEnd(36)}${is_.total_revenue.toFixed(2).padStart(12)}`);
      }

      console.log();

      if (is_.expenses.length > 0) {
        console.log("  EXPENSES:");
        for (const e of is_.expenses) {
          const name = (e.account_code ? `[${e.account_code}] ` : "") + e.account_name;
          console.log(`    ${name.padEnd(36)}${e.amount.toFixed(2).padStart(12)}`);
        }
        console.log(`    ${"Total Expenses".padEnd(36)}${is_.total_expenses.toFixed(2).padStart(12)}`);
      }

      console.log();
      console.log("  " + "-".repeat(50));
      console.log(`  ${"NET INCOME".padEnd(38)}${is_.net_income.toFixed(2).padStart(12)}`);
      console.log();
    }
  });

program.parse(process.argv);
