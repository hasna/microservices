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
  autoReconcile,
  retryPayment,
  listRetries,
  getRetryStats,
  convertCurrency,
  feeAnalysis,
  declineReport,
  addDisputeEvidence,
  splitPayment,
  revenueForecast,
  findReconciliationGaps,
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

// --- Payment Retry ---

paymentCmd
  .command("retry")
  .description("Retry a failed payment")
  .argument("<id>", "Payment ID to retry")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const attempt = retryPayment(id);
    if (!attempt) {
      console.error(`Cannot retry payment '${id}' — not found or not failed.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(attempt, null, 2));
    } else {
      console.log(`Retry attempt #${attempt.attempt} for payment ${id}: ${attempt.status}`);
    }
  });

paymentCmd
  .command("retries")
  .description("List retry attempts for a payment")
  .argument("<paymentId>", "Payment ID")
  .option("--json", "Output as JSON", false)
  .action((paymentId, opts) => {
    const retries = listRetries(paymentId);

    if (opts.json) {
      console.log(JSON.stringify(retries, null, 2));
    } else {
      if (retries.length === 0) {
        console.log("No retry attempts found.");
        return;
      }
      for (const r of retries) {
        console.log(`  Attempt #${r.attempt} [${r.status}] ${r.attempted_at || ""} ${r.error || ""}`);
      }
      console.log(`\n${retries.length} retry attempt(s)`);
    }
  });

// --- Payment Convert ---

paymentCmd
  .command("convert")
  .description("Convert currency amount")
  .requiredOption("--from <currency>", "Source currency")
  .requiredOption("--to <currency>", "Target currency")
  .requiredOption("--amount <amount>", "Amount to convert")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const result = convertCurrency(parseFloat(opts.amount), opts.from, opts.to);
    if (!result) {
      console.error(`Unsupported currency pair: ${opts.from} -> ${opts.to}`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`${result.original_amount} ${result.from} = ${result.converted_amount} ${result.to} (rate: ${result.rate})`);
    }
  });

// --- Decline Report ---

paymentCmd
  .command("decline-report")
  .description("Show decline analytics for failed payments")
  .option("--provider <provider>", "Filter by provider")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const report = declineReport(opts.provider as PaymentProvider | undefined);

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      if (report.entries.length === 0) {
        console.log("No declined payments found.");
        return;
      }
      console.log("Decline Report:");
      for (const e of report.entries) {
        console.log(`  [${e.provider}] "${e.description || "No description"}" — ${e.count} decline(s), $${e.total_amount.toFixed(2)}`);
      }
      console.log(`\nTotal: ${report.total_declined} decline(s), $${report.total_amount.toFixed(2)}`);
    }
  });

// --- Payment Split ---

paymentCmd
  .command("split")
  .description("Split a payment into marketplace commission splits")
  .argument("<id>", "Payment ID")
  .requiredOption("--splits <json>", "Split percentages as JSON (e.g. '{\"vendor1\":70,\"vendor2\":30}')")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    let splits: Record<string, number>;
    try {
      splits = JSON.parse(opts.splits);
    } catch {
      console.error("Invalid JSON for --splits");
      process.exit(1);
    }

    const payment = splitPayment(id, splits);
    if (!payment) {
      console.error(`Payment '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(payment, null, 2));
    } else {
      console.log(`Payment ${id} split recorded: ${JSON.stringify(splits)}`);
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

disputeCmd
  .command("add-evidence")
  .description("Add evidence to a dispute")
  .argument("<id>", "Dispute ID")
  .requiredOption("--description <desc>", "Evidence description")
  .option("--file-ref <path>", "File reference path")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const dispute = addDisputeEvidence(id, opts.description, opts.fileRef);
    if (!dispute) {
      console.error(`Dispute '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(dispute, null, 2));
    } else {
      console.log(`Evidence added to dispute ${id}: "${opts.description}"`);
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

const revenueCmd = program
  .command("revenue")
  .description("Revenue reports and forecasting");

revenueCmd
  .command("report")
  .description("Revenue report for a period")
  .requiredOption("--period <YYYY-MM>", "Month period (e.g. 2024-01)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const [year, month] = opts.period.split("-").map(Number);
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
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

revenueCmd
  .command("forecast")
  .description("Project revenue for upcoming months based on recent trends")
  .requiredOption("--months <n>", "Number of months to forecast")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const result = revenueForecast(parseInt(opts.months));

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Revenue Forecast (${result.months_projected} months, trend: ${result.trend})`);
      console.log("  Historical:");
      for (const h of result.historical) {
        console.log(`    ${h.month}: $${h.revenue.toFixed(2)}`);
      }
      console.log("  Forecast:");
      for (const f of result.forecast) {
        console.log(`    ${f.month}: $${f.projected_revenue.toFixed(2)} (projected)`);
      }
      console.log(`  Average Monthly Revenue: $${result.average_monthly_revenue.toFixed(2)}`);
    }
  });

// --- Reconcile ---

const reconcileCmd = program
  .command("reconcile")
  .description("Reconciliation commands");

reconcileCmd
  .command("link")
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

reconcileCmd
  .command("auto")
  .description("Auto-reconcile payments to invoices by amount, email, and date")
  .option("--from <date>", "Start date (YYYY-MM-DD)")
  .option("--to <date>", "End date (YYYY-MM-DD)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const result = autoReconcile(opts.from, opts.to);

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("Auto-Reconciliation Results:");
      console.log(`  Matched: ${result.matched.length}`);
      for (const m of result.matched) {
        console.log(`    Payment ${m.payment_id} -> Invoice ${m.invoice_id} (${m.confidence})`);
      }
      console.log(`  Unmatched Payments: ${result.unmatched_payments.length}`);
      console.log(`  Unmatched Invoices: ${result.unmatched_invoices.length}`);
    }
  });

reconcileCmd
  .command("check-gaps")
  .description("Find reconciliation gaps — payments without invoices and vice versa")
  .requiredOption("--from <date>", "Start date (YYYY-MM-DD)")
  .requiredOption("--to <date>", "End date (YYYY-MM-DD)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const gaps = findReconciliationGaps(opts.from, opts.to);

    if (opts.json) {
      console.log(JSON.stringify(gaps, null, 2));
    } else {
      console.log("Reconciliation Gaps:");
      console.log(`  Payments without invoice: ${gaps.payments_without_invoice.length}`);
      for (const p of gaps.payments_without_invoice) {
        console.log(`    $${p.amount} ${p.currency} — ${p.customer_email || "no email"} (${p.id})`);
      }
      console.log(`  Invoice IDs without succeeded payment: ${gaps.invoice_ids_without_payment.length}`);
      for (const inv of gaps.invoice_ids_without_payment) {
        console.log(`    ${inv}`);
      }
      console.log(`  Total gaps: ${gaps.gap_count}`);
    }
  });

// --- Fees ---

program
  .command("fees")
  .description("Fee analysis by provider for a given month")
  .requiredOption("--month <YYYY-MM>", "Month period (e.g. 2026-03)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const result = feeAnalysis(opts.month);

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Fee Analysis: ${result.month}`);
      for (const p of result.providers) {
        console.log(`  ${p.provider}: gross $${p.gross.toFixed(2)}, fees $${p.fees.toFixed(2)}, net $${p.net.toFixed(2)} (${p.transaction_count} txns)`);
      }
      console.log(`  Total: gross $${result.total_gross.toFixed(2)}, fees $${result.total_fees.toFixed(2)}, net $${result.total_net.toFixed(2)}`);
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
