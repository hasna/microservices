#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
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
  listClients,
  updateClient,
  deleteClient,
} from "../db/clients.js";

const server = new McpServer({
  name: "microservice-invoices",
  version: "0.0.1",
});

// --- Invoices ---

server.registerTool(
  "create_invoice",
  {
    title: "Create Invoice",
    description: "Create a new invoice.",
    inputSchema: {
      client_id: z.string().optional(),
      due_date: z.string().optional(),
      currency: z.string().optional(),
      tax_rate: z.number().optional(),
      discount: z.number().optional(),
      notes: z.string().optional(),
    },
  },
  async (params) => {
    const invoice = createInvoice(params);
    return { content: [{ type: "text", text: JSON.stringify(invoice, null, 2) }] };
  }
);

server.registerTool(
  "get_invoice",
  {
    title: "Get Invoice",
    description: "Get an invoice with line items and payments.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const invoice = getInvoiceWithItems(id);
    if (!invoice) {
      return { content: [{ type: "text", text: `Invoice '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(invoice, null, 2) }] };
  }
);

server.registerTool(
  "list_invoices",
  {
    title: "List Invoices",
    description: "List invoices with optional filters.",
    inputSchema: {
      status: z.string().optional(),
      client_id: z.string().optional(),
      from_date: z.string().optional(),
      to_date: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const invoices = listInvoices(params);
    return {
      content: [{ type: "text", text: JSON.stringify({ invoices, count: invoices.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "update_invoice_status",
  {
    title: "Update Invoice Status",
    description: "Change invoice status (draft, sent, paid, overdue, cancelled, refunded).",
    inputSchema: {
      id: z.string(),
      status: z.enum(["draft", "sent", "paid", "overdue", "cancelled", "refunded"]),
    },
  },
  async ({ id, status }) => {
    const invoice = updateInvoiceStatus(id, status);
    if (!invoice) {
      return { content: [{ type: "text", text: `Invoice '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(invoice, null, 2) }] };
  }
);

server.registerTool(
  "delete_invoice",
  {
    title: "Delete Invoice",
    description: "Delete an invoice.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteInvoice(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "add_line_item",
  {
    title: "Add Line Item",
    description: "Add a line item to an invoice. Recalculates totals automatically.",
    inputSchema: {
      invoice_id: z.string(),
      description: z.string(),
      unit_price: z.number(),
      quantity: z.number().optional(),
    },
  },
  async (params) => {
    const item = addLineItem(params);
    return { content: [{ type: "text", text: JSON.stringify(item, null, 2) }] };
  }
);

server.registerTool(
  "remove_line_item",
  {
    title: "Remove Line Item",
    description: "Remove a line item. Recalculates totals.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const removed = removeLineItem(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, removed }) }] };
  }
);

server.registerTool(
  "record_payment",
  {
    title: "Record Payment",
    description: "Record a payment against an invoice. Auto-marks as paid when fully paid.",
    inputSchema: {
      invoice_id: z.string(),
      amount: z.number(),
      method: z.string().optional(),
      reference: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async (params) => {
    const payment = recordPayment(params);
    return { content: [{ type: "text", text: JSON.stringify(payment, null, 2) }] };
  }
);

server.registerTool(
  "invoice_summary",
  {
    title: "Invoice Summary",
    description: "Get summary statistics for all invoices.",
    inputSchema: {},
  },
  async () => {
    const summary = getInvoiceSummary();
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }
);

// --- Clients ---

server.registerTool(
  "create_client",
  {
    title: "Create Client",
    description: "Create a new client for invoicing.",
    inputSchema: {
      name: z.string(),
      email: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      tax_id: z.string().optional(),
    },
  },
  async (params) => {
    const client = createClient(params);
    return { content: [{ type: "text", text: JSON.stringify(client, null, 2) }] };
  }
);

server.registerTool(
  "list_clients",
  {
    title: "List Clients",
    description: "List all clients.",
    inputSchema: { search: z.string().optional() },
  },
  async ({ search }) => {
    const clients = listClients(search);
    return {
      content: [{ type: "text", text: JSON.stringify({ clients, count: clients.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "delete_client",
  {
    title: "Delete Client",
    description: "Delete a client.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteClient(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-invoices MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
