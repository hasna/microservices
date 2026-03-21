#!/usr/bin/env bun

import { Command } from "commander";
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

const program = new Command();

program
  .name("microservice-contracts")
  .description("Contract and agreement management microservice")
  .version("0.0.1");

// --- Contracts ---

const contractCmd = program
  .command("contract")
  .description("Contract management");

contractCmd
  .command("create")
  .description("Create a new contract")
  .requiredOption("--title <title>", "Contract title")
  .option("--type <type>", "Contract type (nda/service/employment/license/other)", "other")
  .option("--status <status>", "Status (draft/pending_signature/active/expired/terminated)", "draft")
  .option("--counterparty <name>", "Counterparty name")
  .option("--counterparty-email <email>", "Counterparty email")
  .option("--start-date <date>", "Start date (YYYY-MM-DD)")
  .option("--end-date <date>", "End date (YYYY-MM-DD)")
  .option("--auto-renew", "Enable auto-renewal", false)
  .option("--renewal-period <period>", "Renewal period (e.g. '1 year')")
  .option("--value <amount>", "Contract value")
  .option("--currency <code>", "Currency code", "USD")
  .option("--file-path <path>", "Path to contract file")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const contract = createContract({
      title: opts.title,
      type: opts.type,
      status: opts.status,
      counterparty: opts.counterparty,
      counterparty_email: opts.counterpartyEmail,
      start_date: opts.startDate,
      end_date: opts.endDate,
      auto_renew: opts.autoRenew,
      renewal_period: opts.renewalPeriod,
      value: opts.value ? parseFloat(opts.value) : undefined,
      currency: opts.currency,
      file_path: opts.filePath,
    });

    if (opts.json) {
      console.log(JSON.stringify(contract, null, 2));
    } else {
      console.log(`Created contract: ${contract.title} (${contract.id})`);
    }
  });

contractCmd
  .command("list")
  .description("List contracts")
  .option("--search <query>", "Search by title, counterparty, or email")
  .option("--type <type>", "Filter by type")
  .option("--status <status>", "Filter by status")
  .option("--counterparty <name>", "Filter by counterparty")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const contracts = listContracts({
      search: opts.search,
      type: opts.type,
      status: opts.status,
      counterparty: opts.counterparty,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(contracts, null, 2));
    } else {
      if (contracts.length === 0) {
        console.log("No contracts found.");
        return;
      }
      for (const c of contracts) {
        const cp = c.counterparty ? ` — ${c.counterparty}` : "";
        const status = ` [${c.status}]`;
        console.log(`  ${c.title}${cp}${status} (${c.id})`);
      }
      console.log(`\n${contracts.length} contract(s)`);
    }
  });

contractCmd
  .command("get")
  .description("Get a contract by ID")
  .argument("<id>", "Contract ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const contract = getContract(id);
    if (!contract) {
      console.error(`Contract '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(contract, null, 2));
    } else {
      console.log(`${contract.title}`);
      console.log(`  Type: ${contract.type}`);
      console.log(`  Status: ${contract.status}`);
      if (contract.counterparty) console.log(`  Counterparty: ${contract.counterparty}`);
      if (contract.counterparty_email) console.log(`  Email: ${contract.counterparty_email}`);
      if (contract.start_date) console.log(`  Start: ${contract.start_date}`);
      if (contract.end_date) console.log(`  End: ${contract.end_date}`);
      if (contract.value !== null) console.log(`  Value: ${contract.value} ${contract.currency}`);
      if (contract.auto_renew) console.log(`  Auto-renew: ${contract.renewal_period || "1 year"}`);
      if (contract.file_path) console.log(`  File: ${contract.file_path}`);
    }
  });

contractCmd
  .command("update")
  .description("Update a contract")
  .argument("<id>", "Contract ID")
  .option("--title <title>", "Title")
  .option("--type <type>", "Type")
  .option("--status <status>", "Status")
  .option("--counterparty <name>", "Counterparty name")
  .option("--counterparty-email <email>", "Counterparty email")
  .option("--start-date <date>", "Start date")
  .option("--end-date <date>", "End date")
  .option("--auto-renew", "Enable auto-renewal")
  .option("--no-auto-renew", "Disable auto-renewal")
  .option("--renewal-period <period>", "Renewal period")
  .option("--value <amount>", "Value")
  .option("--currency <code>", "Currency")
  .option("--file-path <path>", "File path")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.title !== undefined) input.title = opts.title;
    if (opts.type !== undefined) input.type = opts.type;
    if (opts.status !== undefined) input.status = opts.status;
    if (opts.counterparty !== undefined) input.counterparty = opts.counterparty;
    if (opts.counterpartyEmail !== undefined) input.counterparty_email = opts.counterpartyEmail;
    if (opts.startDate !== undefined) input.start_date = opts.startDate;
    if (opts.endDate !== undefined) input.end_date = opts.endDate;
    if (opts.autoRenew !== undefined) input.auto_renew = opts.autoRenew;
    if (opts.renewalPeriod !== undefined) input.renewal_period = opts.renewalPeriod;
    if (opts.value !== undefined) input.value = parseFloat(opts.value);
    if (opts.currency !== undefined) input.currency = opts.currency;
    if (opts.filePath !== undefined) input.file_path = opts.filePath;

    const contract = updateContract(id, input);
    if (!contract) {
      console.error(`Contract '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(contract, null, 2));
    } else {
      console.log(`Updated: ${contract.title}`);
    }
  });

contractCmd
  .command("delete")
  .description("Delete a contract")
  .argument("<id>", "Contract ID")
  .action((id) => {
    const deleted = deleteContract(id);
    if (deleted) {
      console.log(`Deleted contract ${id}`);
    } else {
      console.error(`Contract '${id}' not found.`);
      process.exit(1);
    }
  });

// --- Expiring & Renew ---

program
  .command("expiring")
  .description("List contracts expiring within N days")
  .option("--days <n>", "Number of days to look ahead", "30")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const days = parseInt(opts.days);
    const contracts = listExpiring(days);

    if (opts.json) {
      console.log(JSON.stringify(contracts, null, 2));
    } else {
      if (contracts.length === 0) {
        console.log(`No contracts expiring within ${days} days.`);
        return;
      }
      for (const c of contracts) {
        console.log(`  ${c.title} — expires ${c.end_date} [${c.status}]`);
      }
      console.log(`\n${contracts.length} contract(s) expiring within ${days} days`);
    }
  });

program
  .command("renew")
  .description("Renew a contract")
  .argument("<id>", "Contract ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const contract = renewContract(id);
    if (!contract) {
      console.error(`Contract '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(contract, null, 2));
    } else {
      console.log(`Renewed: ${contract.title} — new end date: ${contract.end_date}`);
    }
  });

// --- Clauses ---

const clauseCmd = program
  .command("clause")
  .description("Clause management");

clauseCmd
  .command("add")
  .description("Add a clause to a contract")
  .requiredOption("--contract <id>", "Contract ID")
  .requiredOption("--name <name>", "Clause name")
  .requiredOption("--text <text>", "Clause text")
  .option("--type <type>", "Clause type (standard/custom/negotiated)", "standard")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const clause = createClause({
      contract_id: opts.contract,
      name: opts.name,
      text: opts.text,
      type: opts.type,
    });

    if (opts.json) {
      console.log(JSON.stringify(clause, null, 2));
    } else {
      console.log(`Added clause: ${clause.name} (${clause.id})`);
    }
  });

clauseCmd
  .command("list")
  .description("List clauses for a contract")
  .argument("<contract-id>", "Contract ID")
  .option("--json", "Output as JSON", false)
  .action((contractId, opts) => {
    const clauses = listClauses(contractId);

    if (opts.json) {
      console.log(JSON.stringify(clauses, null, 2));
    } else {
      if (clauses.length === 0) {
        console.log("No clauses found.");
        return;
      }
      for (const c of clauses) {
        console.log(`  ${c.name} [${c.type}]: ${c.text.substring(0, 80)}${c.text.length > 80 ? "..." : ""}`);
      }
    }
  });

clauseCmd
  .command("remove")
  .description("Remove a clause")
  .argument("<id>", "Clause ID")
  .action((id) => {
    const deleted = deleteClause(id);
    if (deleted) {
      console.log(`Removed clause ${id}`);
    } else {
      console.error(`Clause '${id}' not found.`);
      process.exit(1);
    }
  });

// --- Reminders ---

const remindCmd = program
  .command("remind")
  .description("Reminder management");

remindCmd
  .command("set")
  .description("Set a reminder for a contract")
  .requiredOption("--contract <id>", "Contract ID")
  .requiredOption("--at <datetime>", "Reminder datetime (ISO 8601)")
  .requiredOption("--message <msg>", "Reminder message")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const reminder = createReminder({
      contract_id: opts.contract,
      remind_at: opts.at,
      message: opts.message,
    });

    if (opts.json) {
      console.log(JSON.stringify(reminder, null, 2));
    } else {
      console.log(`Set reminder: ${reminder.message} at ${reminder.remind_at} (${reminder.id})`);
    }
  });

remindCmd
  .command("list")
  .description("List reminders for a contract")
  .argument("<contract-id>", "Contract ID")
  .option("--json", "Output as JSON", false)
  .action((contractId, opts) => {
    const reminders = listReminders(contractId);

    if (opts.json) {
      console.log(JSON.stringify(reminders, null, 2));
    } else {
      if (reminders.length === 0) {
        console.log("No reminders found.");
        return;
      }
      for (const r of reminders) {
        const sent = r.sent ? " (sent)" : "";
        console.log(`  ${r.remind_at} — ${r.message}${sent}`);
      }
    }
  });

// --- Stats ---

program
  .command("stats")
  .description("Show contract statistics")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stats = getContractStats();

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(`Total contracts: ${stats.total}`);
      console.log("\nBy status:");
      for (const [status, count] of Object.entries(stats.by_status)) {
        console.log(`  ${status}: ${count}`);
      }
      console.log("\nBy type:");
      for (const [type, count] of Object.entries(stats.by_type)) {
        console.log(`  ${type}: ${count}`);
      }
      console.log(`\nTotal active value: ${stats.total_value} USD`);
      console.log(`Expiring within 30 days: ${stats.expiring_30_days}`);
    }
  });

program.parse(process.argv);
