/**
 * Shipping CRUD operations — orders, shipments, and returns
 */

import { getDatabase } from "./database.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface OrderItem {
  name: string;
  qty: number;
  weight: number;
  value: number;
}

export interface Order {
  id: string;
  customer_name: string;
  customer_email: string | null;
  address: Address;
  items: OrderItem[];
  status: "pending" | "processing" | "shipped" | "delivered" | "returned";
  total_value: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

interface OrderRow {
  id: string;
  customer_name: string;
  customer_email: string | null;
  address: string;
  items: string;
  status: string;
  total_value: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface Shipment {
  id: string;
  order_id: string;
  carrier: "ups" | "fedex" | "usps" | "dhl";
  tracking_number: string | null;
  service: "ground" | "express" | "overnight";
  status: "label_created" | "in_transit" | "out_for_delivery" | "delivered" | "exception";
  shipped_at: string | null;
  estimated_delivery: string | null;
  delivered_at: string | null;
  cost: number | null;
  weight: number | null;
  dimensions: Record<string, unknown> | null;
  created_at: string;
}

interface ShipmentRow {
  id: string;
  order_id: string;
  carrier: string;
  tracking_number: string | null;
  service: string;
  status: string;
  shipped_at: string | null;
  estimated_delivery: string | null;
  delivered_at: string | null;
  cost: number | null;
  weight: number | null;
  dimensions: string | null;
  created_at: string;
}

export interface Return {
  id: string;
  order_id: string;
  reason: string | null;
  status: "requested" | "approved" | "received" | "refunded";
  created_at: string;
  updated_at: string;
}

interface ReturnRow {
  id: string;
  order_id: string;
  reason: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

// ─── Row converters ──────────────────────────────────────────────────────────

function rowToOrder(row: OrderRow): Order {
  return {
    ...row,
    address: JSON.parse(row.address || "{}"),
    items: JSON.parse(row.items || "[]"),
    status: row.status as Order["status"],
  };
}

function rowToShipment(row: ShipmentRow): Shipment {
  return {
    ...row,
    carrier: row.carrier as Shipment["carrier"],
    service: row.service as Shipment["service"],
    status: row.status as Shipment["status"],
    dimensions: row.dimensions ? JSON.parse(row.dimensions) : null,
  };
}

function rowToReturn(row: ReturnRow): Return {
  return {
    ...row,
    status: row.status as Return["status"],
  };
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export interface CreateOrderInput {
  customer_name: string;
  customer_email?: string;
  address: Address;
  items: OrderItem[];
  status?: Order["status"];
  total_value?: number;
  currency?: string;
}

export function createOrder(input: CreateOrderInput): Order {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const address = JSON.stringify(input.address);
  const items = JSON.stringify(input.items);
  const totalValue = input.total_value ?? input.items.reduce((sum, i) => sum + i.value * i.qty, 0);

  db.prepare(
    `INSERT INTO orders (id, customer_name, customer_email, address, items, status, total_value, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.customer_name,
    input.customer_email || null,
    address,
    items,
    input.status || "pending",
    totalValue,
    input.currency || "USD"
  );

  return getOrder(id)!;
}

export function getOrder(id: string): Order | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow | null;
  return row ? rowToOrder(row) : null;
}

export interface ListOrdersOptions {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function listOrders(options: ListOrdersOptions = {}): Order[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.search) {
    conditions.push(
      "(customer_name LIKE ? OR customer_email LIKE ?)"
    );
    const q = `%${options.search}%`;
    params.push(q, q);
  }

  let sql = "SELECT * FROM orders";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as OrderRow[];
  return rows.map(rowToOrder);
}

export interface UpdateOrderInput {
  customer_name?: string;
  customer_email?: string;
  address?: Address;
  items?: OrderItem[];
  status?: Order["status"];
  total_value?: number;
  currency?: string;
}

export function updateOrder(id: string, input: UpdateOrderInput): Order | null {
  const db = getDatabase();
  const existing = getOrder(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.customer_name !== undefined) {
    sets.push("customer_name = ?");
    params.push(input.customer_name);
  }
  if (input.customer_email !== undefined) {
    sets.push("customer_email = ?");
    params.push(input.customer_email);
  }
  if (input.address !== undefined) {
    sets.push("address = ?");
    params.push(JSON.stringify(input.address));
  }
  if (input.items !== undefined) {
    sets.push("items = ?");
    params.push(JSON.stringify(input.items));
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.total_value !== undefined) {
    sets.push("total_value = ?");
    params.push(input.total_value);
  }
  if (input.currency !== undefined) {
    sets.push("currency = ?");
    params.push(input.currency);
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE orders SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getOrder(id);
}

export function deleteOrder(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM orders WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listByStatus(status: string): Order[] {
  return listOrders({ status });
}

export function searchOrders(query: string): Order[] {
  return listOrders({ search: query });
}

// ─── Shipments ───────────────────────────────────────────────────────────────

export interface CreateShipmentInput {
  order_id: string;
  carrier: Shipment["carrier"];
  tracking_number?: string;
  service?: Shipment["service"];
  status?: Shipment["status"];
  shipped_at?: string;
  estimated_delivery?: string;
  cost?: number;
  weight?: number;
  dimensions?: Record<string, unknown>;
}

export function createShipment(input: CreateShipmentInput): Shipment {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO shipments (id, order_id, carrier, tracking_number, service, status, shipped_at, estimated_delivery, cost, weight, dimensions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.order_id,
    input.carrier,
    input.tracking_number || null,
    input.service || "ground",
    input.status || "label_created",
    input.shipped_at || null,
    input.estimated_delivery || null,
    input.cost ?? null,
    input.weight ?? null,
    input.dimensions ? JSON.stringify(input.dimensions) : null
  );

  // Update order status to processing if it's pending
  const order = getOrder(input.order_id);
  if (order && order.status === "pending") {
    updateOrder(input.order_id, { status: "processing" });
  }

  return getShipment(id)!;
}

export function getShipment(id: string): Shipment | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM shipments WHERE id = ?").get(id) as ShipmentRow | null;
  return row ? rowToShipment(row) : null;
}

export function getShipmentByTracking(trackingNumber: string): Shipment | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM shipments WHERE tracking_number = ?").get(trackingNumber) as ShipmentRow | null;
  return row ? rowToShipment(row) : null;
}

export interface ListShipmentsOptions {
  order_id?: string;
  carrier?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export function listShipments(options: ListShipmentsOptions = {}): Shipment[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.order_id) {
    conditions.push("order_id = ?");
    params.push(options.order_id);
  }
  if (options.carrier) {
    conditions.push("carrier = ?");
    params.push(options.carrier);
  }
  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  let sql = "SELECT * FROM shipments";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as ShipmentRow[];
  return rows.map(rowToShipment);
}

export interface UpdateShipmentInput {
  carrier?: Shipment["carrier"];
  tracking_number?: string;
  service?: Shipment["service"];
  status?: Shipment["status"];
  shipped_at?: string;
  estimated_delivery?: string;
  delivered_at?: string;
  cost?: number;
  weight?: number;
  dimensions?: Record<string, unknown>;
}

export function updateShipment(id: string, input: UpdateShipmentInput): Shipment | null {
  const db = getDatabase();
  const existing = getShipment(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.carrier !== undefined) {
    sets.push("carrier = ?");
    params.push(input.carrier);
  }
  if (input.tracking_number !== undefined) {
    sets.push("tracking_number = ?");
    params.push(input.tracking_number);
  }
  if (input.service !== undefined) {
    sets.push("service = ?");
    params.push(input.service);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);

    // Update order status when shipment is delivered
    if (input.status === "delivered") {
      updateOrder(existing.order_id, { status: "delivered" });
    }
  }
  if (input.shipped_at !== undefined) {
    sets.push("shipped_at = ?");
    params.push(input.shipped_at);
  }
  if (input.estimated_delivery !== undefined) {
    sets.push("estimated_delivery = ?");
    params.push(input.estimated_delivery);
  }
  if (input.delivered_at !== undefined) {
    sets.push("delivered_at = ?");
    params.push(input.delivered_at);
  }
  if (input.cost !== undefined) {
    sets.push("cost = ?");
    params.push(input.cost);
  }
  if (input.weight !== undefined) {
    sets.push("weight = ?");
    params.push(input.weight);
  }
  if (input.dimensions !== undefined) {
    sets.push("dimensions = ?");
    params.push(JSON.stringify(input.dimensions));
  }

  if (sets.length === 0) return existing;

  params.push(id);

  db.prepare(
    `UPDATE shipments SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getShipment(id);
}

export function deleteShipment(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM shipments WHERE id = ?").run(id);
  return result.changes > 0;
}

// ─── Returns ─────────────────────────────────────────────────────────────────

export interface CreateReturnInput {
  order_id: string;
  reason?: string;
  status?: Return["status"];
}

export function createReturn(input: CreateReturnInput): Return {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO returns (id, order_id, reason, status)
     VALUES (?, ?, ?, ?)`
  ).run(
    id,
    input.order_id,
    input.reason || null,
    input.status || "requested"
  );

  return getReturn(id)!;
}

export function getReturn(id: string): Return | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM returns WHERE id = ?").get(id) as ReturnRow | null;
  return row ? rowToReturn(row) : null;
}

export interface ListReturnsOptions {
  order_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export function listReturns(options: ListReturnsOptions = {}): Return[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.order_id) {
    conditions.push("order_id = ?");
    params.push(options.order_id);
  }
  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  let sql = "SELECT * FROM returns";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as ReturnRow[];
  return rows.map(rowToReturn);
}

export interface UpdateReturnInput {
  reason?: string;
  status?: Return["status"];
}

export function updateReturn(id: string, input: UpdateReturnInput): Return | null {
  const db = getDatabase();
  const existing = getReturn(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.reason !== undefined) {
    sets.push("reason = ?");
    params.push(input.reason);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);

    // Update order status when return is received or refunded
    if (input.status === "received" || input.status === "refunded") {
      updateOrder(existing.order_id, { status: "returned" });
    }
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE returns SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getReturn(id);
}

export function deleteReturn(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM returns WHERE id = ?").run(id);
  return result.changes > 0;
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface ShippingStats {
  total_orders: number;
  orders_by_status: Record<string, number>;
  total_shipments: number;
  shipments_by_status: Record<string, number>;
  total_returns: number;
  returns_by_status: Record<string, number>;
  total_revenue: number;
  total_shipping_cost: number;
}

export function getShippingStats(): ShippingStats {
  const db = getDatabase();

  const totalOrders = (db.prepare("SELECT COUNT(*) as count FROM orders").get() as { count: number }).count;
  const ordersByStatus = db.prepare("SELECT status, COUNT(*) as count FROM orders GROUP BY status").all() as { status: string; count: number }[];

  const totalShipments = (db.prepare("SELECT COUNT(*) as count FROM shipments").get() as { count: number }).count;
  const shipmentsByStatus = db.prepare("SELECT status, COUNT(*) as count FROM shipments GROUP BY status").all() as { status: string; count: number }[];

  const totalReturns = (db.prepare("SELECT COUNT(*) as count FROM returns").get() as { count: number }).count;
  const returnsByStatus = db.prepare("SELECT status, COUNT(*) as count FROM returns GROUP BY status").all() as { status: string; count: number }[];

  const totalRevenue = (db.prepare("SELECT COALESCE(SUM(total_value), 0) as total FROM orders").get() as { total: number }).total;
  const totalShippingCost = (db.prepare("SELECT COALESCE(SUM(cost), 0) as total FROM shipments").get() as { total: number }).total;

  return {
    total_orders: totalOrders,
    orders_by_status: Object.fromEntries(ordersByStatus.map((r) => [r.status, r.count])),
    total_shipments: totalShipments,
    shipments_by_status: Object.fromEntries(shipmentsByStatus.map((r) => [r.status, r.count])),
    total_returns: totalReturns,
    returns_by_status: Object.fromEntries(returnsByStatus.map((r) => [r.status, r.count])),
    total_revenue: totalRevenue,
    total_shipping_cost: totalShippingCost,
  };
}

export interface CarrierCosts {
  carrier: string;
  total_cost: number;
  shipment_count: number;
  avg_cost: number;
}

export function getCostsByCarrier(): CarrierCosts[] {
  const db = getDatabase();
  const rows = db.prepare(
    `SELECT carrier, COALESCE(SUM(cost), 0) as total_cost, COUNT(*) as shipment_count, COALESCE(AVG(cost), 0) as avg_cost
     FROM shipments GROUP BY carrier ORDER BY total_cost DESC`
  ).all() as CarrierCosts[];
  return rows;
}
