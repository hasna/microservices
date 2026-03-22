#!/usr/bin/env bun

import { Command } from "commander";
import {
  createProposal,
  getProposal,
  listProposals,
  updateProposal,
  deleteProposal,
  sendProposal,
  acceptProposal,
  declineProposal,
  convertToInvoice,
  listExpiring,
  getProposalStats,
  searchProposals,
  createTemplate,
  listTemplates,
  useTemplate,
} from "../db/proposals.js";

const program = new Command();

program
  .name("microservice-proposals")
  .description("Proposal management microservice")
  .version("0.0.1");

// --- Proposals ---

program
  .command("create")
  .description("Create a new proposal")
  .requiredOption("--title <title>", "Proposal title")
  .requiredOption("--client-name <name>", "Client name")
  .option("--client-email <email>", "Client email")
  .option("--items <json>", "Items as JSON array")
  .option("--tax-rate <rate>", "Tax rate percentage")
  .option("--discount <amount>", "Discount amount")
  .option("--currency <code>", "Currency code", "USD")
  .option("--valid-until <date>", "Valid until date (YYYY-MM-DD)")
  .option("--notes <notes>", "Notes")
  .option("--terms <terms>", "Terms and conditions")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const proposal = createProposal({
      title: opts.title,
      client_name: opts.clientName,
      client_email: opts.clientEmail,
      items: opts.items ? JSON.parse(opts.items) : undefined,
      tax_rate: opts.taxRate ? parseFloat(opts.taxRate) : undefined,
      discount: opts.discount ? parseFloat(opts.discount) : undefined,
      currency: opts.currency,
      valid_until: opts.validUntil,
      notes: opts.notes,
      terms: opts.terms,
    });

    if (opts.json) {
      console.log(JSON.stringify(proposal, null, 2));
    } else {
      console.log(`Created proposal: ${proposal.title} (${proposal.id})`);
    }
  });

program
  .command("get")
  .description("Get a proposal by ID")
  .argument("<id>", "Proposal ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const proposal = getProposal(id);
    if (!proposal) {
      console.error(`Proposal '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(proposal, null, 2));
    } else {
      console.log(`${proposal.title}`);
      console.log(`  Client: ${proposal.client_name}${proposal.client_email ? ` <${proposal.client_email}>` : ""}`);
      console.log(`  Status: ${proposal.status}`);
      console.log(`  Total: ${proposal.currency} ${proposal.total.toFixed(2)}`);
      if (proposal.valid_until) console.log(`  Valid until: ${proposal.valid_until}`);
      if (proposal.notes) console.log(`  Notes: ${proposal.notes}`);
    }
  });

program
  .command("list")
  .description("List proposals")
  .option("--status <status>", "Filter by status")
  .option("--client <name>", "Filter by client name")
  .option("--search <query>", "Search proposals")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const proposals = listProposals({
      status: opts.status,
      client_name: opts.client,
      search: opts.search,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(proposals, null, 2));
    } else {
      if (proposals.length === 0) {
        console.log("No proposals found.");
        return;
      }
      for (const p of proposals) {
        const status = `[${p.status}]`;
        console.log(`  ${p.title} - ${p.client_name} ${status} ${p.currency} ${p.total.toFixed(2)}`);
      }
      console.log(`\n${proposals.length} proposal(s)`);
    }
  });

program
  .command("update")
  .description("Update a proposal")
  .argument("<id>", "Proposal ID")
  .option("--title <title>", "Title")
  .option("--client-name <name>", "Client name")
  .option("--client-email <email>", "Client email")
  .option("--items <json>", "Items as JSON array")
  .option("--tax-rate <rate>", "Tax rate")
  .option("--discount <amount>", "Discount")
  .option("--currency <code>", "Currency code")
  .option("--valid-until <date>", "Valid until date")
  .option("--notes <notes>", "Notes")
  .option("--terms <terms>", "Terms")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.title !== undefined) input.title = opts.title;
    if (opts.clientName !== undefined) input.client_name = opts.clientName;
    if (opts.clientEmail !== undefined) input.client_email = opts.clientEmail;
    if (opts.items !== undefined) input.items = JSON.parse(opts.items);
    if (opts.taxRate !== undefined) input.tax_rate = parseFloat(opts.taxRate);
    if (opts.discount !== undefined) input.discount = parseFloat(opts.discount);
    if (opts.currency !== undefined) input.currency = opts.currency;
    if (opts.validUntil !== undefined) input.valid_until = opts.validUntil;
    if (opts.notes !== undefined) input.notes = opts.notes;
    if (opts.terms !== undefined) input.terms = opts.terms;

    const proposal = updateProposal(id, input);
    if (!proposal) {
      console.error(`Proposal '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(proposal, null, 2));
    } else {
      console.log(`Updated: ${proposal.title}`);
    }
  });

program
  .command("delete")
  .description("Delete a proposal")
  .argument("<id>", "Proposal ID")
  .action((id) => {
    const deleted = deleteProposal(id);
    if (deleted) {
      console.log(`Deleted proposal ${id}`);
    } else {
      console.error(`Proposal '${id}' not found.`);
      process.exit(1);
    }
  });

program
  .command("send")
  .description("Send a proposal (sets status to sent)")
  .argument("<id>", "Proposal ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const proposal = sendProposal(id);
    if (!proposal) {
      console.error(`Proposal '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(proposal, null, 2));
    } else {
      console.log(`Sent proposal: ${proposal.title} to ${proposal.client_name}`);
    }
  });

program
  .command("accept")
  .description("Accept a proposal")
  .argument("<id>", "Proposal ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const proposal = acceptProposal(id);
    if (!proposal) {
      console.error(`Proposal '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(proposal, null, 2));
    } else {
      console.log(`Accepted proposal: ${proposal.title}`);
    }
  });

program
  .command("decline")
  .description("Decline a proposal")
  .argument("<id>", "Proposal ID")
  .option("--reason <reason>", "Decline reason")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const proposal = declineProposal(id, opts.reason);
    if (!proposal) {
      console.error(`Proposal '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(proposal, null, 2));
    } else {
      console.log(`Declined proposal: ${proposal.title}`);
    }
  });

program
  .command("convert")
  .description("Convert an accepted proposal to invoice data")
  .argument("<id>", "Proposal ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const invoiceData = convertToInvoice(id);
    if (!invoiceData) {
      console.error(`Proposal '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(invoiceData, null, 2));
    } else {
      console.log(`Invoice data for: ${invoiceData.client_name}`);
      console.log(`  Total: ${invoiceData.currency} ${invoiceData.total.toFixed(2)}`);
      console.log(`  Items: ${invoiceData.items.length}`);
      console.log(`  Proposal ID: ${invoiceData.proposal_id}`);
    }
  });

program
  .command("search")
  .description("Search proposals")
  .argument("<query>", "Search term")
  .option("--json", "Output as JSON", false)
  .action((query, opts) => {
    const results = searchProposals(query);

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) {
        console.log(`No proposals matching "${query}".`);
        return;
      }
      for (const p of results) {
        console.log(`  ${p.title} - ${p.client_name} [${p.status}]`);
      }
    }
  });

program
  .command("expiring")
  .description("List proposals expiring within N days")
  .option("--days <n>", "Number of days", "30")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const days = parseInt(opts.days);
    const proposals = listExpiring(days);

    if (opts.json) {
      console.log(JSON.stringify(proposals, null, 2));
    } else {
      if (proposals.length === 0) {
        console.log(`No proposals expiring within ${days} days.`);
        return;
      }
      for (const p of proposals) {
        console.log(`  ${p.title} - ${p.client_name} (expires: ${p.valid_until})`);
      }
    }
  });

program
  .command("stats")
  .description("Get proposal statistics")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stats = getProposalStats();

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(`Proposal Statistics:`);
      console.log(`  Total: ${stats.total}`);
      console.log(`  Total Value: $${stats.total_value.toFixed(2)}`);
      console.log(`  Average Value: $${stats.average_value.toFixed(2)}`);
      console.log(`  Conversion Rate: ${stats.conversion_rate.toFixed(1)}%`);
      console.log(`  Accepted Value: $${stats.accepted_value.toFixed(2)}`);
      console.log(`  By Status:`);
      for (const [status, count] of Object.entries(stats.by_status)) {
        console.log(`    ${status}: ${count}`);
      }
    }
  });

// --- Templates ---

const templateCmd = program
  .command("template")
  .description("Proposal template management");

templateCmd
  .command("create")
  .description("Create a proposal template")
  .requiredOption("--name <name>", "Template name")
  .option("--items <json>", "Items as JSON array")
  .option("--terms <terms>", "Default terms")
  .option("--notes <notes>", "Default notes")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const template = createTemplate({
      name: opts.name,
      items: opts.items ? JSON.parse(opts.items) : undefined,
      terms: opts.terms,
      notes: opts.notes,
    });

    if (opts.json) {
      console.log(JSON.stringify(template, null, 2));
    } else {
      console.log(`Created template: ${template.name} (${template.id})`);
    }
  });

templateCmd
  .command("list")
  .description("List all templates")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const templates = listTemplates();

    if (opts.json) {
      console.log(JSON.stringify(templates, null, 2));
    } else {
      if (templates.length === 0) {
        console.log("No templates found.");
        return;
      }
      for (const t of templates) {
        console.log(`  ${t.name} (${t.items.length} items) — ${t.id}`);
      }
    }
  });

templateCmd
  .command("use")
  .description("Create a proposal from a template")
  .argument("<template-id>", "Template ID")
  .requiredOption("--title <title>", "Proposal title")
  .requiredOption("--client-name <name>", "Client name")
  .option("--client-email <email>", "Client email")
  .option("--valid-until <date>", "Valid until date")
  .option("--json", "Output as JSON", false)
  .action((templateId, opts) => {
    const proposal = useTemplate(templateId, {
      title: opts.title,
      client_name: opts.clientName,
      client_email: opts.clientEmail,
      valid_until: opts.validUntil,
    });

    if (!proposal) {
      console.error(`Template '${templateId}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(proposal, null, 2));
    } else {
      console.log(`Created proposal from template: ${proposal.title} (${proposal.id})`);
    }
  });

program.parse(process.argv);
