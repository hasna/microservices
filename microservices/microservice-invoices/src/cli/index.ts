#!/usr/bin/env bun

import { Command } from "commander";
import {
  createInvoice,
  getInvoiceWithItems,
  listInvoices,
  updateInvoiceStatus,
  deleteInvoice,
  addLineItem,
  removeLineItem,
  recordPayment,
  getInvoiceSummary,
} from "../db/invoices.js";
import {
  createClient,
  getClient,
  listClients,
  updateClient,
  deleteClient,
} from "../db/clients.js";

const program = new Command();

program
  .name("microservice-invoices")
  .description("Invoice management microservice")
  .version("0.0.1");

// --- Invoices ---

program
  .command("create")
  .description("Create a new invoice")
  .option("--client <id>", "Client ID")
  .option("--due <date>", "Due date (YYYY-MM-DD)")
  .option("--currency <code>", "Currency code", "USD")
  .option("--tax-rate <rate>", "Tax rate percentage", "0")
  .option("--discount <amount>", "Discount amount", "0")
  .option("--notes <notes>", "Invoice notes")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const invoice = createInvoice({
      client_id: opts.client,
      due_date: opts.due,
      currency: opts.currency,
      tax_rate: parseFloat(opts.taxRate),
      discount: parseFloat(opts.discount),
      notes: opts.notes,
    });

    if (opts.json) {
      console.log(JSON.stringify(invoice, null, 2));
    } else {
      console.log(`Created invoice: ${invoice.invoice_number} (${invoice.id})`);
    }
  });

program
  .command("get")
  .description("Get an invoice with line items")
  .argument("<id>", "Invoice ID or number")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const invoice = getInvoiceWithItems(id);
    if (!invoice) {
      console.error(`Invoice '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(invoice, null, 2));
    } else {
      console.log(`Invoice: ${invoice.invoice_number}`);
      console.log(`  Status:   ${invoice.status}`);
      console.log(`  Date:     ${invoice.issue_date}`);
      if (invoice.due_date) console.log(`  Due:      ${invoice.due_date}`);
      console.log(`  Currency: ${invoice.currency}`);
      if (invoice.line_items.length > 0) {
        console.log(`  Items:`);
        for (const item of invoice.line_items) {
          console.log(`    - ${item.description}: ${item.quantity} x ${item.unit_price} = ${item.amount}`);
        }
      }
      console.log(`  Subtotal: ${invoice.subtotal}`);
      if (invoice.discount > 0) console.log(`  Discount: -${invoice.discount}`);
      if (invoice.tax_rate > 0) console.log(`  Tax (${invoice.tax_rate}%): ${invoice.tax_amount}`);
      console.log(`  Total:    ${invoice.total}`);
      if (invoice.payments.length > 0) {
        console.log(`  Payments:`);
        for (const p of invoice.payments) {
          console.log(`    - ${p.amount} (${p.method || "unknown"}) on ${p.paid_at}`);
        }
      }
    }
  });

program
  .command("list")
  .description("List invoices")
  .option("--status <status>", "Filter by status")
  .option("--client <id>", "Filter by client")
  .option("--from <date>", "From date")
  .option("--to <date>", "To date")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const invoices = listInvoices({
      status: opts.status,
      client_id: opts.client,
      from_date: opts.from,
      to_date: opts.to,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(invoices, null, 2));
    } else {
      if (invoices.length === 0) {
        console.log("No invoices found.");
        return;
      }
      for (const inv of invoices) {
        const status = inv.status.toUpperCase().padEnd(10);
        console.log(`  ${inv.invoice_number}  ${status}  ${inv.currency} ${inv.total.toFixed(2)}  ${inv.issue_date}`);
      }
      console.log(`\n${invoices.length} invoice(s)`);
    }
  });

program
  .command("mark")
  .description("Update invoice status")
  .argument("<id>", "Invoice ID or number")
  .argument("<status>", "New status: draft|sent|paid|overdue|cancelled|refunded")
  .action((id, status) => {
    const invoice = updateInvoiceStatus(id, status);
    if (!invoice) {
      console.error(`Invoice '${id}' not found.`);
      process.exit(1);
    }
    console.log(`Invoice ${invoice.invoice_number} marked as ${status}.`);
  });

program
  .command("delete")
  .description("Delete an invoice")
  .argument("<id>", "Invoice ID")
  .action((id) => {
    const deleted = deleteInvoice(id);
    if (deleted) {
      console.log(`Deleted invoice ${id}`);
    } else {
      console.error(`Invoice '${id}' not found.`);
      process.exit(1);
    }
  });

program
  .command("add-item")
  .description("Add a line item to an invoice")
  .requiredOption("--invoice <id>", "Invoice ID")
  .requiredOption("--description <text>", "Item description")
  .requiredOption("--price <amount>", "Unit price")
  .option("--quantity <n>", "Quantity", "1")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const item = addLineItem({
      invoice_id: opts.invoice,
      description: opts.description,
      unit_price: parseFloat(opts.price),
      quantity: parseFloat(opts.quantity),
    });

    if (opts.json) {
      console.log(JSON.stringify(item, null, 2));
    } else {
      console.log(`Added: ${item.description} (${item.quantity} x ${item.unit_price} = ${item.amount})`);
    }
  });

program
  .command("remove-item")
  .description("Remove a line item")
  .argument("<id>", "Line item ID")
  .action((id) => {
    const removed = removeLineItem(id);
    if (removed) {
      console.log(`Removed line item ${id}`);
    } else {
      console.error(`Line item '${id}' not found.`);
      process.exit(1);
    }
  });

program
  .command("pay")
  .description("Record a payment")
  .requiredOption("--invoice <id>", "Invoice ID")
  .requiredOption("--amount <amount>", "Payment amount")
  .option("--method <method>", "Payment method")
  .option("--reference <ref>", "Payment reference")
  .option("--notes <notes>", "Notes")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const payment = recordPayment({
      invoice_id: opts.invoice,
      amount: parseFloat(opts.amount),
      method: opts.method,
      reference: opts.reference,
      notes: opts.notes,
    });

    if (opts.json) {
      console.log(JSON.stringify(payment, null, 2));
    } else {
      console.log(`Payment recorded: ${payment.amount} (${payment.method || "unknown"})`);
    }
  });

program
  .command("summary")
  .description("Show invoice summary")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const summary = getInvoiceSummary();

    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log("\n  Invoice Summary");
      console.log(`  Total:       ${summary.total_invoices}`);
      console.log(`  Draft:       ${summary.draft}`);
      console.log(`  Sent:        ${summary.sent}`);
      console.log(`  Paid:        ${summary.paid}`);
      console.log(`  Overdue:     ${summary.overdue}`);
      console.log(`  Outstanding: $${summary.total_outstanding.toFixed(2)}`);
      console.log(`  Collected:   $${summary.total_paid.toFixed(2)}`);
      console.log();
    }
  });

// --- Clients ---

const clientCmd = program.command("client").description("Client management");

clientCmd
  .command("add")
  .description("Add a client")
  .requiredOption("--name <name>", "Client name")
  .option("--email <email>", "Email")
  .option("--phone <phone>", "Phone")
  .option("--address <address>", "Address")
  .option("--tax-id <id>", "Tax ID")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const client = createClient({
      name: opts.name,
      email: opts.email,
      phone: opts.phone,
      address: opts.address,
      tax_id: opts.taxId,
    });

    if (opts.json) {
      console.log(JSON.stringify(client, null, 2));
    } else {
      console.log(`Created client: ${client.name} (${client.id})`);
    }
  });

clientCmd
  .command("list")
  .description("List clients")
  .option("--search <query>", "Search")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const clients = listClients(opts.search);

    if (opts.json) {
      console.log(JSON.stringify(clients, null, 2));
    } else {
      if (clients.length === 0) {
        console.log("No clients found.");
        return;
      }
      for (const c of clients) {
        const email = c.email ? ` <${c.email}>` : "";
        console.log(`  ${c.name}${email}`);
      }
    }
  });

clientCmd
  .command("delete")
  .description("Delete a client")
  .argument("<id>", "Client ID")
  .action((id) => {
    const deleted = deleteClient(id);
    if (deleted) {
      console.log(`Deleted client ${id}`);
    } else {
      console.error(`Client '${id}' not found.`);
      process.exit(1);
    }
  });

program.parse(process.argv);
