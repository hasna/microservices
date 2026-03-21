#!/usr/bin/env bun

import { Command } from "commander";
import {
  createPayment,
  getPayment,
  listPayments,
  updatePayment,
  deletePayment,
  refundPayment,
  searchPayments,
  getRevenueReport,
  getRevenueByCustomer,
  reconcileWithInvoice,
  getPaymentStats,
  getBalanceByProvider,
  type PaymentType,
  type PaymentStatus,
  type PaymentProvider,
} from "../db/payments.js";
import {
  listDisputes,
  respondDispute,
  type DisputeStatus,
} from "../db/payments.js";
import {
  createPayout,
  listPayouts,
  type PayoutStatus,
} from "../db/payments.js";

const program = new Command();

program
  .name("microservice-payments")
  .description("Payment processing and tracking microservice")
  .version("0.0.1");

// --- Payments ---

const paymentCmd = program
  .command("payment")
  .description("Payment management");

paymentCmd
  .command("create")
  .description("Create a new payment")
  .requiredOption("--type <type>", "Payment type (charge/refund/transfer/payout)")
  .requiredOption("--amount <amount>", "Amount")
  .option("--currency <currency>", "Currency code", "USD")
  .option("--status <status>", "Status")
  .option("--customer-name <name>", "Customer name")
  .option("--customer-email <email>", "Customer email")
  .option("--description <desc>", "Description")
  .option("--provider <provider>", "Provider (stripe/square/mercury/manual)")
  .option("--provider-id <id>", "Provider transaction ID")
  .option("--invoice-id <id>", "Invoice ID")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const payment = createPayment({
      type: opts.type as PaymentType,
      amount: parseFloat(opts.amount),
      currency: opts.currency,
      status: opts.status as PaymentStatus | undefined,
      customer_name: opts.customerName,
      customer_email: opts.customerEmail,
      description: opts.description,
      provider: opts.provider as PaymentProvider | undefined,
      provider_id: opts.providerId,
      invoice_id: opts.invoiceId,
    });

    if (opts.json) {
      console.log(JSON.stringify(payment, null, 2));
    } else {
      console.log(`Created payment: ${payment.type} $${payment.amount} ${payment.currency} (${payment.id})`);
    }
  });

paymentCmd
  .command("list")
  .description("List payments")
  .option("--status <status>", "Filter by status")
  .option("--type <type>", "Filter by type")
  .option("--provider <provider>", "Filter by provider")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const payments = listPayments({
      status: opts.status as PaymentStatus | undefined,
      type: opts.type as PaymentType | undefined,
      provider: opts.provider as PaymentProvider | undefined,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(payments, null, 2));
    } else {
      if (payments.length === 0) {
        console.log("No payments found.");
        return;
      }
      for (const p of payments) {
        const customer = p.customer_name || p.customer_email || "—";
        console.log(`  ${p.type} $${p.amount} ${p.currency} [${p.status}] ${customer} (${p.id})`);
      }
      console.log(`\n${payments.length} payment(s)`);
    }
  });

paymentCmd
  .command("get")
  .description("Get a payment by ID")
  .argument("<id>", "Payment ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const payment = getPayment(id);
    if (!payment) {
      console.error(`Payment '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(payment, null, 2));
    } else {
      console.log(`${payment.type} — $${payment.amount} ${payment.currency}`);
      console.log(`  Status: ${payment.status}`);
      if (payment.customer_name) console.log(`  Customer: ${payment.customer_name}`);
      if (payment.customer_email) console.log(`  Email: ${payment.customer_email}`);
      if (payment.description) console.log(`  Description: ${payment.description}`);
      if (payment.provider) console.log(`  Provider: ${payment.provider}`);
      if (payment.invoice_id) console.log(`  Invoice: ${payment.invoice_id}`);
      console.log(`  Created: ${payment.created_at}`);
    }
  });

paymentCmd
  .command("refund")
  .description("Refund a payment")
  .argument("<id>", "Payment ID to refund")
  .option("--amount <amount>", "Partial refund amount")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const refund = refundPayment(id, opts.amount ? parseFloat(opts.amount) : undefined);
    if (!refund) {
      console.error(`Cannot refund payment '${id}' — not found or not succeeded.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(refund, null, 2));
    } else {
      console.log(`Refunded $${refund.amount} ${refund.currency} (${refund.id})`);
    }
  });

// --- Disputes ---

const disputeCmd = program
  .command("dispute")
  .description("Dispute management");

disputeCmd
  .command("list")
  .description("List disputes")
  .option("--status <status>", "Filter by status (open/under_review/won/lost)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const disputes = listDisputes(opts.status as DisputeStatus | undefined);

    if (opts.json) {
      console.log(JSON.stringify(disputes, null, 2));
    } else {
      if (disputes.length === 0) {
        console.log("No disputes found.");
        return;
      }
      for (const d of disputes) {
        const amount = d.amount != null ? ` $${d.amount}` : "";
        console.log(`  [${d.status}]${amount} — ${d.reason || "No reason"} (${d.id})`);
      }
      console.log(`\n${disputes.length} dispute(s)`);
    }
  });

disputeCmd
  .command("respond")
  .description("Respond to a dispute")
  .argument("<id>", "Dispute ID")
  .requiredOption("--status <status>", "New status (open/under_review/won/lost)")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const dispute = respondDispute(id, { status: opts.status as DisputeStatus });
    if (!dispute) {
      console.error(`Dispute '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(dispute, null, 2));
    } else {
      console.log(`Dispute ${id} updated to: ${dispute.status}`);
    }
  });

// --- Payouts ---

const payoutCmd = program
  .command("payout")
  .description("Payout management");

payoutCmd
  .command("list")
  .description("List payouts")
  .option("--status <status>", "Filter by status (pending/in_transit/paid/failed)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const payouts = listPayouts(opts.status as PayoutStatus | undefined);

    if (opts.json) {
      console.log(JSON.stringify(payouts, null, 2));
    } else {
      if (payouts.length === 0) {
        console.log("No payouts found.");
        return;
      }
      for (const p of payouts) {
        const dest = p.destination || "—";
        console.log(`  $${p.amount} ${p.currency} [${p.status}] -> ${dest} (${p.id})`);
      }
      console.log(`\n${payouts.length} payout(s)`);
    }
  });

payoutCmd
  .command("initiate")
  .description("Initiate a new payout")
  .requiredOption("--amount <amount>", "Amount")
  .option("--currency <currency>", "Currency code", "USD")
  .option("--destination <dest>", "Destination (bank account, etc.)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const payout = createPayout({
      amount: parseFloat(opts.amount),
      currency: opts.currency,
      destination: opts.destination,
    });

    if (opts.json) {
      console.log(JSON.stringify(payout, null, 2));
    } else {
      console.log(`Initiated payout: $${payout.amount} ${payout.currency} (${payout.id})`);
    }
  });

// --- Balance ---

program
  .command("balance")
  .description("Show balance by provider")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const balances = getBalanceByProvider();

    if (opts.json) {
      console.log(JSON.stringify(balances, null, 2));
    } else {
      if (balances.length === 0) {
        console.log("No payment data.");
        return;
      }
      for (const b of balances) {
        console.log(`  ${b.provider}: charges $${b.total_charges}, refunds $${b.total_refunds}, net $${b.net_balance}`);
      }
    }
  });

// --- Revenue ---

program
  .command("revenue")
  .description("Revenue report for a period")
  .requiredOption("--period <YYYY-MM>", "Month period (e.g. 2024-01)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const [year, month] = opts.period.split("-").map(Number);
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    // Last day of month
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")} 23:59:59`;

    const report = getRevenueReport(startDate, endDate);

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`Revenue Report: ${opts.period}`);
      console.log(`  Total Revenue:  $${report.total_revenue.toFixed(2)}`);
      console.log(`  Total Refunds:  $${report.total_refunds.toFixed(2)}`);
      console.log(`  Net Revenue:    $${report.net_revenue.toFixed(2)}`);
      console.log(`  Payments: ${report.payment_count}  Refunds: ${report.refund_count}`);
    }
  });

// --- Reconcile ---

program
  .command("reconcile")
  .description("Link a payment to an invoice")
  .requiredOption("--payment <id>", "Payment ID")
  .requiredOption("--invoice <id>", "Invoice ID")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const payment = reconcileWithInvoice(opts.payment, opts.invoice);
    if (!payment) {
      console.error(`Payment '${opts.payment}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(payment, null, 2));
    } else {
      console.log(`Linked payment ${payment.id} to invoice ${payment.invoice_id}`);
    }
  });

// --- Stats ---

program
  .command("stats")
  .description("Payment statistics")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stats = getPaymentStats();

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log("Payment Statistics:");
      console.log(`  Total Payments: ${stats.total_payments}`);
      console.log(`  Charges: ${stats.total_charges}`);
      console.log(`  Refunds: ${stats.total_refunds}`);
      console.log(`  Transfers: ${stats.total_transfers}`);
      console.log(`  Payouts: ${stats.total_payouts}`);
      console.log(`  Total Amount: $${stats.total_amount.toFixed(2)}`);
      console.log("  By Status:");
      for (const [s, c] of Object.entries(stats.by_status)) {
        console.log(`    ${s}: ${c}`);
      }
      console.log("  By Provider:");
      for (const [p, c] of Object.entries(stats.by_provider)) {
        console.log(`    ${p}: ${c}`);
      }
    }
  });

program.parse(process.argv);
