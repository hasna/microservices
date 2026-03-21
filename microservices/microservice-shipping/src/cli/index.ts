#!/usr/bin/env bun

import { Command } from "commander";
import { readFileSync } from "node:fs";
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

const program = new Command();

program
  .name("microservice-shipping")
  .description("Shipping and order management microservice")
  .version("0.0.1");

// --- Orders ---

const orderCmd = program.command("order").description("Order management");

orderCmd
  .command("create")
  .description("Create a new order")
  .requiredOption("--customer-name <name>", "Customer name")
  .option("--customer-email <email>", "Customer email")
  .option("--address <json>", "Address as JSON {street,city,state,zip,country}")
  .option("--items <json>", "Items as JSON array [{name,qty,weight,value}]")
  .option("--currency <code>", "Currency code", "USD")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const address = opts.address ? JSON.parse(opts.address) : { street: "", city: "", state: "", zip: "", country: "" };
    const items = opts.items ? JSON.parse(opts.items) : [];

    const order = createOrder({
      customer_name: opts.customerName,
      customer_email: opts.customerEmail,
      address,
      items,
      currency: opts.currency,
    });

    if (opts.json) {
      console.log(JSON.stringify(order, null, 2));
    } else {
      console.log(`Created order: ${order.id} for ${order.customer_name} ($${order.total_value} ${order.currency})`);
    }
  });

orderCmd
  .command("list")
  .description("List orders")
  .option("--status <status>", "Filter by status")
  .option("--search <query>", "Search by customer name or email")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const orders = listOrders({
      status: opts.status,
      search: opts.search,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(orders, null, 2));
    } else {
      if (orders.length === 0) {
        console.log("No orders found.");
        return;
      }
      for (const o of orders) {
        console.log(`  [${o.status}] ${o.id.slice(0, 8)}... ${o.customer_name} — $${o.total_value} ${o.currency}`);
      }
      console.log(`\n${orders.length} order(s)`);
    }
  });

orderCmd
  .command("get")
  .description("Get an order by ID")
  .argument("<id>", "Order ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const order = getOrder(id);
    if (!order) {
      console.error(`Order '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(order, null, 2));
    } else {
      console.log(`Order: ${order.id}`);
      console.log(`  Customer: ${order.customer_name}`);
      if (order.customer_email) console.log(`  Email: ${order.customer_email}`);
      console.log(`  Status: ${order.status}`);
      console.log(`  Total: $${order.total_value} ${order.currency}`);
      console.log(`  Items: ${order.items.length}`);
      console.log(`  Address: ${order.address.street}, ${order.address.city}, ${order.address.state} ${order.address.zip}`);
    }
  });

orderCmd
  .command("update")
  .description("Update an order")
  .argument("<id>", "Order ID")
  .option("--customer-name <name>", "Customer name")
  .option("--customer-email <email>", "Customer email")
  .option("--status <status>", "Order status")
  .option("--address <json>", "Address as JSON")
  .option("--items <json>", "Items as JSON")
  .option("--currency <code>", "Currency code")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.customerName !== undefined) input.customer_name = opts.customerName;
    if (opts.customerEmail !== undefined) input.customer_email = opts.customerEmail;
    if (opts.status !== undefined) input.status = opts.status;
    if (opts.address !== undefined) input.address = JSON.parse(opts.address);
    if (opts.items !== undefined) input.items = JSON.parse(opts.items);
    if (opts.currency !== undefined) input.currency = opts.currency;

    const order = updateOrder(id, input);
    if (!order) {
      console.error(`Order '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(order, null, 2));
    } else {
      console.log(`Updated order: ${order.id} [${order.status}]`);
    }
  });

orderCmd
  .command("import")
  .description("Bulk import orders from a CSV file")
  .requiredOption("--file <path>", "Path to CSV file")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const csvData = readFileSync(opts.file, "utf-8");
    const result = bulkImportOrders(csvData);

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Imported ${result.imported} order(s)`);
      if (result.errors.length > 0) {
        console.log(`Errors:`);
        for (const err of result.errors) {
          console.log(`  Line ${err.line}: ${err.message}`);
        }
      }
    }
  });

orderCmd
  .command("export")
  .description("Export orders to CSV or JSON")
  .option("--format <format>", "Output format (csv/json)", "csv")
  .option("--from <date>", "Filter from date (YYYY-MM-DD)")
  .option("--to <date>", "Filter to date (YYYY-MM-DD)")
  .action((opts) => {
    const output = exportOrders(opts.format as "csv" | "json", opts.from, opts.to);
    console.log(output);
  });

orderCmd
  .command("timeline")
  .description("Show full event timeline for an order")
  .argument("<id>", "Order ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const timeline = getOrderTimeline(id);
    if (timeline.length === 0) {
      console.error(`No events found for order '${id}'.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(timeline, null, 2));
    } else {
      console.log(`Timeline for order ${id}:`);
      for (const event of timeline) {
        console.log(`  [${event.timestamp}] ${event.type}: ${event.details}`);
      }
    }
  });

// --- Ship (create shipment) ---

program
  .command("ship")
  .description("Create a shipment for an order")
  .requiredOption("--order <id>", "Order ID")
  .requiredOption("--carrier <carrier>", "Carrier (ups/fedex/usps/dhl)")
  .option("--tracking <number>", "Tracking number")
  .option("--service <service>", "Service level (ground/express/overnight)", "ground")
  .option("--cost <amount>", "Shipping cost")
  .option("--weight <kg>", "Package weight")
  .option("--estimated-delivery <date>", "Estimated delivery date")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const shipment = createShipment({
      order_id: opts.order,
      carrier: opts.carrier,
      tracking_number: opts.tracking,
      service: opts.service,
      cost: opts.cost ? parseFloat(opts.cost) : undefined,
      weight: opts.weight ? parseFloat(opts.weight) : undefined,
      estimated_delivery: opts.estimatedDelivery,
    });

    if (opts.json) {
      console.log(JSON.stringify(shipment, null, 2));
    } else {
      console.log(`Created shipment: ${shipment.id} via ${shipment.carrier} (${shipment.service})`);
      if (shipment.tracking_number) console.log(`  Tracking: ${shipment.tracking_number}`);
    }
  });

// --- Track ---

program
  .command("track")
  .description("Track a shipment by tracking number or shipment ID")
  .argument("<identifier>", "Tracking number or shipment ID")
  .option("--json", "Output as JSON", false)
  .action((identifier, opts) => {
    let shipment = getShipmentByTracking(identifier);
    if (!shipment) {
      shipment = getShipment(identifier);
    }
    if (!shipment) {
      console.error(`Shipment '${identifier}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(shipment, null, 2));
    } else {
      console.log(`Shipment: ${shipment.id}`);
      console.log(`  Carrier: ${shipment.carrier}`);
      console.log(`  Service: ${shipment.service}`);
      console.log(`  Status: ${shipment.status}`);
      if (shipment.tracking_number) console.log(`  Tracking: ${shipment.tracking_number}`);
      if (shipment.shipped_at) console.log(`  Shipped: ${shipment.shipped_at}`);
      if (shipment.estimated_delivery) console.log(`  ETA: ${shipment.estimated_delivery}`);
      if (shipment.delivered_at) console.log(`  Delivered: ${shipment.delivered_at}`);
    }
  });

// --- Shipments ---

const shipmentsCmd = program.command("shipments").description("Shipment management");

shipmentsCmd
  .command("list")
  .description("List shipments")
  .option("--order <id>", "Filter by order ID")
  .option("--carrier <carrier>", "Filter by carrier")
  .option("--status <status>", "Filter by status")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const shipments = listShipments({
      order_id: opts.order,
      carrier: opts.carrier,
      status: opts.status,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(shipments, null, 2));
    } else {
      if (shipments.length === 0) {
        console.log("No shipments found.");
        return;
      }
      for (const s of shipments) {
        const tracking = s.tracking_number ? ` (${s.tracking_number})` : "";
        console.log(`  [${s.status}] ${s.id.slice(0, 8)}... ${s.carrier}/${s.service}${tracking}`);
      }
      console.log(`\n${shipments.length} shipment(s)`);
    }
  });

// --- Returns ---

const returnCmd = program.command("return").description("Return management");

returnCmd
  .command("create")
  .description("Create a return request")
  .requiredOption("--order <id>", "Order ID")
  .option("--reason <reason>", "Return reason")
  .option("--auto-rma", "Auto-generate RMA code", false)
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const ret = createReturn({
      order_id: opts.order,
      reason: opts.reason,
      auto_rma: opts.autoRma,
    });

    if (opts.json) {
      console.log(JSON.stringify(ret, null, 2));
    } else {
      console.log(`Created return: ${ret.id} for order ${ret.order_id} [${ret.status}]`);
      if (ret.rma_code) console.log(`  RMA Code: ${ret.rma_code}`);
    }
  });

returnCmd
  .command("list")
  .description("List returns")
  .option("--order <id>", "Filter by order ID")
  .option("--status <status>", "Filter by status")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const returns = listReturns({
      order_id: opts.order,
      status: opts.status,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(returns, null, 2));
    } else {
      if (returns.length === 0) {
        console.log("No returns found.");
        return;
      }
      for (const r of returns) {
        const reason = r.reason ? ` — ${r.reason}` : "";
        console.log(`  [${r.status}] ${r.id.slice(0, 8)}... order ${r.order_id.slice(0, 8)}...${reason}`);
      }
      console.log(`\n${returns.length} return(s)`);
    }
  });

returnCmd
  .command("process")
  .description("Process a return (update status)")
  .argument("<id>", "Return ID")
  .requiredOption("--status <status>", "New status (approved/received/refunded)")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const ret = updateReturn(id, { status: opts.status });
    if (!ret) {
      console.error(`Return '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(ret, null, 2));
    } else {
      console.log(`Updated return: ${ret.id} [${ret.status}]`);
    }
  });

// --- Carriers ---

program
  .command("carriers")
  .description("List supported carriers")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const carriers = [
      { code: "ups", name: "UPS", services: ["ground", "express", "overnight"] },
      { code: "fedex", name: "FedEx", services: ["ground", "express", "overnight"] },
      { code: "usps", name: "USPS", services: ["ground", "express"] },
      { code: "dhl", name: "DHL", services: ["ground", "express", "overnight"] },
    ];

    if (opts.json) {
      console.log(JSON.stringify(carriers, null, 2));
    } else {
      for (const c of carriers) {
        console.log(`  ${c.code.toUpperCase()} (${c.name}) — ${c.services.join(", ")}`);
      }
    }
  });

// --- Stats ---

const statsCmd = program.command("stats").description("Shipping statistics and analytics");

statsCmd
  .command("overview")
  .description("Show overall shipping statistics")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stats = getShippingStats();

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log("Shipping Statistics:");
      console.log(`  Orders: ${stats.total_orders}`);
      for (const [status, count] of Object.entries(stats.orders_by_status)) {
        console.log(`    ${status}: ${count}`);
      }
      console.log(`  Shipments: ${stats.total_shipments}`);
      for (const [status, count] of Object.entries(stats.shipments_by_status)) {
        console.log(`    ${status}: ${count}`);
      }
      console.log(`  Returns: ${stats.total_returns}`);
      console.log(`  Revenue: $${stats.total_revenue.toFixed(2)}`);
      console.log(`  Shipping Cost: $${stats.total_shipping_cost.toFixed(2)}`);
    }
  });

statsCmd
  .command("delivery-times")
  .description("Delivery timeline analytics per carrier/service")
  .option("--carrier <carrier>", "Filter by carrier")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stats = getDeliveryStats(opts.carrier);

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      if (stats.length === 0) {
        console.log("No delivery data available (need shipments with shipped_at and delivered_at).");
        return;
      }
      console.log("Delivery Timeline Analytics:");
      for (const s of stats) {
        console.log(`  ${s.carrier.toUpperCase()}/${s.service}:`);
        console.log(`    Shipments: ${s.total_shipments} (${s.delivered_count} delivered)`);
        console.log(`    Avg delivery: ${s.avg_delivery_days.toFixed(1)} days`);
        console.log(`    On-time: ${s.on_time_pct.toFixed(1)}%, Late: ${s.late_pct.toFixed(1)}%`);
      }
    }
  });

statsCmd
  .command("carrier-performance")
  .description("Rank carriers by on-time %, avg cost, avg delivery days")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const perf = getCarrierPerformance();

    if (opts.json) {
      console.log(JSON.stringify(perf, null, 2));
    } else {
      if (perf.length === 0) {
        console.log("No carrier data available.");
        return;
      }
      console.log("Carrier Performance (ranked by on-time %):");
      for (const p of perf) {
        console.log(`  ${p.carrier.toUpperCase()}:`);
        console.log(`    Shipments: ${p.total_shipments} (${p.delivered_count} delivered)`);
        console.log(`    On-time: ${p.on_time_pct.toFixed(1)}%`);
        console.log(`    Avg cost: $${p.avg_cost.toFixed(2)}`);
        console.log(`    Avg delivery: ${p.avg_delivery_days.toFixed(1)} days`);
      }
    }
  });

// --- Costs ---

program
  .command("costs")
  .description("Show shipping costs by carrier")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const costs = getCostsByCarrier();

    if (opts.json) {
      console.log(JSON.stringify(costs, null, 2));
    } else {
      if (costs.length === 0) {
        console.log("No shipping cost data.");
        return;
      }
      console.log("Costs by Carrier:");
      for (const c of costs) {
        console.log(`  ${c.carrier.toUpperCase()}: $${c.total_cost.toFixed(2)} total, ${c.shipment_count} shipments, $${c.avg_cost.toFixed(2)} avg`);
      }
    }
  });

// --- Late Delivery Alerts ---

program
  .command("check-late")
  .description("List overdue shipments past estimated delivery + grace days")
  .option("--days <n>", "Grace days beyond estimated delivery", "0")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const overdue = listOverdueShipments(parseInt(opts.days));

    if (opts.json) {
      console.log(JSON.stringify(overdue, null, 2));
    } else {
      if (overdue.length === 0) {
        console.log("No overdue shipments found.");
        return;
      }
      console.log(`Overdue Shipments (grace: ${opts.days} day(s)):`);
      for (const s of overdue) {
        const tracking = s.tracking_number ? ` (${s.tracking_number})` : "";
        console.log(`  ${s.shipment_id.slice(0, 8)}... ${s.carrier}/${s.service}${tracking}`);
        console.log(`    ETA: ${s.estimated_delivery}, ${s.days_overdue} day(s) overdue [${s.status}]`);
      }
      console.log(`\n${overdue.length} overdue shipment(s)`);
    }
  });

// --- Customer History ---

program
  .command("customer-history")
  .description("Show all orders, shipments, and returns for a customer")
  .argument("<email>", "Customer email")
  .option("--json", "Output as JSON", false)
  .action((email, opts) => {
    const history = getCustomerHistory(email);

    if (opts.json) {
      console.log(JSON.stringify(history, null, 2));
    } else {
      console.log(`Customer History for ${email}:`);
      console.log(`  Orders: ${history.orders.length}`);
      for (const o of history.orders) {
        console.log(`    [${o.status}] ${o.id.slice(0, 8)}... $${o.total_value} ${o.currency}`);
      }
      console.log(`  Shipments: ${history.shipments.length}`);
      for (const s of history.shipments) {
        console.log(`    [${s.status}] ${s.id.slice(0, 8)}... ${s.carrier}/${s.service}`);
      }
      console.log(`  Returns: ${history.returns.length}`);
      for (const r of history.returns) {
        const rma = r.rma_code ? ` (${r.rma_code})` : "";
        console.log(`    [${r.status}] ${r.id.slice(0, 8)}...${rma}`);
      }
    }
  });

// --- Cost Optimizer ---

program
  .command("optimize-cost")
  .description("Recommend cheapest carrier/service based on historical data")
  .requiredOption("--weight <kg>", "Package weight in kg")
  .option("--from <zip>", "Origin zip code")
  .option("--to <zip>", "Destination zip code")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const recommendations = optimizeCost(
      parseFloat(opts.weight),
      opts.from,
      opts.to
    );

    if (opts.json) {
      console.log(JSON.stringify(recommendations, null, 2));
    } else {
      if (recommendations.length === 0) {
        console.log("No historical shipping data found for the given weight range.");
        return;
      }
      console.log(`Cost recommendations for ${opts.weight}kg package:`);
      for (let i = 0; i < recommendations.length; i++) {
        const r = recommendations[i];
        const deliveryInfo = r.avg_delivery_days ? `, ~${r.avg_delivery_days.toFixed(1)} days` : "";
        console.log(`  ${i + 1}. ${r.carrier.toUpperCase()}/${r.service}: $${r.avg_cost.toFixed(2)} avg (${r.shipment_count} samples${deliveryInfo})`);
      }
    }
  });

program.parse(process.argv);
