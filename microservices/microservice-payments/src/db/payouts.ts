/**
 * Payout CRUD operations
 */

import { getDatabase } from "./database.js";

// --- Payouts ---

export type PayoutStatus = "pending" | "in_transit" | "paid" | "failed";

export interface Payout {
  id: string;
  amount: number;
  currency: string;
  destination: string | null;
  status: PayoutStatus;
  initiated_at: string;
  arrived_at: string | null;
  created_at: string;
}

interface PayoutRow {
  id: string;
  amount: number;
  currency: string;
  destination: string | null;
  status: string;
  initiated_at: string;
  arrived_at: string | null;
  created_at: string;
}

function rowToPayout(row: PayoutRow): Payout {
  return {
    ...row,
    status: row.status as PayoutStatus,
  };
}

export interface CreatePayoutInput {
  amount: number;
  currency?: string;
  destination?: string;
}

export function createPayout(input: CreatePayoutInput): Payout {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO payouts (id, amount, currency, destination)
     VALUES (?, ?, ?, ?)`
  ).run(id, input.amount, input.currency || "USD", input.destination || null);

  return getPayout(id)!;
}

export function getPayout(id: string): Payout | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM payouts WHERE id = ?").get(id) as PayoutRow | null;
  return row ? rowToPayout(row) : null;
}

export function listPayouts(status?: PayoutStatus): Payout[] {
  const db = getDatabase();
  let sql = "SELECT * FROM payouts";
  const params: unknown[] = [];

  if (status) {
    sql += " WHERE status = ?";
    params.push(status);
  }
  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(...params) as PayoutRow[];
  return rows.map(rowToPayout);
}

export interface UpdatePayoutInput {
  status?: PayoutStatus;
  destination?: string;
  arrived_at?: string;
}

export function updatePayout(id: string, input: UpdatePayoutInput): Payout | null {
  const db = getDatabase();
  const existing = getPayout(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.destination !== undefined) {
    sets.push("destination = ?");
    params.push(input.destination);
  }
  if (input.arrived_at !== undefined) {
    sets.push("arrived_at = ?");
    params.push(input.arrived_at);
  }

  if (sets.length === 0) return existing;

  params.push(id);
  db.prepare(`UPDATE payouts SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getPayout(id);
}

export function deletePayout(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM payouts WHERE id = ?").run(id);
  return result.changes > 0;
}
