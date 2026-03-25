/**
 * Orders CRUD operations
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

export interface OrderRow {
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

// ─── Row converter ───────────────────────────────────────────────────────────

export function rowToOrder(row: OrderRow): Order {
  return {
    ...row,
    address: JSON.parse(row.address || "{}"),
    items: JSON.parse(row.items || "[]"),
    status: row.status as Order["status"],
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

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

// ─── Bulk Import/Export ──────────────────────────────────────────────────────

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

// ─── Order Timeline ──────────────────────────────────────────────────────────

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
  interface ShipmentRowMin {
    id: string;
    carrier: string;
    service: string;
    tracking_number: string | null;
    status: string;
    created_at: string;
    shipped_at: string | null;
    delivered_at: string | null;
  }
  const shipmentRows = db.prepare(
    "SELECT * FROM shipments WHERE order_id = ? ORDER BY created_at ASC"
  ).all(orderId) as ShipmentRowMin[];

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
  interface ReturnRowMin {
    id: string;
    reason: string | null;
    rma_code: string | null;
    status: string;
    created_at: string;
    updated_at: string;
  }
  const returnRows = db.prepare(
    "SELECT * FROM returns WHERE order_id = ? ORDER BY created_at ASC"
  ).all(orderId) as ReturnRowMin[];

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
