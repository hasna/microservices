#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createOrder,
  getOrder,
  listOrders,
  updateOrder,
  deleteOrder,
  searchOrders,
  listByStatus,
  bulkImportOrders,
  exportOrders,
  getOrderTimeline,
} from "../db/shipping.js";
import {
  createShipment,
  getShipment,
  getShipmentByTracking,
  listShipments,
  updateShipment,
} from "../db/shipping.js";
import {
  createReturn,
  getReturn,
  listReturns,
  updateReturn,
} from "../db/shipping.js";
import {
  getShippingStats,
  getCostsByCarrier,
  getDeliveryStats,
  listOverdueShipments,
  getCustomerHistory,
  getCarrierPerformance,
  optimizeCost,
} from "../db/shipping.js";

const server = new McpServer({
  name: "microservice-shipping",
  version: "0.0.1",
});

// ─── Orders ──────────────────────────────────────────────────────────────────

const AddressSchema = z.object({
  street: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  country: z.string(),
});

const OrderItemSchema = z.object({
  name: z.string(),
  qty: z.number(),
  weight: z.number(),
  value: z.number(),
});

server.registerTool(
  "create_order",
  {
    title: "Create Order",
    description: "Create a new order.",
    inputSchema: {
      customer_name: z.string(),
      customer_email: z.string().optional(),
      address: AddressSchema,
      items: z.array(OrderItemSchema),
      currency: z.string().optional(),
    },
  },
  async (params) => {
    const order = createOrder(params);
    return { content: [{ type: "text", text: JSON.stringify(order, null, 2) }] };
  }
);

server.registerTool(
  "get_order",
  {
    title: "Get Order",
    description: "Get an order by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const order = getOrder(id);
    if (!order) {
      return { content: [{ type: "text", text: `Order '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(order, null, 2) }] };
  }
);

server.registerTool(
  "list_orders",
  {
    title: "List Orders",
    description: "List orders with optional filters.",
    inputSchema: {
      status: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const orders = listOrders(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ orders, count: orders.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_order",
  {
    title: "Update Order",
    description: "Update an existing order.",
    inputSchema: {
      id: z.string(),
      customer_name: z.string().optional(),
      customer_email: z.string().optional(),
      status: z.enum(["pending", "processing", "shipped", "delivered", "returned"]).optional(),
      address: AddressSchema.optional(),
      items: z.array(OrderItemSchema).optional(),
      total_value: z.number().optional(),
      currency: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const order = updateOrder(id, input);
    if (!order) {
      return { content: [{ type: "text", text: `Order '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(order, null, 2) }] };
  }
);

server.registerTool(
  "delete_order",
  {
    title: "Delete Order",
    description: "Delete an order by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteOrder(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "search_orders",
  {
    title: "Search Orders",
    description: "Search orders by customer name or email.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const results = searchOrders(query);
    return {
      content: [
        { type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) },
      ],
    };
  }
);

// ─── Shipments ───────────────────────────────────────────────────────────────

server.registerTool(
  "create_shipment",
  {
    title: "Create Shipment",
    description: "Create a shipment for an order.",
    inputSchema: {
      order_id: z.string(),
      carrier: z.enum(["ups", "fedex", "usps", "dhl"]),
      tracking_number: z.string().optional(),
      service: z.enum(["ground", "express", "overnight"]).optional(),
      cost: z.number().optional(),
      weight: z.number().optional(),
      estimated_delivery: z.string().optional(),
      dimensions: z.record(z.unknown()).optional(),
    },
  },
  async (params) => {
    const shipment = createShipment(params);
    return { content: [{ type: "text", text: JSON.stringify(shipment, null, 2) }] };
  }
);

server.registerTool(
  "get_shipment",
  {
    title: "Get Shipment",
    description: "Get a shipment by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const shipment = getShipment(id);
    if (!shipment) {
      return { content: [{ type: "text", text: `Shipment '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(shipment, null, 2) }] };
  }
);

server.registerTool(
  "track_shipment",
  {
    title: "Track Shipment",
    description: "Track a shipment by tracking number.",
    inputSchema: { tracking_number: z.string() },
  },
  async ({ tracking_number }) => {
    const shipment = getShipmentByTracking(tracking_number);
    if (!shipment) {
      return { content: [{ type: "text", text: `Shipment with tracking '${tracking_number}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(shipment, null, 2) }] };
  }
);

server.registerTool(
  "list_shipments",
  {
    title: "List Shipments",
    description: "List shipments with optional filters.",
    inputSchema: {
      order_id: z.string().optional(),
      carrier: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const shipments = listShipments(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ shipments, count: shipments.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_shipment",
  {
    title: "Update Shipment",
    description: "Update a shipment.",
    inputSchema: {
      id: z.string(),
      carrier: z.enum(["ups", "fedex", "usps", "dhl"]).optional(),
      tracking_number: z.string().optional(),
      service: z.enum(["ground", "express", "overnight"]).optional(),
      status: z.enum(["label_created", "in_transit", "out_for_delivery", "delivered", "exception"]).optional(),
      shipped_at: z.string().optional(),
      estimated_delivery: z.string().optional(),
      delivered_at: z.string().optional(),
      cost: z.number().optional(),
      weight: z.number().optional(),
      dimensions: z.record(z.unknown()).optional(),
    },
  },
  async ({ id, ...input }) => {
    const shipment = updateShipment(id, input);
    if (!shipment) {
      return { content: [{ type: "text", text: `Shipment '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(shipment, null, 2) }] };
  }
);

// ─── Returns ─────────────────────────────────────────────────────────────────

server.registerTool(
  "create_return",
  {
    title: "Create Return",
    description: "Create a return request for an order. Set auto_rma to true to generate a unique RMA code.",
    inputSchema: {
      order_id: z.string(),
      reason: z.string().optional(),
      auto_rma: z.boolean().optional(),
    },
  },
  async (params) => {
    const ret = createReturn(params);
    return { content: [{ type: "text", text: JSON.stringify(ret, null, 2) }] };
  }
);

server.registerTool(
  "get_return",
  {
    title: "Get Return",
    description: "Get a return by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const ret = getReturn(id);
    if (!ret) {
      return { content: [{ type: "text", text: `Return '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(ret, null, 2) }] };
  }
);

server.registerTool(
  "list_returns",
  {
    title: "List Returns",
    description: "List returns with optional filters.",
    inputSchema: {
      order_id: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const returns = listReturns(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ returns, count: returns.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_return",
  {
    title: "Update Return",
    description: "Update a return status.",
    inputSchema: {
      id: z.string(),
      reason: z.string().optional(),
      status: z.enum(["requested", "approved", "received", "refunded"]).optional(),
    },
  },
  async ({ id, ...input }) => {
    const ret = updateReturn(id, input);
    if (!ret) {
      return { content: [{ type: "text", text: `Return '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(ret, null, 2) }] };
  }
);

// ─── Analytics ───────────────────────────────────────────────────────────────

server.registerTool(
  "shipping_stats",
  {
    title: "Shipping Statistics",
    description: "Get overall shipping statistics.",
    inputSchema: {},
  },
  async () => {
    const stats = getShippingStats();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

server.registerTool(
  "carrier_costs",
  {
    title: "Carrier Costs",
    description: "Get shipping costs breakdown by carrier.",
    inputSchema: {},
  },
  async () => {
    const costs = getCostsByCarrier();
    return { content: [{ type: "text", text: JSON.stringify(costs, null, 2) }] };
  }
);

// ─── Bulk Import/Export ──────────────────────────────────────────────────────

server.registerTool(
  "bulk_import_orders",
  {
    title: "Bulk Import Orders",
    description: "Import orders from CSV data. Columns: customer_name,customer_email,street,city,state,zip,country,items_json,total_value.",
    inputSchema: {
      csv_data: z.string().describe("CSV data with header row"),
    },
  },
  async ({ csv_data }) => {
    const result = bulkImportOrders(csv_data);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "export_orders",
  {
    title: "Export Orders",
    description: "Export orders in CSV or JSON format, optionally filtered by date range.",
    inputSchema: {
      format: z.enum(["csv", "json"]).describe("Output format"),
      date_from: z.string().optional().describe("Filter from date (YYYY-MM-DD)"),
      date_to: z.string().optional().describe("Filter to date (YYYY-MM-DD)"),
    },
  },
  async ({ format, date_from, date_to }) => {
    const output = exportOrders(format, date_from, date_to);
    return { content: [{ type: "text", text: output }] };
  }
);

// ─── Delivery Timeline Analytics ────────────────────────────────────────────

server.registerTool(
  "delivery_timeline_stats",
  {
    title: "Delivery Timeline Stats",
    description: "Get delivery time analytics (avg days, on-time %, late %) per carrier and service level.",
    inputSchema: {
      carrier: z.string().optional().describe("Filter by carrier"),
    },
  },
  async ({ carrier }) => {
    const stats = getDeliveryStats(carrier);
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

// ─── Late Delivery Alerts ───────────────────────────────────────────────────

server.registerTool(
  "list_overdue_shipments",
  {
    title: "List Overdue Shipments",
    description: "Find shipments past their estimated delivery date + grace period that are not yet delivered.",
    inputSchema: {
      grace_days: z.number().optional().describe("Grace days beyond estimated delivery (default 0)"),
    },
  },
  async ({ grace_days }) => {
    const overdue = listOverdueShipments(grace_days ?? 0);
    return { content: [{ type: "text", text: JSON.stringify({ overdue, count: overdue.length }, null, 2) }] };
  }
);

// ─── Customer History ───────────────────────────────────────────────────────

server.registerTool(
  "customer_shipping_history",
  {
    title: "Customer Shipping History",
    description: "Get all orders, shipments, and returns for a customer by email.",
    inputSchema: {
      email: z.string().describe("Customer email address"),
    },
  },
  async ({ email }) => {
    const history = getCustomerHistory(email);
    return { content: [{ type: "text", text: JSON.stringify(history, null, 2) }] };
  }
);

// ─── Carrier Performance ────────────────────────────────────────────────────

server.registerTool(
  "carrier_performance",
  {
    title: "Carrier Performance",
    description: "Rank carriers by on-time delivery %, average cost, and average delivery days.",
    inputSchema: {},
  },
  async () => {
    const perf = getCarrierPerformance();
    return { content: [{ type: "text", text: JSON.stringify(perf, null, 2) }] };
  }
);

// ─── Cost Optimizer ─────────────────────────────────────────────────────────

server.registerTool(
  "optimize_shipping_cost",
  {
    title: "Optimize Shipping Cost",
    description: "Recommend cheapest carrier/service based on historical cost data for a given package weight.",
    inputSchema: {
      weight: z.number().describe("Package weight in kg"),
      from_zip: z.string().optional().describe("Origin zip code"),
      to_zip: z.string().optional().describe("Destination zip code"),
    },
  },
  async ({ weight, from_zip, to_zip }) => {
    const recommendations = optimizeCost(weight, from_zip, to_zip);
    return { content: [{ type: "text", text: JSON.stringify(recommendations, null, 2) }] };
  }
);

// ─── Order Timeline ─────────────────────────────────────────────────────────

server.registerTool(
  "order_timeline",
  {
    title: "Order Timeline",
    description: "Get the full event history for an order, including shipments and returns.",
    inputSchema: {
      order_id: z.string().describe("Order ID"),
    },
  },
  async ({ order_id }) => {
    const timeline = getOrderTimeline(order_id);
    if (timeline.length === 0) {
      return { content: [{ type: "text", text: `No events found for order '${order_id}'.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(timeline, null, 2) }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-shipping MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
