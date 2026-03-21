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
  rma_code: string | null;
  status: "requested" | "approved" | "received" | "refunded";
  created_at: string;
  updated_at: string;
}

interface ReturnRow {
  id: string;
  order_id: string;
  reason: string | null;
  rma_code: string | null;
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
  auto_rma?: boolean;
}

function generateRmaCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "RMA-";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function createReturn(input: CreateReturnInput): Return {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const rmaCode = input.auto_rma ? generateRmaCode() : null;

  db.prepare(
    `INSERT INTO returns (id, order_id, reason, status, rma_code)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    id,
    input.order_id,
    input.reason || null,
    input.status || "requested",
    rmaCode
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

// ─── Bulk Import/Export ─────────────────────────────────────────────────────

export interface BulkImportResult {
  imported: number;
  errors: { line: number; message: string }[];
}

export function bulkImportOrders(csvData: string): BulkImportResult {
  const lines = csvData.trim().split("\n");
  if (lines.length < 2) return { imported: 0, errors: [{ line: 1, message: "No data rows found" }] };

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const result: BulkImportResult = { imported: 0, errors: [] };

  for (let i = 1; i < lines.length; i++) {
    try {
      const values = parseCSVLine(lines[i]);
      const row: Record<string, string> = {};
      header.forEach((h, idx) => {
        row[h] = (values[idx] || "").trim();
      });

      const address: Address = {
        street: row["street"] || "",
        city: row["city"] || "",
        state: row["state"] || "",
        zip: row["zip"] || "",
        country: row["country"] || "US",
      };

      let items: OrderItem[] = [];
      if (row["items_json"]) {
        try {
          items = JSON.parse(row["items_json"]);
        } catch {
          items = [];
        }
      }

      createOrder({
        customer_name: row["customer_name"] || "Unknown",
        customer_email: row["customer_email"] || undefined,
        address,
        items,
        total_value: row["total_value"] ? parseFloat(row["total_value"]) : undefined,
      });

      result.imported++;
    } catch (err) {
      result.errors.push({
        line: i + 1,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

export function exportOrders(
  format: "csv" | "json",
  dateFrom?: string,
  dateTo?: string
): string {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (dateFrom) {
    conditions.push("created_at >= ?");
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push("created_at <= ?");
    params.push(dateTo);
  }

  let sql = "SELECT * FROM orders";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(...params) as OrderRow[];
  const orders = rows.map(rowToOrder);

  if (format === "json") {
    return JSON.stringify(orders, null, 2);
  }

  // CSV format
  const csvHeader = "id,customer_name,customer_email,street,city,state,zip,country,items_json,total_value,currency,status,created_at";
  const csvRows = orders.map((o) => {
    const itemsJson = JSON.stringify(o.items).replace(/"/g, '""');
    return [
      o.id,
      escapeCSV(o.customer_name),
      o.customer_email || "",
      escapeCSV(o.address.street),
      escapeCSV(o.address.city),
      escapeCSV(o.address.state),
      o.address.zip,
      o.address.country,
      `"${itemsJson}"`,
      o.total_value.toString(),
      o.currency,
      o.status,
      o.created_at,
    ].join(",");
  });

  return [csvHeader, ...csvRows].join("\n");
}

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ─── Delivery Timeline Analytics ────────────────────────────────────────────

export interface DeliveryStats {
  carrier: string;
  service: string;
  total_shipments: number;
  delivered_count: number;
  avg_delivery_days: number;
  on_time_pct: number;
  late_pct: number;
}

export function getDeliveryStats(carrier?: string): DeliveryStats[] {
  const db = getDatabase();
  const conditions: string[] = ["delivered_at IS NOT NULL", "shipped_at IS NOT NULL"];
  const params: unknown[] = [];

  if (carrier) {
    conditions.push("carrier = ?");
    params.push(carrier);
  }

  const sql = `
    SELECT
      carrier,
      service,
      COUNT(*) as total_shipments,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered_count,
      AVG(julianday(delivered_at) - julianday(shipped_at)) as avg_delivery_days,
      SUM(CASE WHEN estimated_delivery IS NOT NULL AND delivered_at <= estimated_delivery THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as on_time_pct,
      SUM(CASE WHEN estimated_delivery IS NOT NULL AND delivered_at > estimated_delivery THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as late_pct
    FROM shipments
    WHERE ${conditions.join(" AND ")}
    GROUP BY carrier, service
    ORDER BY carrier, service
  `;

  return db.prepare(sql).all(...params) as DeliveryStats[];
}

// ─── Late Delivery Alerts ───────────────────────────────────────────────────

export interface OverdueShipment {
  shipment_id: string;
  order_id: string;
  carrier: string;
  service: string;
  tracking_number: string | null;
  estimated_delivery: string;
  days_overdue: number;
  status: string;
}

export function listOverdueShipments(graceDays: number = 0): OverdueShipment[] {
  const db = getDatabase();

  const sql = `
    SELECT
      id as shipment_id,
      order_id,
      carrier,
      service,
      tracking_number,
      estimated_delivery,
      CAST(julianday('now') - julianday(estimated_delivery) - ? AS INTEGER) as days_overdue,
      status
    FROM shipments
    WHERE estimated_delivery IS NOT NULL
      AND status != 'delivered'
      AND julianday('now') > julianday(estimated_delivery) + ?
    ORDER BY days_overdue DESC
  `;

  return db.prepare(sql).all(graceDays, graceDays) as OverdueShipment[];
}

// ─── Customer History ───────────────────────────────────────────────────────

export interface CustomerHistory {
  customer_email: string;
  orders: Order[];
  shipments: Shipment[];
  returns: Return[];
}

export function getCustomerHistory(email: string): CustomerHistory {
  const db = getDatabase();

  const orderRows = db.prepare(
    "SELECT * FROM orders WHERE customer_email = ? ORDER BY created_at DESC"
  ).all(email) as OrderRow[];
  const orders = orderRows.map(rowToOrder);

  const orderIds = orders.map((o) => o.id);
  let shipments: Shipment[] = [];
  let returns: Return[] = [];

  if (orderIds.length > 0) {
    const placeholders = orderIds.map(() => "?").join(",");

    const shipmentRows = db.prepare(
      `SELECT * FROM shipments WHERE order_id IN (${placeholders}) ORDER BY created_at DESC`
    ).all(...orderIds) as ShipmentRow[];
    shipments = shipmentRows.map(rowToShipment);

    const returnRows = db.prepare(
      `SELECT * FROM returns WHERE order_id IN (${placeholders}) ORDER BY created_at DESC`
    ).all(...orderIds) as ReturnRow[];
    returns = returnRows.map(rowToReturn);
  }

  return { customer_email: email, orders, shipments, returns };
}

// ─── Carrier Performance ────────────────────────────────────────────────────

export interface CarrierPerformance {
  carrier: string;
  total_shipments: number;
  delivered_count: number;
  on_time_pct: number;
  avg_cost: number;
  avg_delivery_days: number;
}

export function getCarrierPerformance(): CarrierPerformance[] {
  const db = getDatabase();

  const sql = `
    SELECT
      carrier,
      COUNT(*) as total_shipments,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered_count,
      COALESCE(
        SUM(CASE WHEN estimated_delivery IS NOT NULL AND delivered_at IS NOT NULL AND delivered_at <= estimated_delivery THEN 1 ELSE 0 END) * 100.0
        / NULLIF(SUM(CASE WHEN estimated_delivery IS NOT NULL AND delivered_at IS NOT NULL THEN 1 ELSE 0 END), 0),
        0
      ) as on_time_pct,
      COALESCE(AVG(cost), 0) as avg_cost,
      COALESCE(
        AVG(CASE WHEN delivered_at IS NOT NULL AND shipped_at IS NOT NULL THEN julianday(delivered_at) - julianday(shipped_at) END),
        0
      ) as avg_delivery_days
    FROM shipments
    GROUP BY carrier
    ORDER BY on_time_pct DESC
  `;

  return db.prepare(sql).all() as CarrierPerformance[];
}

// ─── Cost Optimizer ─────────────────────────────────────────────────────────

export interface CostRecommendation {
  carrier: string;
  service: string;
  avg_cost: number;
  avg_delivery_days: number;
  shipment_count: number;
}

export function optimizeCost(
  weight: number,
  _fromZip?: string,
  _toZip?: string
): CostRecommendation[] {
  const db = getDatabase();

  // Find historical shipments with similar weight (within 50% range)
  const minWeight = weight * 0.5;
  const maxWeight = weight * 1.5;

  const sql = `
    SELECT
      carrier,
      service,
      AVG(cost) as avg_cost,
      AVG(CASE WHEN delivered_at IS NOT NULL AND shipped_at IS NOT NULL THEN julianday(delivered_at) - julianday(shipped_at) END) as avg_delivery_days,
      COUNT(*) as shipment_count
    FROM shipments
    WHERE cost IS NOT NULL
      AND weight IS NOT NULL
      AND weight BETWEEN ? AND ?
    GROUP BY carrier, service
    HAVING shipment_count >= 1
    ORDER BY avg_cost ASC
  `;

  return db.prepare(sql).all(minWeight, maxWeight) as CostRecommendation[];
}

// ─── Order Timeline ─────────────────────────────────────────────────────────

export interface TimelineEvent {
  timestamp: string;
  type: "order_created" | "order_updated" | "shipment_created" | "shipment_updated" | "return_created" | "return_updated";
  entity_id: string;
  details: string;
}

export function getOrderTimeline(orderId: string): TimelineEvent[] {
  const db = getDatabase();
  const events: TimelineEvent[] = [];

  // Order creation
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId) as OrderRow | null;
  if (!order) return [];

  events.push({
    timestamp: order.created_at,
    type: "order_created",
    entity_id: order.id,
    details: `Order created for ${order.customer_name} — $${order.total_value} ${order.currency} [${order.status}]`,
  });

  if (order.updated_at !== order.created_at) {
    events.push({
      timestamp: order.updated_at,
      type: "order_updated",
      entity_id: order.id,
      details: `Order updated — status: ${order.status}`,
    });
  }

  // Shipments
  const shipmentRows = db.prepare(
    "SELECT * FROM shipments WHERE order_id = ? ORDER BY created_at ASC"
  ).all(orderId) as ShipmentRow[];

  for (const s of shipmentRows) {
    events.push({
      timestamp: s.created_at,
      type: "shipment_created",
      entity_id: s.id,
      details: `Shipment created via ${s.carrier}/${s.service}${s.tracking_number ? ` (${s.tracking_number})` : ""} [${s.status}]`,
    });

    if (s.shipped_at) {
      events.push({
        timestamp: s.shipped_at,
        type: "shipment_updated",
        entity_id: s.id,
        details: `Shipment shipped via ${s.carrier}`,
      });
    }
    if (s.delivered_at) {
      events.push({
        timestamp: s.delivered_at,
        type: "shipment_updated",
        entity_id: s.id,
        details: `Shipment delivered via ${s.carrier}`,
      });
    }
  }

  // Returns
  const returnRows = db.prepare(
    "SELECT * FROM returns WHERE order_id = ? ORDER BY created_at ASC"
  ).all(orderId) as ReturnRow[];

  for (const r of returnRows) {
    events.push({
      timestamp: r.created_at,
      type: "return_created",
      entity_id: r.id,
      details: `Return requested${r.reason ? `: ${r.reason}` : ""}${r.rma_code ? ` (${r.rma_code})` : ""} [${r.status}]`,
    });

    if (r.updated_at !== r.created_at) {
      events.push({
        timestamp: r.updated_at,
        type: "return_updated",
        entity_id: r.id,
        details: `Return updated — status: ${r.status}`,
      });
    }
  }

  // Sort by timestamp
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return events;
}
