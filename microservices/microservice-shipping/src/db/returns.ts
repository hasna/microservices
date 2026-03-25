/**
 * Returns CRUD operations
 */

import { getDatabase } from "./database.js";
import { updateOrder } from "./orders.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Return {
  id: string;
  order_id: string;
  reason: string | null;
  rma_code: string | null;
  status: "requested" | "approved" | "received" | "refunded";
  created_at: string;
  updated_at: string;
}

export interface ReturnRow {
  id: string;
  order_id: string;
  reason: string | null;
  rma_code: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

// ─── Row converter ───────────────────────────────────────────────────────────

export function rowToReturn(row: ReturnRow): Return {
  return {
    ...row,
    status: row.status as Return["status"],
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

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
