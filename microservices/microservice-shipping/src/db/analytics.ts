/**
 * Shipping analytics — stats, carrier performance, cost optimizer, delivery timelines
 */

import { getDatabase } from "./database.js";
import { rowToOrder, OrderRow, Order } from "./orders.js";
import { rowToShipment, ShipmentRow, Shipment } from "./shipments.js";
import { rowToReturn, ReturnRow, Return } from "./returns.js";

// ─── Shipping Stats ──────────────────────────────────────────────────────────

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

// ─── Carrier Costs ───────────────────────────────────────────────────────────

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

// ─── Delivery Stats ──────────────────────────────────────────────────────────

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

// ─── Carrier Performance ─────────────────────────────────────────────────────

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

// ─── Cost Optimizer ──────────────────────────────────────────────────────────

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

// ─── Customer History ────────────────────────────────────────────────────────

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
