#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
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
  listByProvider,
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
} from "../db/payments.js";
import {
  createDispute,
  getDispute,
  listDisputes,
  respondDispute,
  deleteDispute,
} from "../db/payments.js";
import {
  createPayout,
  getPayout,
  listPayouts,
  updatePayout,
  deletePayout,
} from "../db/payments.js";

const server = new McpServer({
  name: "microservice-payments",
  version: "0.0.1",
});

// --- Payments ---

server.registerTool(
  "create_payment",
  {
    title: "Create Payment",
    description: "Create a new payment record.",
    inputSchema: {
      type: z.enum(["charge", "refund", "transfer", "payout"]),
      amount: z.number(),
      currency: z.string().optional(),
      status: z.enum(["pending", "succeeded", "failed", "disputed", "refunded"]).optional(),
      customer_name: z.string().optional(),
      customer_email: z.string().optional(),
      description: z.string().optional(),
      provider: z.enum(["stripe", "square", "mercury", "manual"]).optional(),
      provider_id: z.string().optional(),
      invoice_id: z.string().optional(),
    },
  },
  async (params) => {
    const payment = createPayment(params);
    return { content: [{ type: "text", text: JSON.stringify(payment, null, 2) }] };
  }
);

server.registerTool(
  "get_payment",
  {
    title: "Get Payment",
    description: "Get a payment by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const payment = getPayment(id);
    if (!payment) {
      return { content: [{ type: "text", text: `Payment '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(payment, null, 2) }] };
  }
);

server.registerTool(
  "list_payments",
  {
    title: "List Payments",
    description: "List payments with optional filters.",
    inputSchema: {
      status: z.enum(["pending", "succeeded", "failed", "disputed", "refunded"]).optional(),
      type: z.enum(["charge", "refund", "transfer", "payout"]).optional(),
      provider: z.enum(["stripe", "square", "mercury", "manual"]).optional(),
      customer_email: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const payments = listPayments(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ payments, count: payments.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_payment",
  {
    title: "Update Payment",
    description: "Update an existing payment.",
    inputSchema: {
      id: z.string(),
      status: z.enum(["pending", "succeeded", "failed", "disputed", "refunded"]).optional(),
      customer_name: z.string().optional(),
      customer_email: z.string().optional(),
      description: z.string().optional(),
      provider: z.enum(["stripe", "square", "mercury", "manual"]).optional(),
      provider_id: z.string().optional(),
      invoice_id: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const payment = updatePayment(id, input);
    if (!payment) {
      return { content: [{ type: "text", text: `Payment '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(payment, null, 2) }] };
  }
);

server.registerTool(
  "delete_payment",
  {
    title: "Delete Payment",
    description: "Delete a payment by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deletePayment(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "refund_payment",
  {
    title: "Refund Payment",
    description: "Refund a succeeded payment. Creates a refund record and marks the original as refunded.",
    inputSchema: {
      id: z.string(),
      amount: z.number().optional(),
    },
  },
  async ({ id, amount }) => {
    const refund = refundPayment(id, amount);
    if (!refund) {
      return {
        content: [{ type: "text", text: `Cannot refund payment '${id}' — not found or not succeeded.` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(refund, null, 2) }] };
  }
);

server.registerTool(
  "search_payments",
  {
    title: "Search Payments",
    description: "Search payments by customer name, email, description, provider ID, or invoice ID.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const results = searchPayments(query);
    return {
      content: [
        { type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "revenue_report",
  {
    title: "Revenue Report",
    description: "Get revenue report for a date range.",
    inputSchema: {
      start_date: z.string(),
      end_date: z.string(),
    },
  },
  async ({ start_date, end_date }) => {
    const report = getRevenueReport(start_date, end_date);
    return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
  }
);

server.registerTool(
  "revenue_by_customer",
  {
    title: "Revenue by Customer",
    description: "Get revenue breakdown by customer.",
    inputSchema: {},
  },
  async () => {
    const revenue = getRevenueByCustomer();
    return { content: [{ type: "text", text: JSON.stringify(revenue, null, 2) }] };
  }
);

server.registerTool(
  "reconcile_payment",
  {
    title: "Reconcile Payment",
    description: "Link a payment to an invoice ID for reconciliation.",
    inputSchema: {
      payment_id: z.string(),
      invoice_id: z.string(),
    },
  },
  async ({ payment_id, invoice_id }) => {
    const payment = reconcileWithInvoice(payment_id, invoice_id);
    if (!payment) {
      return { content: [{ type: "text", text: `Payment '${payment_id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(payment, null, 2) }] };
  }
);

server.registerTool(
  "payment_stats",
  {
    title: "Payment Statistics",
    description: "Get overall payment statistics.",
    inputSchema: {},
  },
  async () => {
    const stats = getPaymentStats();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

server.registerTool(
  "balance_by_provider",
  {
    title: "Balance by Provider",
    description: "Get balance breakdown by payment provider.",
    inputSchema: {},
  },
  async () => {
    const balances = getBalanceByProvider();
    return { content: [{ type: "text", text: JSON.stringify(balances, null, 2) }] };
  }
);

server.registerTool(
  "list_by_provider",
  {
    title: "List by Provider",
    description: "List all payments for a specific provider.",
    inputSchema: {
      provider: z.enum(["stripe", "square", "mercury", "manual"]),
    },
  },
  async ({ provider }) => {
    const payments = listByProvider(provider);
    return {
      content: [
        { type: "text", text: JSON.stringify({ payments, count: payments.length }, null, 2) },
      ],
    };
  }
);

// --- Disputes ---

server.registerTool(
  "create_dispute",
  {
    title: "Create Dispute",
    description: "Create a dispute for a payment.",
    inputSchema: {
      payment_id: z.string(),
      reason: z.string().optional(),
      amount: z.number().optional(),
    },
  },
  async (params) => {
    const dispute = createDispute(params);
    return { content: [{ type: "text", text: JSON.stringify(dispute, null, 2) }] };
  }
);

server.registerTool(
  "get_dispute",
  {
    title: "Get Dispute",
    description: "Get a dispute by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const dispute = getDispute(id);
    if (!dispute) {
      return { content: [{ type: "text", text: `Dispute '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(dispute, null, 2) }] };
  }
);

server.registerTool(
  "list_disputes",
  {
    title: "List Disputes",
    description: "List disputes with optional status filter.",
    inputSchema: {
      status: z.enum(["open", "under_review", "won", "lost"]).optional(),
    },
  },
  async ({ status }) => {
    const disputes = listDisputes(status);
    return {
      content: [
        { type: "text", text: JSON.stringify({ disputes, count: disputes.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "respond_dispute",
  {
    title: "Respond to Dispute",
    description: "Respond to a dispute — update status and optionally add evidence.",
    inputSchema: {
      id: z.string(),
      status: z.enum(["open", "under_review", "won", "lost"]),
    },
  },
  async ({ id, status }) => {
    const dispute = respondDispute(id, { status });
    if (!dispute) {
      return { content: [{ type: "text", text: `Dispute '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(dispute, null, 2) }] };
  }
);

server.registerTool(
  "delete_dispute",
  {
    title: "Delete Dispute",
    description: "Delete a dispute by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteDispute(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Payouts ---

server.registerTool(
  "create_payout",
  {
    title: "Create Payout",
    description: "Initiate a new payout.",
    inputSchema: {
      amount: z.number(),
      currency: z.string().optional(),
      destination: z.string().optional(),
    },
  },
  async (params) => {
    const payout = createPayout(params);
    return { content: [{ type: "text", text: JSON.stringify(payout, null, 2) }] };
  }
);

server.registerTool(
  "get_payout",
  {
    title: "Get Payout",
    description: "Get a payout by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const payout = getPayout(id);
    if (!payout) {
      return { content: [{ type: "text", text: `Payout '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(payout, null, 2) }] };
  }
);

server.registerTool(
  "list_payouts",
  {
    title: "List Payouts",
    description: "List payouts with optional status filter.",
    inputSchema: {
      status: z.enum(["pending", "in_transit", "paid", "failed"]).optional(),
    },
  },
  async ({ status }) => {
    const payouts = listPayouts(status);
    return {
      content: [
        { type: "text", text: JSON.stringify({ payouts, count: payouts.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_payout",
  {
    title: "Update Payout",
    description: "Update a payout status.",
    inputSchema: {
      id: z.string(),
      status: z.enum(["pending", "in_transit", "paid", "failed"]).optional(),
      destination: z.string().optional(),
      arrived_at: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const payout = updatePayout(id, input);
    if (!payout) {
      return { content: [{ type: "text", text: `Payout '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(payout, null, 2) }] };
  }
);

server.registerTool(
  "delete_payout",
  {
    title: "Delete Payout",
    description: "Delete a payout by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deletePayout(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Auto-Reconciliation ---

server.registerTool(
  "auto_reconcile",
  {
    title: "Auto Reconcile",
    description: "Auto-reconcile payments to invoices by matching amount, customer email, and date (+-3 days tolerance).",
    inputSchema: {
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    },
  },
  async ({ date_from, date_to }) => {
    const result = autoReconcile(date_from, date_to);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Retry ---

server.registerTool(
  "retry_payment",
  {
    title: "Retry Payment",
    description: "Retry a failed payment. Creates a retry attempt record and re-processes the payment.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const attempt = retryPayment(id);
    if (!attempt) {
      return {
        content: [{ type: "text", text: `Cannot retry payment '${id}' — not found or not failed.` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(attempt, null, 2) }] };
  }
);

server.registerTool(
  "list_retries",
  {
    title: "List Retries",
    description: "List all retry attempts for a payment.",
    inputSchema: { payment_id: z.string() },
  },
  async ({ payment_id }) => {
    const retries = listRetries(payment_id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ retries, count: retries.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "retry_stats",
  {
    title: "Retry Statistics",
    description: "Get overall retry attempt statistics.",
    inputSchema: {},
  },
  async () => {
    const stats = getRetryStats();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

// --- Currency Conversion ---

server.registerTool(
  "convert_currency",
  {
    title: "Convert Currency",
    description: "Convert an amount between currencies using built-in rates (USD/EUR/GBP/CAD/AUD).",
    inputSchema: {
      amount: z.number(),
      from: z.string(),
      to: z.string(),
    },
  },
  async ({ amount, from, to }) => {
    const result = convertCurrency(amount, from, to);
    if (!result) {
      return {
        content: [{ type: "text", text: `Unsupported currency pair: ${from} -> ${to}` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Fee Analysis ---

server.registerTool(
  "fee_analysis",
  {
    title: "Fee Analysis",
    description: "Analyze processor fees per provider for a given month. Shows gross, fees, and net per provider.",
    inputSchema: {
      month: z.string().describe("Month in YYYY-MM format"),
    },
  },
  async ({ month }) => {
    const result = feeAnalysis(month);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Decline Analytics ---

server.registerTool(
  "decline_analysis",
  {
    title: "Decline Analysis",
    description: "Get decline analytics — groups failed payments by description/reason.",
    inputSchema: {
      provider: z.enum(["stripe", "square", "mercury", "manual"]).optional(),
    },
  },
  async ({ provider }) => {
    const report = declineReport(provider);
    return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
  }
);

// --- Dispute Evidence ---

server.registerTool(
  "add_dispute_evidence",
  {
    title: "Add Dispute Evidence",
    description: "Add evidence to an existing dispute. Appends to the evidence items array.",
    inputSchema: {
      dispute_id: z.string(),
      description: z.string(),
      file_ref: z.string().optional(),
    },
  },
  async ({ dispute_id, description, file_ref }) => {
    const dispute = addDisputeEvidence(dispute_id, description, file_ref);
    if (!dispute) {
      return {
        content: [{ type: "text", text: `Dispute '${dispute_id}' not found.` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(dispute, null, 2) }] };
  }
);

// --- Payment Split ---

server.registerTool(
  "split_payment",
  {
    title: "Split Payment",
    description: "Record marketplace commission splits for a payment. Stores split percentages in payment metadata.",
    inputSchema: {
      payment_id: z.string(),
      splits: z.record(z.number()).describe("Map of vendor name to percentage (e.g. {vendor1: 70, vendor2: 30})"),
    },
  },
  async ({ payment_id, splits }) => {
    const payment = splitPayment(payment_id, splits);
    if (!payment) {
      return {
        content: [{ type: "text", text: `Payment '${payment_id}' not found.` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(payment, null, 2) }] };
  }
);

// --- Revenue Forecast ---

server.registerTool(
  "revenue_forecast",
  {
    title: "Revenue Forecast",
    description: "Project revenue for upcoming months based on last 3 months trend.",
    inputSchema: {
      months: z.number().describe("Number of months to forecast"),
    },
  },
  async ({ months }) => {
    const result = revenueForecast(months);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Reconciliation Gaps ---

server.registerTool(
  "reconciliation_gaps",
  {
    title: "Reconciliation Gaps",
    description: "Find payments without invoice_id and invoice IDs without a succeeded payment in a date range.",
    inputSchema: {
      date_from: z.string(),
      date_to: z.string(),
    },
  },
  async ({ date_from, date_to }) => {
    const gaps = findReconciliationGaps(date_from, date_to);
    return { content: [{ type: "text", text: JSON.stringify(gaps, null, 2) }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-payments MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
