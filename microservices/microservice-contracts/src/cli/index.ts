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
  .option("--status <status>", "Status (draft/pending_review/pending_signature/active/expired/terminated)", "draft")
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

// --- Approval workflow ---

contractCmd
  .command("submit")
  .description("Submit a draft contract for review (draft -> pending_review)")
  .argument("<id>", "Contract ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    try {
      const contract = submitForReview(id);
      if (!contract) {
        console.error(`Contract '${id}' not found.`);
        process.exit(1);
      }
      if (opts.json) {
        console.log(JSON.stringify(contract, null, 2));
      } else {
        console.log(`Submitted for review: ${contract.title} [${contract.status}]`);
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

contractCmd
  .command("approve")
  .description("Approve a contract (advances through approval workflow)")
  .argument("<id>", "Contract ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    try {
      const contract = approveContract(id);
      if (!contract) {
        console.error(`Contract '${id}' not found.`);
        process.exit(1);
      }
      if (opts.json) {
        console.log(JSON.stringify(contract, null, 2));
      } else {
        console.log(`Approved: ${contract.title} [${contract.status}]`);
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

// --- Version history ---

contractCmd
  .command("history")
  .description("Show version history for a contract")
  .argument("<id>", "Contract ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const history = getContractHistory(id);
    if (opts.json) {
      console.log(JSON.stringify(history, null, 2));
    } else {
      if (history.length === 0) {
        console.log("No version history.");
        return;
      }
      for (const v of history) {
        console.log(`  ${v.changed_at} — "${v.title}" [${v.status}] value=${v.value ?? "N/A"}`);
      }
      console.log(`\n${history.length} version(s)`);
    }
  });

// --- Signature logging ---

contractCmd
  .command("sign")
  .description("Record a signature for a contract")
  .argument("<id>", "Contract ID")
  .requiredOption("--signer <name>", "Signer name")
  .option("--email <email>", "Signer email")
  .option("--method <method>", "Signature method (digital/wet/docusign)", "digital")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const sig = recordSignature({
      contract_id: id,
      signer_name: opts.signer,
      signer_email: opts.email,
      method: opts.method,
    });

    if (opts.json) {
      console.log(JSON.stringify(sig, null, 2));
    } else {
      const email = sig.signer_email ? ` (${sig.signer_email})` : "";
      console.log(`Recorded signature: ${sig.signer_name}${email} via ${sig.method} (${sig.id})`);
    }
  });

contractCmd
  .command("signatures")
  .description("List signatures for a contract")
  .argument("<id>", "Contract ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const sigs = listSignatures(id);
    if (opts.json) {
      console.log(JSON.stringify(sigs, null, 2));
    } else {
      if (sigs.length === 0) {
        console.log("No signatures found.");
        return;
      }
      for (const s of sigs) {
        const email = s.signer_email ? ` (${s.signer_email})` : "";
        console.log(`  ${s.signer_name}${email} — ${s.method} — ${s.signed_at}`);
      }
    }
  });

// --- Contract comparison ---

contractCmd
  .command("compare")
  .description("Compare two contracts showing clause differences")
  .argument("<id1>", "First contract ID")
  .argument("<id2>", "Second contract ID")
  .option("--json", "Output as JSON", false)
  .action((id1, id2, opts) => {
    try {
      const diff = compareContracts(id1, id2);
      if (opts.json) {
        console.log(JSON.stringify(diff, null, 2));
      } else {
        console.log(`Comparing: "${diff.contract1.title}" vs "${diff.contract2.title}"\n`);

        if (diff.field_differences.length > 0) {
          console.log("Field differences:");
          for (const d of diff.field_differences) {
            console.log(`  ${d.field}: ${JSON.stringify(d.contract1_value)} vs ${JSON.stringify(d.contract2_value)}`);
          }
          console.log("");
        }

        if (diff.clause_only_in_1.length > 0) {
          console.log(`Clauses only in "${diff.contract1.title}":`);
          for (const c of diff.clause_only_in_1) {
            console.log(`  - ${c.name}`);
          }
          console.log("");
        }

        if (diff.clause_only_in_2.length > 0) {
          console.log(`Clauses only in "${diff.contract2.title}":`);
          for (const c of diff.clause_only_in_2) {
            console.log(`  - ${c.name}`);
          }
          console.log("");
        }

        if (diff.clause_differences.length > 0) {
          console.log("Clause text differences:");
          for (const d of diff.clause_differences) {
            console.log(`  ${d.name}:`);
            console.log(`    Contract 1: ${d.contract1_text.substring(0, 80)}${d.contract1_text.length > 80 ? "..." : ""}`);
            console.log(`    Contract 2: ${d.contract2_text.substring(0, 80)}${d.contract2_text.length > 80 ? "..." : ""}`);
          }
          console.log("");
        }

        if (diff.field_differences.length === 0 && diff.clause_only_in_1.length === 0 && diff.clause_only_in_2.length === 0 && diff.clause_differences.length === 0) {
          console.log("No differences found.");
        }
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

// --- Markdown export ---

contractCmd
  .command("export")
  .description("Export a contract in markdown or JSON format")
  .argument("<id>", "Contract ID")
  .option("--format <format>", "Export format (md/json)", "md")
  .action((id, opts) => {
    try {
      const output = exportContract(id, opts.format);
      console.log(output);
    } catch (err) {
      console.error((err as Error).message);
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
  .option("--text <text>", "Clause text")
  .option("--from-template <templateName>", "Add clause from a template by name")
  .option("--type <type>", "Clause type (standard/custom/negotiated)", "standard")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    try {
      let clause;
      if (opts.fromTemplate) {
        clause = addClauseFromTemplate(opts.contract, opts.fromTemplate);
      } else {
        if (!opts.text) {
          console.error("Either --text or --from-template is required.");
          process.exit(1);
        }
        clause = createClause({
          contract_id: opts.contract,
          name: opts.name,
          text: opts.text,
          type: opts.type,
        });
      }

      if (opts.json) {
        console.log(JSON.stringify(clause, null, 2));
      } else {
        console.log(`Added clause: ${clause.name} (${clause.id})`);
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
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

// --- Clause templates ---

clauseCmd
  .command("save-template")
  .description("Save a clause as a reusable template")
  .requiredOption("--name <name>", "Template name")
  .requiredOption("--text <text>", "Template text")
  .option("--type <type>", "Clause type (standard/custom/negotiated)", "standard")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const template = saveClauseTemplate({
      name: opts.name,
      text: opts.text,
      type: opts.type,
    });

    if (opts.json) {
      console.log(JSON.stringify(template, null, 2));
    } else {
      console.log(`Saved template: ${template.name} (${template.id})`);
    }
  });

clauseCmd
  .command("list-templates")
  .description("List all clause templates")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const templates = listClauseTemplates();

    if (opts.json) {
      console.log(JSON.stringify(templates, null, 2));
    } else {
      if (templates.length === 0) {
        console.log("No clause templates found.");
        return;
      }
      for (const t of templates) {
        console.log(`  ${t.name} [${t.type}]: ${t.text.substring(0, 80)}${t.text.length > 80 ? "..." : ""}`);
      }
    }
  });

// --- Obligations ---

const obligationCmd = program
  .command("obligation")
  .description("Obligation tracking");

obligationCmd
  .command("add")
  .description("Add an obligation to a clause")
  .requiredOption("--clause <id>", "Clause ID")
  .requiredOption("--description <desc>", "Obligation description")
  .option("--due-date <date>", "Due date (YYYY-MM-DD)")
  .option("--assigned-to <name>", "Person assigned to this obligation")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const obligation = createObligation({
      clause_id: opts.clause,
      description: opts.description,
      due_date: opts.dueDate,
      assigned_to: opts.assignedTo,
    });

    if (opts.json) {
      console.log(JSON.stringify(obligation, null, 2));
    } else {
      console.log(`Added obligation: ${obligation.description} (${obligation.id})`);
    }
  });

obligationCmd
  .command("list")
  .description("List obligations for a clause")
  .argument("<clause-id>", "Clause ID")
  .option("--json", "Output as JSON", false)
  .action((clauseId, opts) => {
    const obligations = listObligations(clauseId);

    if (opts.json) {
      console.log(JSON.stringify(obligations, null, 2));
    } else {
      if (obligations.length === 0) {
        console.log("No obligations found.");
        return;
      }
      for (const o of obligations) {
        const due = o.due_date ? ` due ${o.due_date}` : "";
        const assigned = o.assigned_to ? ` (${o.assigned_to})` : "";
        console.log(`  [${o.status}] ${o.description}${due}${assigned}`);
      }
    }
  });

obligationCmd
  .command("complete")
  .description("Mark an obligation as completed")
  .argument("<id>", "Obligation ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const obligation = completeObligation(id);
    if (!obligation) {
      console.error(`Obligation '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(obligation, null, 2));
    } else {
      console.log(`Completed: ${obligation.description}`);
    }
  });

obligationCmd
  .command("overdue")
  .description("List all overdue obligations")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const obligations = listOverdueObligations();

    if (opts.json) {
      console.log(JSON.stringify(obligations, null, 2));
    } else {
      if (obligations.length === 0) {
        console.log("No overdue obligations.");
        return;
      }
      for (const o of obligations) {
        const due = o.due_date ? ` due ${o.due_date}` : "";
        const assigned = o.assigned_to ? ` (${o.assigned_to})` : "";
        console.log(`  [${o.status}] ${o.description}${due}${assigned}`);
      }
      console.log(`\n${obligations.length} overdue obligation(s)`);
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
  .option("--at <datetime>", "Reminder datetime (ISO 8601)")
  .option("--message <msg>", "Reminder message")
  .option("--days-before <days>", "Set multi-stage reminders (comma-separated, e.g. 60,30,7)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    if (opts.daysBefore) {
      try {
        const days = opts.daysBefore.split(",").map((d: string) => parseInt(d.trim()));
        const reminders = setMultiReminders(opts.contract, days);
        if (opts.json) {
          console.log(JSON.stringify(reminders, null, 2));
        } else {
          for (const r of reminders) {
            console.log(`Set reminder: ${r.message} at ${r.remind_at} (${r.id})`);
          }
          console.log(`\n${reminders.length} reminder(s) created`);
        }
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    } else {
      if (!opts.at || !opts.message) {
        console.error("Either --at and --message are required, or use --days-before for multi-stage reminders.");
        process.exit(1);
      }
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
