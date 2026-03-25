/**
 * Shipments CRUD operations
 */

import { getDatabase } from "./database.js";
import { getOrder, updateOrder } from "./orders.js";

// ─── Types ───────────────────────────────────────────────────────────────────

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

export interface ShipmentRow {
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

// ─── Row converter ───────────────────────────────────────────────────────────

export function rowToShipment(row: ShipmentRow): Shipment {
  return {
    ...row,
    carrier: row.carrier as Shipment["carrier"],
    service: row.service as Shipment["service"],
    status: row.status as Shipment["status"],
    dimensions: row.dimensions ? JSON.parse(row.dimensions) : null,
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

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

// ─── Late Delivery Alerts ────────────────────────────────────────────────────

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
