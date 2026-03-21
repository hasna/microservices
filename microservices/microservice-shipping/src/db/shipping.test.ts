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
import { getShippingStats, getCostsByCarrier } from "./shipping";
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
