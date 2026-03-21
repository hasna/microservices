import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-shipping-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createOrder,
  getOrder,
  listOrders,
  updateOrder,
  deleteOrder,
  searchOrders,
  listByStatus,
} from "./shipping";
import {
  createShipment,
  getShipment,
  getShipmentByTracking,
  listShipments,
  updateShipment,
  deleteShipment,
} from "./shipping";
import {
  createReturn,
  getReturn,
  listReturns,
  updateReturn,
  deleteReturn,
} from "./shipping";
import {
  getShippingStats,
  getCostsByCarrier,
  bulkImportOrders,
  exportOrders,
  getDeliveryStats,
  listOverdueShipments,
  getCustomerHistory,
  getCarrierPerformance,
  optimizeCost,
  getOrderTimeline,
} from "./shipping";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

const sampleAddress = {
  street: "123 Main St",
  city: "Springfield",
  state: "IL",
  zip: "62701",
  country: "US",
};

const sampleItems = [
  { name: "Widget", qty: 2, weight: 0.5, value: 19.99 },
  { name: "Gadget", qty: 1, weight: 1.0, value: 49.99 },
];

// ─── Orders ──────────────────────────────────────────────────────────────────

describe("Orders", () => {
  test("create and get order", () => {
    const order = createOrder({
      customer_name: "John Doe",
      customer_email: "john@example.com",
      address: sampleAddress,
      items: sampleItems,
    });

    expect(order.id).toBeTruthy();
    expect(order.customer_name).toBe("John Doe");
    expect(order.customer_email).toBe("john@example.com");
    expect(order.address.city).toBe("Springfield");
    expect(order.items).toHaveLength(2);
    expect(order.status).toBe("pending");
    // total_value auto-calculated: 2*19.99 + 1*49.99 = 89.97
    expect(order.total_value).toBeCloseTo(89.97, 2);
    expect(order.currency).toBe("USD");

    const fetched = getOrder(order.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(order.id);
  });

  test("create order with explicit total_value", () => {
    const order = createOrder({
      customer_name: "Jane Doe",
      address: sampleAddress,
      items: sampleItems,
      total_value: 100.0,
      currency: "EUR",
    });

    expect(order.total_value).toBe(100.0);
    expect(order.currency).toBe("EUR");
  });

  test("list orders", () => {
    const all = listOrders();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("list orders with status filter", () => {
    const pending = listByStatus("pending");
    expect(pending.length).toBeGreaterThanOrEqual(2);
    expect(pending.every((o) => o.status === "pending")).toBe(true);
  });

  test("search orders by customer name", () => {
    const results = searchOrders("John");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].customer_name).toBe("John Doe");
  });

  test("search orders by email", () => {
    const results = searchOrders("john@example");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("update order", () => {
    const order = createOrder({
      customer_name: "Update Test",
      address: sampleAddress,
      items: sampleItems,
    });

    const updated = updateOrder(order.id, {
      status: "processing",
      customer_email: "updated@example.com",
    });

    expect(updated).toBeDefined();
    expect(updated!.status).toBe("processing");
    expect(updated!.customer_email).toBe("updated@example.com");
  });

  test("update nonexistent order returns null", () => {
    const result = updateOrder("nonexistent-id", { status: "shipped" });
    expect(result).toBeNull();
  });

  test("delete order", () => {
    const order = createOrder({
      customer_name: "Delete Me",
      address: sampleAddress,
      items: [],
    });
    expect(deleteOrder(order.id)).toBe(true);
    expect(getOrder(order.id)).toBeNull();
  });

  test("delete nonexistent order returns false", () => {
    expect(deleteOrder("nonexistent-id")).toBe(false);
  });

  test("get nonexistent order returns null", () => {
    expect(getOrder("nonexistent-id")).toBeNull();
  });
});

// ─── Shipments ───────────────────────────────────────────────────────────────

describe("Shipments", () => {
  test("create shipment and auto-update order to processing", () => {
    const order = createOrder({
      customer_name: "Ship Test",
      address: sampleAddress,
      items: sampleItems,
    });

    expect(order.status).toBe("pending");

    const shipment = createShipment({
      order_id: order.id,
      carrier: "ups",
      tracking_number: "1Z999AA10123456784",
      service: "ground",
      cost: 12.5,
      weight: 2.0,
    });

    expect(shipment.id).toBeTruthy();
    expect(shipment.carrier).toBe("ups");
    expect(shipment.tracking_number).toBe("1Z999AA10123456784");
    expect(shipment.service).toBe("ground");
    expect(shipment.status).toBe("label_created");
    expect(shipment.cost).toBe(12.5);
    expect(shipment.weight).toBe(2.0);

    // Order should now be processing
    const updatedOrder = getOrder(order.id);
    expect(updatedOrder!.status).toBe("processing");
  });

  test("get shipment by tracking number", () => {
    const shipment = getShipmentByTracking("1Z999AA10123456784");
    expect(shipment).toBeDefined();
    expect(shipment!.tracking_number).toBe("1Z999AA10123456784");
  });

  test("list shipments by carrier", () => {
    const shipments = listShipments({ carrier: "ups" });
    expect(shipments.length).toBeGreaterThanOrEqual(1);
    expect(shipments.every((s) => s.carrier === "ups")).toBe(true);
  });

  test("update shipment status to delivered updates order", () => {
    const order = createOrder({
      customer_name: "Deliver Test",
      address: sampleAddress,
      items: sampleItems,
    });

    const shipment = createShipment({
      order_id: order.id,
      carrier: "fedex",
      service: "express",
    });

    const updated = updateShipment(shipment.id, {
      status: "delivered",
      delivered_at: "2024-01-15T14:00:00Z",
    });

    expect(updated!.status).toBe("delivered");
    expect(updated!.delivered_at).toBe("2024-01-15T14:00:00Z");

    // Order should now be delivered
    const updatedOrder = getOrder(order.id);
    expect(updatedOrder!.status).toBe("delivered");
  });

  test("update nonexistent shipment returns null", () => {
    expect(updateShipment("nonexistent-id", { status: "delivered" })).toBeNull();
  });

  test("delete shipment", () => {
    const order = createOrder({
      customer_name: "Del Ship",
      address: sampleAddress,
      items: [],
    });
    const shipment = createShipment({
      order_id: order.id,
      carrier: "usps",
    });
    expect(deleteShipment(shipment.id)).toBe(true);
    expect(getShipment(shipment.id)).toBeNull();
  });

  test("get nonexistent shipment returns null", () => {
    expect(getShipment("nonexistent-id")).toBeNull();
  });

  test("create shipment with dimensions", () => {
    const order = createOrder({
      customer_name: "Dim Test",
      address: sampleAddress,
      items: sampleItems,
    });

    const shipment = createShipment({
      order_id: order.id,
      carrier: "dhl",
      dimensions: { length: 10, width: 5, height: 3 },
    });

    expect(shipment.dimensions).toEqual({ length: 10, width: 5, height: 3 });
  });
});

// ─── Returns ─────────────────────────────────────────────────────────────────

describe("Returns", () => {
  test("create and get return", () => {
    const order = createOrder({
      customer_name: "Return Test",
      address: sampleAddress,
      items: sampleItems,
    });

    const ret = createReturn({
      order_id: order.id,
      reason: "Defective product",
    });

    expect(ret.id).toBeTruthy();
    expect(ret.order_id).toBe(order.id);
    expect(ret.reason).toBe("Defective product");
    expect(ret.status).toBe("requested");

    const fetched = getReturn(ret.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(ret.id);
  });

  test("list returns by status", () => {
    const returns = listReturns({ status: "requested" });
    expect(returns.length).toBeGreaterThanOrEqual(1);
    expect(returns.every((r) => r.status === "requested")).toBe(true);
  });

  test("update return status to refunded updates order to returned", () => {
    const order = createOrder({
      customer_name: "Refund Test",
      address: sampleAddress,
      items: sampleItems,
    });

    const ret = createReturn({
      order_id: order.id,
      reason: "Wrong item",
    });

    const updated = updateReturn(ret.id, { status: "refunded" });
    expect(updated!.status).toBe("refunded");

    const updatedOrder = getOrder(order.id);
    expect(updatedOrder!.status).toBe("returned");
  });

  test("update nonexistent return returns null", () => {
    expect(updateReturn("nonexistent-id", { status: "approved" })).toBeNull();
  });

  test("delete return", () => {
    const order = createOrder({
      customer_name: "Del Return",
      address: sampleAddress,
      items: [],
    });
    const ret = createReturn({ order_id: order.id });
    expect(deleteReturn(ret.id)).toBe(true);
    expect(getReturn(ret.id)).toBeNull();
  });

  test("get nonexistent return returns null", () => {
    expect(getReturn("nonexistent-id")).toBeNull();
  });
});

// ─── Analytics ───────────────────────────────────────────────────────────────

describe("Analytics", () => {
  test("getShippingStats returns stats", () => {
    const stats = getShippingStats();
    expect(stats.total_orders).toBeGreaterThanOrEqual(1);
    expect(stats.total_revenue).toBeGreaterThan(0);
    expect(typeof stats.total_shipping_cost).toBe("number");
    expect(typeof stats.orders_by_status).toBe("object");
    expect(typeof stats.shipments_by_status).toBe("object");
    expect(typeof stats.returns_by_status).toBe("object");
  });

  test("getCostsByCarrier returns carrier breakdown", () => {
    const costs = getCostsByCarrier();
    expect(costs.length).toBeGreaterThanOrEqual(1);
    const upsCosts = costs.find((c) => c.carrier === "ups");
    if (upsCosts) {
      expect(upsCosts.total_cost).toBeGreaterThanOrEqual(0);
      expect(upsCosts.shipment_count).toBeGreaterThanOrEqual(1);
      expect(typeof upsCosts.avg_cost).toBe("number");
    }
  });
});

// ─── Bulk Import/Export ─────────────────────────────────────────────────────

describe("Bulk Import/Export", () => {
  test("bulkImportOrders imports CSV data", () => {
    const csv = `customer_name,customer_email,street,city,state,zip,country,items_json,total_value
Alice Import,alice@import.com,10 Oak St,Portland,OR,97201,US,"[]",50.00
Bob Import,bob@import.com,20 Elm St,Seattle,WA,98101,US,"[]",75.00`;

    const result = bulkImportOrders(csv);
    expect(result.imported).toBe(2);
    expect(result.errors).toHaveLength(0);

    // Verify orders exist
    const alice = searchOrders("Alice Import");
    expect(alice.length).toBeGreaterThanOrEqual(1);
    expect(alice[0].customer_email).toBe("alice@import.com");
    expect(alice[0].total_value).toBe(50.0);
  });

  test("bulkImportOrders handles empty CSV", () => {
    const result = bulkImportOrders("header_only");
    expect(result.imported).toBe(0);
    expect(result.errors.length).toBeGreaterThanOrEqual(0);
  });

  test("bulkImportOrders handles CSV with items_json", () => {
    const csv = `customer_name,customer_email,street,city,state,zip,country,items_json,total_value
Charlie Import,charlie@import.com,30 Pine St,Denver,CO,80201,US,"[{""name"":""Widget"",""qty"":1,""weight"":0.5,""value"":25}]",25.00`;

    const result = bulkImportOrders(csv);
    expect(result.imported).toBe(1);

    const charlie = searchOrders("Charlie Import");
    expect(charlie.length).toBeGreaterThanOrEqual(1);
    expect(charlie[0].items).toHaveLength(1);
    expect(charlie[0].items[0].name).toBe("Widget");
  });

  test("exportOrders as JSON", () => {
    const output = exportOrders("json");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed[0].id).toBeTruthy();
  });

  test("exportOrders as CSV", () => {
    const output = exportOrders("csv");
    const lines = output.split("\n");
    expect(lines[0]).toContain("customer_name");
    expect(lines[0]).toContain("total_value");
    expect(lines.length).toBeGreaterThan(1);
  });

  test("exportOrders with date filter returns subset", () => {
    // Export with a future date range — should return nothing
    const output = exportOrders("json", "2099-01-01", "2099-12-31");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(0);
  });
});

// ─── Delivery Timeline Analytics ────────────────────────────────────────────

describe("Delivery Timeline Analytics", () => {
  test("getDeliveryStats returns stats for delivered shipments", () => {
    // Create an order and a shipment with full delivery timeline
    const order = createOrder({
      customer_name: "Delivery Stats Test",
      address: sampleAddress,
      items: sampleItems,
    });

    const shipment = createShipment({
      order_id: order.id,
      carrier: "ups",
      service: "express",
      cost: 25.0,
      weight: 3.0,
      shipped_at: "2026-01-01T10:00:00Z",
      estimated_delivery: "2026-01-05T10:00:00Z",
    });

    updateShipment(shipment.id, {
      status: "delivered",
      delivered_at: "2026-01-04T14:00:00Z",
    });

    const stats = getDeliveryStats("ups");
    expect(stats.length).toBeGreaterThanOrEqual(1);

    const upsExpress = stats.find((s) => s.carrier === "ups" && s.service === "express");
    if (upsExpress) {
      expect(upsExpress.avg_delivery_days).toBeGreaterThan(0);
      expect(typeof upsExpress.on_time_pct).toBe("number");
      expect(typeof upsExpress.late_pct).toBe("number");
    }
  });

  test("getDeliveryStats returns empty for nonexistent carrier", () => {
    const stats = getDeliveryStats("nonexistent" as any);
    expect(stats).toHaveLength(0);
  });

  test("getDeliveryStats without carrier filter returns all", () => {
    const stats = getDeliveryStats();
    expect(stats.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Late Delivery Alerts ───────────────────────────────────────────────────

describe("Late Delivery Alerts", () => {
  test("listOverdueShipments finds overdue shipments", () => {
    const order = createOrder({
      customer_name: "Overdue Test",
      address: sampleAddress,
      items: sampleItems,
    });

    // Create a shipment with a past estimated_delivery
    createShipment({
      order_id: order.id,
      carrier: "fedex",
      service: "ground",
      estimated_delivery: "2020-01-01",
    });

    const overdue = listOverdueShipments(0);
    expect(overdue.length).toBeGreaterThanOrEqual(1);
    expect(overdue[0].days_overdue).toBeGreaterThan(0);
    expect(overdue[0].carrier).toBeTruthy();
  });

  test("listOverdueShipments with large grace days returns fewer results", () => {
    const overdueSmall = listOverdueShipments(0);
    const overdueLarge = listOverdueShipments(999999);
    expect(overdueLarge.length).toBeLessThanOrEqual(overdueSmall.length);
  });
});

// ─── Customer History ───────────────────────────────────────────────────────

describe("Customer History", () => {
  test("getCustomerHistory returns orders, shipments, and returns", () => {
    const email = "history-test@example.com";
    const order = createOrder({
      customer_name: "History Test",
      customer_email: email,
      address: sampleAddress,
      items: sampleItems,
    });

    createShipment({
      order_id: order.id,
      carrier: "usps",
      service: "ground",
    });

    createReturn({
      order_id: order.id,
      reason: "Changed mind",
    });

    const history = getCustomerHistory(email);
    expect(history.customer_email).toBe(email);
    expect(history.orders.length).toBeGreaterThanOrEqual(1);
    expect(history.shipments.length).toBeGreaterThanOrEqual(1);
    expect(history.returns.length).toBeGreaterThanOrEqual(1);
  });

  test("getCustomerHistory returns empty for unknown email", () => {
    const history = getCustomerHistory("nobody@nowhere.com");
    expect(history.orders).toHaveLength(0);
    expect(history.shipments).toHaveLength(0);
    expect(history.returns).toHaveLength(0);
  });
});

// ─── Carrier Performance ────────────────────────────────────────────────────

describe("Carrier Performance", () => {
  test("getCarrierPerformance returns ranked carriers", () => {
    const perf = getCarrierPerformance();
    expect(perf.length).toBeGreaterThanOrEqual(1);

    for (const p of perf) {
      expect(p.carrier).toBeTruthy();
      expect(p.total_shipments).toBeGreaterThanOrEqual(1);
      expect(typeof p.on_time_pct).toBe("number");
      expect(typeof p.avg_cost).toBe("number");
      expect(typeof p.avg_delivery_days).toBe("number");
    }
  });
});

// ─── Cost Optimizer ─────────────────────────────────────────────────────────

describe("Cost Optimizer", () => {
  test("optimizeCost returns recommendations based on weight", () => {
    // Create some shipments with cost and weight data
    const order = createOrder({
      customer_name: "Cost Test",
      address: sampleAddress,
      items: sampleItems,
    });

    createShipment({
      order_id: order.id,
      carrier: "usps",
      service: "ground",
      cost: 8.5,
      weight: 2.0,
      shipped_at: "2026-01-01",
      estimated_delivery: "2026-01-05",
    });

    const order2 = createOrder({
      customer_name: "Cost Test 2",
      address: sampleAddress,
      items: sampleItems,
    });

    createShipment({
      order_id: order2.id,
      carrier: "ups",
      service: "express",
      cost: 22.0,
      weight: 2.5,
      shipped_at: "2026-01-01",
      estimated_delivery: "2026-01-03",
    });

    const recs = optimizeCost(2.0);
    expect(recs.length).toBeGreaterThanOrEqual(1);

    // Should be sorted by avg_cost ascending
    if (recs.length >= 2) {
      expect(recs[0].avg_cost).toBeLessThanOrEqual(recs[1].avg_cost);
    }

    for (const r of recs) {
      expect(r.carrier).toBeTruthy();
      expect(r.service).toBeTruthy();
      expect(r.avg_cost).toBeGreaterThan(0);
      expect(r.shipment_count).toBeGreaterThanOrEqual(1);
    }
  });

  test("optimizeCost returns empty for extreme weight", () => {
    const recs = optimizeCost(99999);
    expect(recs).toHaveLength(0);
  });
});

// ─── RMA Generation ─────────────────────────────────────────────────────────

describe("RMA Generation", () => {
  test("createReturn with auto_rma generates RMA code", () => {
    const order = createOrder({
      customer_name: "RMA Test",
      address: sampleAddress,
      items: sampleItems,
    });

    const ret = createReturn({
      order_id: order.id,
      reason: "Defective",
      auto_rma: true,
    });

    expect(ret.rma_code).toBeTruthy();
    expect(ret.rma_code!.startsWith("RMA-")).toBe(true);
    expect(ret.rma_code!.length).toBe(12); // "RMA-" + 8 chars
  });

  test("createReturn without auto_rma has null rma_code", () => {
    const order = createOrder({
      customer_name: "No RMA Test",
      address: sampleAddress,
      items: sampleItems,
    });

    const ret = createReturn({
      order_id: order.id,
      reason: "Wrong size",
    });

    expect(ret.rma_code).toBeNull();
  });

  test("each RMA code is unique", () => {
    const order = createOrder({
      customer_name: "Unique RMA Test",
      address: sampleAddress,
      items: sampleItems,
    });

    const ret1 = createReturn({ order_id: order.id, auto_rma: true });
    const ret2 = createReturn({ order_id: order.id, auto_rma: true });

    expect(ret1.rma_code).not.toBe(ret2.rma_code);
  });
});

// ─── Order Timeline ─────────────────────────────────────────────────────────

describe("Order Timeline", () => {
  test("getOrderTimeline returns events for an order with shipment and return", () => {
    const order = createOrder({
      customer_name: "Timeline Test",
      customer_email: "timeline@test.com",
      address: sampleAddress,
      items: sampleItems,
    });

    const shipment = createShipment({
      order_id: order.id,
      carrier: "dhl",
      service: "express",
      tracking_number: "DHL-TIMELINE-001",
    });

    updateShipment(shipment.id, {
      status: "delivered",
      shipped_at: "2026-02-01T10:00:00Z",
      delivered_at: "2026-02-03T14:00:00Z",
    });

    createReturn({
      order_id: order.id,
      reason: "Not as described",
      auto_rma: true,
    });

    const timeline = getOrderTimeline(order.id);
    expect(timeline.length).toBeGreaterThanOrEqual(3);

    // First event should be order creation
    const orderCreated = timeline.find((e) => e.type === "order_created");
    expect(orderCreated).toBeDefined();
    expect(orderCreated!.details).toContain("Timeline Test");

    // Should have shipment events
    const shipCreated = timeline.find((e) => e.type === "shipment_created");
    expect(shipCreated).toBeDefined();
    expect(shipCreated!.details).toContain("dhl");

    // Should have return events
    const retCreated = timeline.find((e) => e.type === "return_created");
    expect(retCreated).toBeDefined();
    expect(retCreated!.details).toContain("Not as described");
    expect(retCreated!.details).toContain("RMA-");
  });

  test("getOrderTimeline returns empty for nonexistent order", () => {
    const timeline = getOrderTimeline("nonexistent-id");
    expect(timeline).toHaveLength(0);
  });

  test("getOrderTimeline events are sorted by timestamp", () => {
    const order = createOrder({
      customer_name: "Sort Test",
      address: sampleAddress,
      items: sampleItems,
    });

    createShipment({
      order_id: order.id,
      carrier: "ups",
      service: "ground",
    });

    const timeline = getOrderTimeline(order.id);
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i].timestamp >= timeline[i - 1].timestamp).toBe(true);
    }
  });
});
